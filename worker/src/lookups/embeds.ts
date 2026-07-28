/**
 * Embeds for inline lookups.
 *
 * Ported from `discord-nft-embed-bot/src/index.ts:232-249` (the token embed)
 * and `:300-372` (the username embed), with the metadata fan-out cut back.
 *
 * **The cut, and why.** The Node bot's `buildEmbed` fired five sequential or
 * parallel OpenSea calls per embed
 * (`discord-nft-embed-bot/src/index.ts:174-200`): the NFT, the
 * collection slug, the last sale, the best offer and the best listing. Six
 * embeds on one message is thirty-plus subrequests against a budget of fifty,
 * before the reply itself. The plan flags exactly this
 * (`plans/cloudflare-consolidation.md`, Risks: "consider dropping the parallel
 * last-sale/best-offer/best-listing trio to one call") and this is that
 * decision taken: a bot lookup is two calls, the GlyphBots record and one
 * OpenSea NFT read for owner and rarity. Price history stays available through
 * `/bot`, `/sales` and `/listings`, which are one interaction each and carry
 * their own budget.
 *
 * Cost per lookup, worst case:
 *   b#123      3 subrequests (GlyphBots record, OpenSea NFT, owner's name)
 *   a#123      2 subrequests (artifact + origin bot name)
 *   #username  5 subrequests (account, account NFTs, then a bot lookup)
 *
 * Six of the most expensive kind is 30, which still fits inside fifty. The
 * third call on a bot lookup is the owner's name, and it is a third call rather
 * than a fourth because `clients.names` is shared across every embed in one
 * message: six lookups of bots held by the same wallet resolve it once. The
 * `#username` path primes that cache with the account it already fetched, so
 * looking up a bot the account itself owns does not re-fetch it by address.
 *
 * **No OpenSea image, ever.** `image_url` for these contracts is
 * `image/svg+xml` and Discord renders nothing for it. Bot images come from
 * `getBotPngUrl`; artifact images come from the GlyphBots API, which serves
 * JPEG and PNG. The field is not on the OpenSea types in `../api/types.ts`, so
 * this is a compile error rather than a convention.
 */

import { EmbedBuilder } from "@discordjs/builders";
import type { APIEmbed } from "discord-api-types/v10";
import type { DisplayNameResolver } from "../api/display-name";
import { createDisplayNameResolver } from "../api/display-name";
import type { GlyphBotsClient } from "../api/glyphbots";
import type { OpenSeaClient } from "../api/opensea";
import { getOpenSeaArtifactUrl, getOpenSeaUrl } from "../api/opensea";
import { BOT_NAME_PREFIX, formatTraitLine } from "../commands/format";
import { COLORS, MAX_BOT_TOKEN_ID } from "../config";
import { formatActor } from "../discord/embeds";
import { createLogger } from "../utils/logger";
import type { LookupMatch } from "./matcher";

const log = createLogger("Lookups");

export type LookupClients = {
  glyphbots: GlyphBotsClient;
  opensea: OpenSeaClient;
  /**
   * Owner-name cache, shared across every embed in one message. Optional so the
   * three other places that hold a `LookupClients` (`../channels/gallery.ts`,
   * `../channels/nudge.ts`, `./handle.ts`) do not each have to build one; when
   * it is absent a private resolver is built per embed, which is correct but
   * caches nothing.
   */
  names?: DisplayNameResolver;
};

/** `GlyphBot #123`, owner, rarity, one line of traits, first-party PNG. */
export const buildBotLookupEmbed = async (
  tokenId: number,
  clients: LookupClients
): Promise<APIEmbed | null> => {
  const [bot, nft] = await Promise.all([
    clients.glyphbots.fetchBot(tokenId),
    clients.opensea.fetchNFT(tokenId),
  ]);

  if (!bot) {
    log.info(`Lookup miss: bot #${tokenId}`);
    return null;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.bot)
    .setTitle(`GlyphBot #${tokenId}`)
    .setURL(clients.glyphbots.getBotUrl(tokenId))
    .setDescription(`**${bot.name.replace(BOT_NAME_PREFIX, "")}**`)
    .setImage(clients.glyphbots.getBotPngUrl(tokenId));

  const ownerAddress = nft?.owners?.[0]?.address ?? null;
  if (ownerAddress) {
    const names = clients.names ?? createDisplayNameResolver(clients.opensea);
    embed.addFields({
      name: "Owner",
      value: formatActor(await names.resolve(ownerAddress)),
      inline: true,
    });
  }

  const rank = nft?.rarity?.rank ?? bot.rarityRank ?? null;
  if (rank !== null) {
    embed.addFields({
      name: "Rarity",
      value: `#${rank.toLocaleString()} / ${MAX_BOT_TOKEN_ID.toLocaleString()}`,
      inline: true,
    });
  }

  // A field, not the footer. Discord renders footer text literally: markdown
  // is not parsed there and a bare URL is not auto-linked, so the OpenSea
  // address this used to carry was a string to copy by hand.
  embed.addFields({
    name: "OpenSea",
    value: `[View](${getOpenSeaUrl(tokenId)})`,
    inline: true,
  });

  // Same one-line shape as `/bot`, so an inline reply and a slash reply do not
  // look like two different products. There is no story fetch here on purpose:
  // the subrequest budget above holds a bot lookup to two calls.
  const traits = formatTraitLine(bot.traits);
  if (traits) {
    embed.addFields({ name: "Traits", value: traits });
  }

  return embed.setFooter({ text: "GlyphBots" }).toJSON() as APIEmbed;
};

/** One artifact, image straight off the GlyphBots API. */
export const buildArtifactLookupEmbed = async (
  tokenId: number,
  clients: LookupClients
): Promise<APIEmbed | null> => {
  const artifact = await clients.glyphbots.fetchArtifact(tokenId);

  if (!artifact) {
    log.info(`Lookup miss: artifact #${tokenId}`);
    return null;
  }

  // Same fallback as `/artifact`, for the same reason: a null title is
  // accepted by `setTitle` and takes the `setURL` link down with it, and an
  // empty one throws. The token id has its own field below.
  const embed = new EmbedBuilder()
    .setColor(COLORS.artifact)
    .setTitle(artifact.title || "Artifact")
    .setURL(clients.glyphbots.getArtifactUrl(tokenId));

  const originBot = await clients.glyphbots.fetchBot(artifact.botTokenId);
  const botName =
    originBot?.name?.replace(BOT_NAME_PREFIX, "") ?? `#${artifact.botTokenId}`;

  // Field order follows `/artifact`: Token ID, Type, then the links. `/artifact`
  // puts its links in a button row, which an inline lookup cannot use: one
  // reply can carry six embeds and a message has one set of components.
  embed.addFields({ name: "Token ID", value: `#${tokenId}`, inline: true });

  if (artifact.type) {
    embed.addFields({
      name: "Type",
      value: artifact.type.charAt(0).toUpperCase() + artifact.type.slice(1),
      inline: true,
    });
  }

  // Clickable, and ahead of Origin Bot so it lands on the first row whether or
  // not the artifact has a type. See the note in the bot embed for why the
  // footer cannot hold this.
  embed.addFields({
    name: "OpenSea",
    value: `[View](${getOpenSeaArtifactUrl(tokenId)})`,
    inline: true,
  });

  embed.addFields({
    name: "Origin Bot",
    value: `[${botName}](${clients.glyphbots.getBotUrl(artifact.botTokenId)})`,
    inline: true,
  });

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  return embed.setFooter({ text: "GlyphBots Artifacts" }).toJSON() as APIEmbed;
};

/**
 * `#username`, an OpenSea handle resolved to one bot that account owns.
 *
 * `/accounts/{address_or_username}` takes either form, which is what the Node
 * bot relied on (`discord-nft-embed-bot/src/api/opensea.ts:341-358`), and the
 * account NFT read is already filtered to the GlyphBots collection by
 * `createOpenSeaClient`.
 */
const buildUsernameLookupEmbed = async (
  username: string,
  clients: LookupClients,
  pick: (count: number) => number = (count) => Math.floor(Math.random() * count)
): Promise<APIEmbed | null> => {
  const account = await clients.opensea.fetchAccount(username);

  if (!account?.address) {
    log.info(`Lookup miss: no OpenSea account for ${username}`);
    return null;
  }

  // The bot embed below is about to want a name for whoever owns the token, and
  // for this path that is nearly always this same account. Priming the cache
  // with what has already been fetched keeps the lookup at one account call.
  clients.names?.prime(account);

  const nfts = await clients.opensea.fetchAccountNFTs(account.address);
  const chosen = nfts[pick(nfts.length)];

  if (!chosen) {
    log.info(`Lookup miss: ${username} holds no GlyphBots`);
    return null;
  }

  const tokenId = Number(chosen.identifier);
  if (!Number.isFinite(tokenId)) {
    return null;
  }

  return buildBotLookupEmbed(tokenId, clients);
};

/** Build the embed for one match. Returns null when there is nothing to say. */
export const buildLookupEmbed = (
  match: LookupMatch,
  clients: LookupClients
): Promise<APIEmbed | null> => {
  if (match.kind === "bot") {
    return buildBotLookupEmbed(match.tokenId, clients);
  }
  if (match.kind === "artifact") {
    return buildArtifactLookupEmbed(match.tokenId, clients);
  }
  return buildUsernameLookupEmbed(match.username, clients);
};

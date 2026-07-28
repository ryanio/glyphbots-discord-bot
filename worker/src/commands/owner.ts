/**
 * `/owner`.
 *
 * The thumbnail is `getBotPngUrl`, as it was on the Node bot. OpenSea supplies
 * the owner address and the rarity rank, never the image.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { preferredName } from "../api/display-name";
import { shortAddress } from "../api/glyphbots";
import { getOpenSeaUrl } from "../api/opensea";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply, escapeMarkdown } from "../discord/embeds";
import type { CommandHandler } from "./context";

export const handleOwner: CommandHandler = async (ctx) => {
  const tokenId = ctx.options.getInteger("bot");

  if (tokenId === null) {
    return errorReply("❌ Missing Bot ID", "Please provide a bot token id.");
  }

  const nft = await ctx.opensea.fetchNFT(tokenId);

  if (!nft) {
    return errorReply(
      "❌ Bot Not Found",
      `GlyphBot #${tokenId} was not found.`
    );
  }

  const owner = nft.owners?.[0];
  if (!owner) {
    return errorReply(
      "❌ Owner Not Found",
      `Could not determine the owner of GlyphBot #${tokenId}.`
    );
  }

  const account = await ctx.opensea.fetchAccount(owner.address);

  // The name and the bio are text the account holder wrote (or, for an ENS
  // name, registered). Underscores and asterisks are common in both and Discord
  // reads them as formatting, so both go through the escape before they reach
  // the description. The address is hex and needs nothing.
  //
  // This is the one place that shows the address whatever happens, since it has
  // a line of its own. The Owner line is the name: the OpenSea username, else
  // the ENS name, else the address again.
  const name = preferredName(account, owner.address);
  const bio = account?.bio ? escapeMarkdown(account.bio) : null;
  const botName = nft.name || `GlyphBot #${tokenId}`;

  // `@handle` reads as a handle; an ENS name is already a name and does not
  // want the sigil.
  const ownerLabel = name.isAddress
    ? name.label
    : `${name.username ? "@" : ""}${escapeMarkdown(name.label)}`;

  // The guard belongs on the number, not on the container: OpenSea sends a
  // `rarity` object with a null rank for a bot it has not ranked, and reading
  // `.toLocaleString()` off that threw the whole command. Zero is not a rank
  // either, same as `/rarity`.
  const rawRank = nft.rarity?.rank ?? null;
  const rank = rawRank !== null && rawRank > 0 ? rawRank : null;

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`🤖 ${botName}`)
    .setDescription(
      [
        `**Owner:** ${ownerLabel}`,
        // Kept even when the Owner line is already the address: dropping it
        // there would make the embed change shape depending on whether OpenSea
        // happened to know a name.
        `**Address:** \`${shortAddress(owner.address)}\``,
        name.username && name.ens ? `**ENS:** ${escapeMarkdown(name.ens)}` : "",
        "",
        bio ? `*"${bio}"*` : "",
        "",
        rank === null ? "" : `**Rarity Rank:** #${rank.toLocaleString()}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setThumbnail(ctx.glyphbots.getBotPngUrl(tokenId))
    .setFooter({ text: "Data from OpenSea" });

  return embedReply(embed, [
    linkButtonRow([
      { label: "View Bot", url: ctx.glyphbots.getBotUrl(tokenId), emoji: "🤖" },
      { label: "View on OpenSea", url: getOpenSeaUrl(tokenId), emoji: "🌊" },
    ]),
  ]);
};

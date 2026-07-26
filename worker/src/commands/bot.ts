/**
 * `/bot`, ported from `src/commands/bot.ts`.
 *
 * Two deliberate changes from the Node handler.
 *
 * **The wallet-backed random variant is gone.** `src/commands/bot.ts:181`
 * called `getUserWallet(interaction.user.id)` from `src/lib/wallet-state`, the
 * only in-scope dependency on per-user storage. Decision 7 of the plan
 * reserves a KV namespace for that and says to build nothing, so there is no
 * wallet to look up. `random:true` now always picks uniformly from the full
 * supply, which is exactly what the Node handler did whenever no wallet was
 * linked, and the option's description no longer promises otherwise. Users who
 * want a random bot from a specific wallet still have `user:`, which takes an
 * address or an OpenSea username and needs no stored state. Nothing here
 * imports `wallet-state`, and nothing fails quietly.
 *
 * **The image is the first-party PNG.** It already was
 * (`src/commands/bot.ts:73`), and it must stay that way: OpenSea's `image_url`
 * for this contract is `image/svg+xml`, which Discord will not render. The
 * OpenSea call on this path supplies the owner and the rarity rank only.
 */

import { EmbedBuilder } from "@discordjs/builders";
import type { GlyphBotsClient } from "../api/glyphbots";
import { shortAddress } from "../api/glyphbots";
import type { OpenSeaClient } from "../api/opensea";
import { getOpenSeaUrl } from "../api/opensea";
import type { Bot, BotStory } from "../api/types";
import { COLORS, MAX_BOT_TOKEN_ID } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import { createLogger } from "../utils/logger";
import type { CommandHandler } from "./context";
import { BOT_NAME_PREFIX } from "./format";

const log = createLogger("BotCmd");

const STAT_BAR_SEGMENTS = 10;
const STAT_MAX = 100;
const TRAIT_LIMIT = 6;
const POWER_LIMIT = 3;

const statsBar = (value: number): string => {
  const filled = Math.floor(value / (STAT_MAX / STAT_BAR_SEGMENTS));
  return "█".repeat(filled) + "░".repeat(STAT_BAR_SEGMENTS - filled);
};

const STAT_ROWS: Array<[label: string, key: string]> = [
  ["STR", "strength"],
  ["AGI", "agility"],
  ["INT", "intellect"],
  ["LCK", "luck"],
  ["END", "endurance"],
  ["CHA", "charisma"],
];

const formatStatsBlock = (stats: BotStory["storyStats"]): string => {
  if (!stats) {
    return "";
  }
  return STAT_ROWS.map(([label, key]) => {
    const value = stats[key] ?? 0;
    return `${label} ${statsBar(value)} ${value}`;
  }).join("\n");
};

/** Uniform pick across the supply. The only random source now, see the note. */
const getRandomTokenId = (): number =>
  Math.floor(Math.random() * MAX_BOT_TOKEN_ID) + 1;

const buildBotEmbed = (
  tokenId: number,
  bot: Bot,
  story: BotStory | null,
  ownerAddress: string | null,
  rarityRank: number | null,
  glyphbots: GlyphBotsClient
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.bot)
    .setTitle(`GlyphBot #${tokenId}`)
    .setURL(glyphbots.getBotUrl(tokenId))
    .setDescription(`**${bot.name.replace(BOT_NAME_PREFIX, "")}**`)
    .setImage(glyphbots.getBotPngUrl(tokenId));

  if (ownerAddress) {
    embed.addFields({
      name: "Owner",
      value: `\`${shortAddress(ownerAddress)}\``,
      inline: true,
    });
  }

  if (rarityRank !== null) {
    embed.addFields({
      name: "Rarity",
      value: `#${rarityRank.toLocaleString()} / ${MAX_BOT_TOKEN_ID.toLocaleString()}`,
      inline: true,
    });
  }

  if (bot.traits.length > 0) {
    const traitList = bot.traits
      .filter((t) => t.value !== "None" && t.value !== "No")
      .slice(0, TRAIT_LIMIT)
      .map((t) => `**${t.trait_type}:** ${t.value}`)
      .join("\n");
    if (traitList) {
      embed.addFields({ name: "Traits", value: traitList, inline: true });
    }
  }

  if (story) {
    embed.addFields({
      name: "Role",
      value: `${story.arc.faction} • ${story.arc.role}`,
      inline: true,
    });

    const statsBlock = formatStatsBlock(story.storyStats);
    if (statsBlock) {
      embed.addFields({
        name: "Stats",
        value: `\`\`\`\n${statsBlock}\n\`\`\``,
      });
    }

    if (story.storyPowers && story.storyPowers.length > 0) {
      embed.addFields({
        name: "Powers",
        value: story.storyPowers.slice(0, POWER_LIMIT).join(" • "),
      });
    }
  }

  return embed.setFooter({ text: "GlyphBots" });
};

/** Pick a random bot held by an OpenSea account, by address or username. */
const randomFromAccount = async (
  opensea: OpenSeaClient,
  account: string
): Promise<number | null> => {
  const nfts = await opensea.fetchAccountNFTs(account);
  const pick = nfts[Math.floor(Math.random() * nfts.length)];
  return pick ? Number(pick.identifier) : null;
};

/** Resolve which token this invocation is about, or an error body. */
const resolveTokenId = async (
  ctx: Parameters<CommandHandler>[0]
): Promise<{ tokenId: number } | { error: ReturnType<typeof errorReply> }> => {
  const tokenIdOption = ctx.options.getInteger("id");
  const isRandom = ctx.options.getBoolean("random") ?? false;
  const userOption = ctx.options.getString("user");

  if (userOption) {
    const randomId = await randomFromAccount(ctx.opensea, userOption);
    if (randomId === null) {
      return {
        error: errorReply(
          "No GlyphBots Found",
          `No GlyphBots found for OpenSea user **${userOption}**.`
        ),
      };
    }
    log.info(`Random bot from user ${userOption}: #${randomId}`);
    return { tokenId: randomId };
  }

  if (isRandom) {
    const tokenId = getRandomTokenId();
    log.info(`Random bot: #${tokenId}`);
    return { tokenId };
  }

  if (tokenIdOption !== null) {
    return { tokenId: tokenIdOption };
  }

  return {
    error: errorReply(
      "Missing Bot ID",
      "Please provide a bot ID, use `random:true`, or specify a `user`."
    ),
  };
};

export const handleBot: CommandHandler = async (ctx) => {
  const resolved = await resolveTokenId(ctx);

  if ("error" in resolved) {
    return resolved.error;
  }

  const { tokenId } = resolved;

  const [bot, story, nft] = await Promise.all([
    ctx.glyphbots.fetchBot(tokenId),
    ctx.glyphbots.fetchBotStory(tokenId),
    ctx.opensea.fetchNFT(tokenId),
  ]);

  if (!bot) {
    return errorReply(
      "Bot Not Found",
      `GlyphBot #${tokenId} could not be found.`
    );
  }

  const embed = buildBotEmbed(
    tokenId,
    bot,
    story,
    nft?.owners?.[0]?.address ?? null,
    nft?.rarity?.rank ?? null,
    ctx.glyphbots
  );

  return embedReply(embed, [
    linkButtonRow([
      { label: "View Bot", url: ctx.glyphbots.getBotUrl(tokenId), emoji: "🤖" },
      { label: "OpenSea", url: getOpenSeaUrl(tokenId), emoji: "🌊" },
    ]),
  ]);
};

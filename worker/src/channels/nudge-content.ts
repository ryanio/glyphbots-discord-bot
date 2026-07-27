/**
 * What an idle nudge actually says.
 *
 * Four kinds, one message each, and none of them is a new embed design. The
 * bot and artifact kinds call the exported builders from `src/commands/bot.ts`
 * and `src/commands/artifact.ts`, so a nudge and a slash command render
 * identically and there is one place to change either. The two new shapes (a
 * collection fact, a notable bot) are built here, but out of the same
 * formatters in `src/commands/format.ts` and the same rarity table in
 * `src/commands/rarity.ts`.
 *
 * **No OpenSea image, here as everywhere.** `image_url` for these contracts is
 * `image/svg+xml` and Discord renders nothing for it, so bot art comes from
 * `getBotPngUrl` and artifact art from the GlyphBots API. The OpenSea types in
 * `../api/types.ts` omit the field, so this is a compile error rather than a
 * rule to remember.
 *
 * ## On the fun facts being true
 *
 * Every number printed here is read straight off a response and printed with
 * the same formatters `/floor` uses. Nothing is derived, averaged, compared to
 * a previous value or rounded into a claim the source did not make. A fact
 * whose input is missing, zero or not denominated in ETH is not offered at all,
 * which is why `collectionFacts` returns a list to choose from rather than a
 * single string: the choice is over what is actually available.
 */

import { EmbedBuilder } from "@discordjs/builders";
import type {
  APIEmbed,
  RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { getOpenSeaCollectionUrl } from "../api/opensea";
import type { ArtifactSummary, OpenSeaCollectionStats } from "../api/types";
import { artifactButtons, buildArtifactEmbed } from "../commands/artifact";
import { botButtons, buildBotEmbed } from "../commands/bot";
import {
  ethFloorPrice,
  finiteNumber,
  formatEthStat,
  formatNumber,
  formatTraitLine,
} from "../commands/format";
import {
  getRarityEmoji,
  getRarityTier,
  percentileOf,
} from "../commands/rarity";
import {
  COLORS,
  DEFAULT_GLYPHBOTS_API_URL,
  MAX_BOT_TOKEN_ID,
  NUDGE_NOTABLE_PERCENTILE,
  NUDGE_NOTABLE_SAMPLE,
  RANDOM_ARTIFACT_FETCH_LIMIT,
} from "../config";
import { linkButtonRow } from "../discord/buttons";
import type { LookupClients } from "../lookups/embeds";
import { createLogger } from "../utils/logger";
import type { NudgeKind } from "./idle";

const log = createLogger("Nudge");

export type NudgeContentDeps = {
  clients: LookupClients;
  /** 1 to `max` inclusive, matching the `#gallery` convention. */
  randomInt: (max: number) => number;
  /** Choose one of several equally good phrasings. `undefined` when empty. */
  pick: <T>(items: readonly T[]) => T | undefined;
};

const asEmbed = (embed: EmbedBuilder): APIEmbed => embed.toJSON() as APIEmbed;

// ── A random bot ───────────────────────────────────────────────────────────

/** Three calls, the same three `/bot` makes. */
const buildBotPost = async (
  deps: NudgeContentDeps
): Promise<RESTPostAPIChannelMessageJSONBody | null> => {
  const tokenId = deps.randomInt(MAX_BOT_TOKEN_ID);
  const { glyphbots, opensea } = deps.clients;

  const [bot, story, nft] = await Promise.all([
    glyphbots.fetchBot(tokenId),
    glyphbots.fetchBotStory(tokenId),
    opensea.fetchNFT(tokenId),
  ]);

  if (!bot) {
    log.warn(`Nudge picked bot #${tokenId}, which does not resolve`);
    return null;
  }

  const embed = buildBotEmbed(
    tokenId,
    bot,
    story,
    nft?.owners?.[0]?.address ?? null,
    nft?.rarity?.rank ?? null,
    glyphbots
  );

  return {
    embeds: [asEmbed(embed)],
    components: [linkButtonRow(botButtons(tokenId, glyphbots))],
  };
};

// ── A random minted artifact ───────────────────────────────────────────────

const buildArtifactPost = async (
  deps: NudgeContentDeps
): Promise<RESTPostAPIChannelMessageJSONBody | null> => {
  const { glyphbots } = deps.clients;
  const recent = await glyphbots.fetchRecentArtifacts(
    RANDOM_ARTIFACT_FETCH_LIMIT
  );
  // An artifact without a token id has not been minted, and half of what the
  // embed shows hangs off that id.
  const minted = recent.filter((artifact) => artifact.contractTokenId !== null);
  const chosen = deps.pick(minted);

  if (!chosen) {
    log.warn("Nudge found no minted artifacts to pick from");
    return null;
  }

  const embed = await buildArtifactEmbed(chosen, glyphbots);

  return {
    embeds: [asEmbed(embed)],
    components: [linkButtonRow(artifactButtons(chosen, glyphbots))],
  };
};

// ── A collection fact ──────────────────────────────────────────────────────

/** Where a fact came from, printed in the footer so the claim is attributable. */
export type FactSource = "OpenSea" | "glyphbots.com";

export type CollectionFact = {
  text: string;
  source: FactSource;
};

const plural = (count: number, word: string): string =>
  count === 1 ? word : `${word}s`;

/**
 * Every true thing this collection can say about itself right now.
 *
 * The gates are the interesting part. A zero-sales interval is dropped rather
 * than printed as "0 sales in the last 24 hours", which is technically true and
 * reads as bad news for no reason. A floor is only quoted when OpenSea says it
 * is denominated in ETH, because `formatEthStat` writes the unit in and a floor
 * quoted in the wrong currency would be a false statement rather than a
 * formatting slip. That rule and the missing-number guard both live in
 * `../commands/format.ts` now, so `/floor` applies the same ones.
 */
export const collectionFacts = (
  stats: OpenSeaCollectionStats | null,
  summary: ArtifactSummary | null
): CollectionFact[] => {
  const facts: CollectionFact[] = [];
  const supply = MAX_BOT_TOKEN_ID.toLocaleString();

  if (stats?.total) {
    const { total, intervals } = stats;
    const floor = ethFloorPrice(total);
    const volume = finiteNumber(total.volume);
    const sales = finiteNumber(total.sales);
    const owners = finiteNumber(total.num_owners);
    const average = finiteNumber(total.average_price);

    if (floor !== null && floor > 0) {
      facts.push({
        source: "OpenSea",
        text: `The floor is at **${formatEthStat(floor)}** on OpenSea right now.`,
      });
    }

    if (owners !== null && owners > 0) {
      facts.push({
        source: "OpenSea",
        text: `**${formatNumber(owners)}** wallets hold at least one of the ${supply} GlyphBots.`,
      });
    }

    if (sales !== null && sales > 0 && volume !== null && volume > 0) {
      facts.push({
        source: "OpenSea",
        text: `**${formatNumber(sales)}** GlyphBots have sold on OpenSea, for **${formatEthStat(volume)}** of volume all told.`,
      });
    }

    if (average !== null && average > 0 && floor !== null && floor > 0) {
      facts.push({
        source: "OpenSea",
        text: `A GlyphBot has sold for **${formatEthStat(average)}** on average. The floor today is **${formatEthStat(floor)}**.`,
      });
    }

    const oneDay = intervals?.find((entry) => entry.interval === "one_day");
    const oneDaySales = finiteNumber(oneDay?.sales);
    if (oneDaySales !== null && oneDaySales > 0) {
      facts.push({
        source: "OpenSea",
        text: `**${formatNumber(oneDaySales)}** ${plural(oneDaySales, "GlyphBot")} changed hands in the last 24 hours.`,
      });
    }

    const sevenDay = intervals?.find((entry) => entry.interval === "seven_day");
    const sevenDaySales = finiteNumber(sevenDay?.sales);
    const sevenDayVolume = finiteNumber(sevenDay?.volume);
    if (
      sevenDaySales !== null &&
      sevenDaySales > 0 &&
      sevenDayVolume !== null &&
      sevenDayVolume > 0
    ) {
      facts.push({
        source: "OpenSea",
        text: `**${formatNumber(sevenDaySales)}** ${plural(sevenDaySales, "sale")} in the last seven days, **${formatEthStat(sevenDayVolume)}** of volume between them.`,
      });
    }
  }

  if (summary) {
    if (summary.total > 0) {
      facts.push({
        source: "glyphbots.com",
        text: `**${formatNumber(summary.total)}** artifacts have been minted out of GlyphBots so far.`,
      });
    }
    if (summary.last7d > 0) {
      facts.push({
        source: "glyphbots.com",
        text: `**${summary.last7d}** ${plural(summary.last7d, "artifact")} minted in the last seven days, out of **${formatNumber(summary.total)}** all time.`,
      });
    }
    if (summary.last30d > 0) {
      facts.push({
        source: "glyphbots.com",
        text: `**${summary.last30d}** ${plural(summary.last30d, "artifact")} minted in the last 30 days.`,
      });
    }
    if (summary.last1d > 0) {
      facts.push({
        source: "glyphbots.com",
        text: `**${summary.last1d}** ${plural(summary.last1d, "artifact")} minted in the last 24 hours.`,
      });
    }
  }

  return facts;
};

/** Two calls, one to each source, then one of whatever came back. */
const buildFactPost = async (
  deps: NudgeContentDeps
): Promise<RESTPostAPIChannelMessageJSONBody | null> => {
  const [stats, summary] = await Promise.all([
    deps.clients.opensea.fetchCollectionStats(),
    deps.clients.glyphbots.fetchArtifactSummary(),
  ]);

  const fact = deps.pick(collectionFacts(stats, summary));

  if (!fact) {
    log.warn("Nudge had no collection fact worth posting");
    return null;
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.stats)
    .setTitle("📊 GlyphBots by the numbers")
    .setDescription(fact.text)
    .setFooter({ text: `Data from ${fact.source}` });

  return {
    embeds: [asEmbed(embed)],
    components: [
      linkButtonRow([
        {
          label: "View on OpenSea",
          url: getOpenSeaCollectionUrl(),
          emoji: "🌊",
        },
        { label: "GlyphBots", url: DEFAULT_GLYPHBOTS_API_URL, emoji: "🤖" },
      ]),
    ],
  };
};

// ── A notable bot ──────────────────────────────────────────────────────────

/** Rank at or below which the sample stops early. */
const notableRankCutoff = Math.ceil(
  (MAX_BOT_TOKEN_ID * NUDGE_NOTABLE_PERCENTILE) / 100
);

type Candidate = {
  tokenId: number;
  rank: number;
  name: string;
  traits: readonly { trait_type: string; value: string }[];
};

/**
 * Best of a few random draws.
 *
 * There is no reverse index from rank to token id anywhere in this system: the
 * rank arrives attached to a token, so finding a rare one means looking at
 * tokens. Sampling three and keeping the best is the compromise. It costs at
 * most three OpenSea reads, stops as soon as a draw lands in the top 10%, and
 * the post states the rank it actually found rather than claiming the bot is
 * the rarest of anything.
 */
const sampleNotableBot = async (
  deps: NudgeContentDeps
): Promise<Candidate | null> => {
  let best: Candidate | null = null;

  for (let draw = 0; draw < NUDGE_NOTABLE_SAMPLE; draw++) {
    const tokenId = deps.randomInt(MAX_BOT_TOKEN_ID);
    const nft = await deps.clients.opensea.fetchNFT(tokenId);
    const rank = nft?.rarity?.rank ?? null;

    if (!nft || rank === null || rank <= 0) {
      continue;
    }

    if (best === null || rank < best.rank) {
      best = {
        tokenId,
        rank,
        name: nft.name ?? `GlyphBot #${tokenId}`,
        traits: nft.traits ?? [],
      };
    }

    if (rank <= notableRankCutoff) {
      break;
    }
  }

  return best;
};

const buildNotablePost = async (
  deps: NudgeContentDeps
): Promise<RESTPostAPIChannelMessageJSONBody | null> => {
  const candidate = await sampleNotableBot(deps);

  if (!candidate) {
    log.warn("Nudge found no ranked bot in its sample");
    return null;
  }

  const { glyphbots } = deps.clients;
  const { rank, tokenId } = candidate;

  const embed = new EmbedBuilder()
    .setColor(COLORS.rarity)
    .setTitle(`${getRarityEmoji(rank)} ${candidate.name}`)
    .setURL(glyphbots.getBotUrl(tokenId))
    .setDescription(
      [
        `**Rarity Rank:** #${rank.toLocaleString()} / ${MAX_BOT_TOKEN_ID.toLocaleString()}`,
        `**Tier:** ${getRarityTier(rank)}`,
        `Rarer than ${(100 - percentileOf(rank)).toFixed(1)}% of the collection.`,
      ].join("\n")
    )
    .setImage(glyphbots.getBotPngUrl(tokenId))
    .setFooter({ text: "Rarity calculated by OpenRarity" });

  const traitLine = formatTraitLine(candidate.traits);
  if (traitLine) {
    embed.addFields({ name: "Traits", value: traitLine });
  }

  return {
    embeds: [asEmbed(embed)],
    components: [linkButtonRow(botButtons(tokenId, glyphbots))],
  };
};

/**
 * One nudge body, or `null` when this kind has nothing to say right now.
 *
 * `null` is not an error: a random token id can be a burned bot, the artifact
 * list can be empty, and OpenSea can be down. The caller moves to the next kind
 * in the rotation and, failing that, waits an hour.
 */
export const buildNudgePost = (
  kind: NudgeKind,
  deps: NudgeContentDeps
): Promise<RESTPostAPIChannelMessageJSONBody | null> => {
  switch (kind) {
    case "bot":
      return buildBotPost(deps);
    case "artifact":
      return buildArtifactPost(deps);
    case "stat":
      return buildFactPost(deps);
    case "notable":
      return buildNotablePost(deps);
  }
};

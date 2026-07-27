/**
 * `/floor`, ported from `src/commands/floor.ts`.
 *
 * The deferral moved out (see `src/discord/interactions.ts`); the handler now
 * returns the message body instead of calling `editReply`. Field order, copy
 * and number formatting are unchanged.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { getOpenSeaCollectionUrl } from "../api/opensea";
import { COLORS, DEFAULT_GLYPHBOTS_API_URL } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import type { CommandHandler } from "./context";
import {
  ethFloorPrice,
  finiteNumber,
  formatEthStat,
  formatNumber,
  formatPercentChange,
} from "./format";

/** What a field shows when the number behind it is missing or unquotable. */
const ABSENT = "—";

const stat = (
  value: number | null,
  format: (value: number) => string
): string => (value === null ? ABSENT : format(value));

export const handleFloor: CommandHandler = async (ctx) => {
  const stats = await ctx.opensea.fetchCollectionStats();

  if (!stats) {
    return errorReply(
      "❌ Error",
      "Failed to fetch GlyphBots collection stats."
    );
  }

  // Every read below goes through a guard rather than straight off the
  // response. The declared types say all of this is present; a partial index at
  // OpenSea says otherwise, and one missing field used to take the whole
  // handler down with a throw instead of costing one line of the answer.
  const total = stats.total as Partial<typeof stats.total> | undefined;
  const intervals = stats.intervals ?? [];
  const oneDay = intervals.find((i) => i.interval === "one_day");
  const sevenDay = intervals.find((i) => i.interval === "seven_day");
  const thirtyDay = intervals.find((i) => i.interval === "thirty_day");

  const embed = new EmbedBuilder()
    .setColor(COLORS.stats)
    .setTitle("📊 GlyphBots Collection Stats")
    .addFields(
      {
        // Only quoted when OpenSea says the floor is denominated in ETH. See
        // `ethFloorPrice`: the unit is written into the string, so quoting a
        // floor priced in something else states something untrue.
        name: "💎 Floor Price",
        value: stat(ethFloorPrice(total), formatEthStat),
        inline: true,
      },
      {
        name: "👥 Owners",
        value: stat(finiteNumber(total?.num_owners), formatNumber),
        inline: true,
      },
      {
        name: "📈 Total Volume",
        value: stat(finiteNumber(total?.volume), formatEthStat),
        inline: true,
      },
      {
        name: "🔄 24h Volume",
        value: stat(finiteNumber(oneDay?.volume), formatEthStat),
        inline: true,
      },
      {
        name: "📊 24h Sales",
        value: stat(finiteNumber(oneDay?.sales), formatNumber),
        inline: true,
      },
      {
        name: "📈 7d Change",
        value: stat(finiteNumber(sevenDay?.volume_change), formatPercentChange),
        inline: true,
      },
      {
        name: "🏷️ Avg Price",
        value: stat(finiteNumber(total?.average_price), formatEthStat),
        inline: true,
      },
      {
        name: "📊 Total Sales",
        value: stat(finiteNumber(total?.sales), formatNumber),
        inline: true,
      },
      {
        name: "📈 30d Sales",
        value: stat(finiteNumber(thirtyDay?.sales), formatNumber),
        inline: true,
      }
    )
    .setFooter({ text: "Data from OpenSea" })
    .setTimestamp();

  return embedReply(embed, [
    linkButtonRow([
      {
        label: "View on OpenSea",
        url: getOpenSeaCollectionUrl(),
        emoji: "🌊",
      },
      {
        label: "Mint a GlyphBot",
        url: DEFAULT_GLYPHBOTS_API_URL,
        emoji: "🤖",
      },
    ]),
  ]);
};

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
import { formatEthStat, formatNumber, formatPercentChange } from "./format";

export const handleFloor: CommandHandler = async (ctx) => {
  const stats = await ctx.opensea.fetchCollectionStats();

  if (!stats) {
    return errorReply(
      "❌ Error",
      "Failed to fetch GlyphBots collection stats."
    );
  }

  const { total, intervals } = stats;
  const oneDay = intervals.find((i) => i.interval === "one_day");
  const sevenDay = intervals.find((i) => i.interval === "seven_day");
  const thirtyDay = intervals.find((i) => i.interval === "thirty_day");

  const embed = new EmbedBuilder()
    .setColor(COLORS.stats)
    .setTitle("📊 GlyphBots Collection Stats")
    .addFields(
      {
        name: "💎 Floor Price",
        value: formatEthStat(total.floor_price),
        inline: true,
      },
      { name: "👥 Owners", value: formatNumber(total.num_owners), inline: true },
      {
        name: "📈 Total Volume",
        value: formatEthStat(total.volume),
        inline: true,
      },
      {
        name: "🔄 24h Volume",
        value: oneDay ? formatEthStat(oneDay.volume) : "—",
        inline: true,
      },
      {
        name: "📊 24h Sales",
        value: oneDay ? formatNumber(oneDay.sales) : "—",
        inline: true,
      },
      {
        name: "📈 7d Change",
        value: sevenDay ? formatPercentChange(sevenDay.volume_change) : "—",
        inline: true,
      },
      {
        name: "🏷️ Avg Price",
        value: formatEthStat(total.average_price),
        inline: true,
      },
      {
        name: "📊 Total Sales",
        value: formatNumber(total.sales),
        inline: true,
      },
      {
        name: "📈 30d Sales",
        value: thirtyDay ? formatNumber(thirtyDay.sales) : "—",
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

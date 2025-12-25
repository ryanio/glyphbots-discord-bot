/**
 * Arena Recap Content
 *
 * Daily battle summaries and leaderboard updates.
 */

import {
  type ActionRowBuilder,
  type ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  getLeaderboard,
  getRecentBattles,
  getServerStats,
} from "../arena/tracking";
import {
  createButton,
  createButtonRowWithButtons,
} from "../lib/discord/buttons";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("Recap");

/** Recap brand color */
const RECAP_COLOR: HexColorString = "#ff4444";

/**
 * Generate an arena recap embed with buttons
 */
export const generateRecap = async (): Promise<{
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} | null> => {
  log.info("Generating arena recap");

  const [serverStats, leaderboard, recentBattles] = await Promise.all([
    getServerStats(),
    getLeaderboard(5),
    getRecentBattles(5),
  ]);

  const embed = new EmbedBuilder()
    .setColor(RECAP_COLOR)
    .setTitle("📰 ARENA RECAP")
    .setDescription("*The latest from the battlegrounds...*");

  // Server stats
  embed.addFields({
    name: "📊 Arena Statistics",
    value: [
      `**Total Battles:** ${serverStats.totalBattles}`,
      `**Total Rounds:** ${serverStats.totalRounds}`,
      `**Epic Victories:** ${serverStats.epicVictories}`,
      `**Unique Fighters:** ${serverStats.uniqueFighters}`,
    ].join("\n"),
    inline: true,
  });

  // Leaderboard
  if (leaderboard.length > 0) {
    const getMedal = (rank: number): string => {
      const medals = ["🥇", "🥈", "🥉"];
      if (rank < medals.length) {
        return medals[rank];
      }
      return `${rank + 1}.`;
    };
    const leaderboardText = leaderboard
      .map((user, i) => {
        const medal = getMedal(i);
        return `${medal} **${user.username}** - ${user.wins}W/${user.losses}L (${user.bestStreak}🔥)`;
      })
      .join("\n");

    embed.addFields({
      name: "🏆 Top Fighters",
      value: leaderboardText || "No battles yet!",
      inline: true,
    });
  } else {
    embed.addFields({
      name: "🏆 Top Fighters",
      value: "No battles recorded yet!\nBe the first with `/arena challenge`",
      inline: true,
    });
  }

  // Recent battles
  if (recentBattles.length > 0) {
    const battlesText = recentBattles
      .slice(0, 3)
      .map((battle) => {
        const winnerIsRed = battle.winnerId === battle.redFighterUserId;
        const winner = winnerIsRed ? battle.redBotName : battle.blueBotName;
        const loser = winnerIsRed ? battle.blueBotName : battle.redBotName;
        const epic = battle.epicVictory ? " 🌟" : "";
        return `**${winner}** defeated ${loser} (R${battle.rounds})${epic}`;
      })
      .join("\n");

    embed.addFields({
      name: "⚔️ Recent Battles",
      value: battlesText,
    });
  }

  embed.setFooter({
    text: "⚔️ Join the arena with /arena challenge!",
  });

  // Build buttons
  const buttons = createButtonRowWithButtons(
    createButton(
      "playground_arena_challenge",
      "Challenge Someone",
      ButtonStyle.Primary,
      "⚔️"
    )
  );

  const actionButtons = createButtonRowWithButtons(
    createButton(
      "playground_request_spotlight",
      "Request Spotlight",
      ButtonStyle.Secondary,
      "🌟"
    ),
    createButton(
      "playground_request_discovery",
      "Request Discovery",
      ButtonStyle.Secondary,
      "🎒"
    ),
    createButton(
      "playground_request_encounter",
      "Request Encounter",
      ButtonStyle.Secondary,
      "🎲"
    )
  );

  const actionButtons2 = createButtonRowWithButtons(
    createButton(
      "playground_request_postcard",
      "Request Postcard",
      ButtonStyle.Secondary,
      "🌍"
    ),
    createButton(
      "playground_request_help",
      "Request Help",
      ButtonStyle.Secondary,
      "❓"
    )
  );

  return { embed, components: [buttons, actionButtons, actionButtons2] };
};

/**
 * /stats Command Handler
 *
 * View GlyphBots statistics.
 */

import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { fetchBot, getBotUrl } from "../api/glyphbots";
import {
  getBotStats,
  getLeaderboard,
  getServerStats,
  getUserStats,
} from "../arena/tracking";
import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("StatsCmd");

/** Stats brand color */
const STATS_COLOR: HexColorString = "#00ff88";

/**
 * Handle /stats me
 */
const handleStatsMe = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const userId = interaction.user.id;
  const userStats = await getUserStats(userId);

  const embed = new EmbedBuilder()
    .setColor(STATS_COLOR)
    .setTitle(`◉ ${interaction.user.username}'s Stats ◉`)
    .setThumbnail(interaction.user.displayAvatarURL());

  if (userStats) {
    const winRate =
      userStats.wins + userStats.losses > 0
        ? Math.round(
            (userStats.wins / (userStats.wins + userStats.losses)) * 100
          )
        : 0;

    embed.addFields(
      {
        name: "⚔ Arena Record ⚔",
        value: [
          `**Wins:** ${userStats.wins}`,
          `**Losses:** ${userStats.losses}`,
          `**Win Rate:** ${winRate}%`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "✦ Streaks ✦",
        value: [
          `**Current:** ${userStats.currentStreak} wins`,
          `**Best Ever:** ${userStats.bestStreak} wins`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "◈ Achievements ◈",
        value: [
          `**Epic Victories:** ${userStats.epicVictories}`,
          `**Total Rounds:** ${userStats.totalRounds}`,
        ].join("\n"),
        inline: true,
      }
    );

    if (userStats.lastBattleAt) {
      const lastBattle = new Date(userStats.lastBattleAt);
      embed.setFooter({
        text: `Last battle: ${lastBattle.toLocaleDateString()}`,
      });
    }
  } else {
    embed.setDescription(
      "You haven't participated in any arena battles yet!\n\nStart your journey with `/arena challenge`"
    );
  }

  await interaction.reply({ embeds: [embed] });
};

/**
 * Handle /stats arena
 */
const handleStatsArena = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const targetUser = interaction.options.getUser("user") ?? interaction.user;
  const userStats = await getUserStats(targetUser.id);

  const embed = new EmbedBuilder()
    .setColor(STATS_COLOR)
    .setTitle(`⚔ Arena Stats: ${targetUser.username} ⚔`)
    .setThumbnail(targetUser.displayAvatarURL());

  if (userStats) {
    const winRate =
      userStats.wins + userStats.losses > 0
        ? Math.round(
            (userStats.wins / (userStats.wins + userStats.losses)) * 100
          )
        : 0;

    embed.addFields(
      {
        name: "◉ Overall ◉",
        value: [
          `**Total Battles:** ${userStats.wins + userStats.losses}`,
          `**Wins:** ${userStats.wins} │ **Losses:** ${userStats.losses}`,
          `**Win Rate:** ${winRate}%`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "✦ Streaks ✦",
        value: [
          `**Current:** ${userStats.currentStreak} wins`,
          `**Best Ever:** ${userStats.bestStreak} wins`,
          `**Epic Victories:** ${userStats.epicVictories}`,
        ].join("\n"),
        inline: true,
      }
    );
  } else {
    embed.setDescription(
      `${targetUser.username} hasn't participated in any arena battles yet!`
    );
  }

  await interaction.reply({ embeds: [embed] });
};

/**
 * Handle /stats server
 */
const handleStatsServer = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const serverStats = await getServerStats();
  const leaderboard = await getLeaderboard(5);

  const embed = new EmbedBuilder()
    .setColor(STATS_COLOR)
    .setTitle("◉ Server Arena Statistics ◉");

  embed.addFields({
    name: "◉ Overall ◉",
    value: [
      `**Total Battles:** ${serverStats.totalBattles}`,
      `**Total Rounds:** ${serverStats.totalRounds}`,
      `**Epic Victories:** ${serverStats.epicVictories}`,
      `**Unique Fighters:** ${serverStats.uniqueFighters}`,
      `**Bots Used:** ${serverStats.uniqueBots}`,
    ].join("\n"),
    inline: true,
  });

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
        return `${medal} **${user.username}** - ${user.wins}W/${user.losses}L`;
      })
      .join("\n");

    embed.addFields({
      name: "✦ Top Fighters ✦",
      value: leaderboardText,
      inline: true,
    });
  }

  await interaction.reply({ embeds: [embed] });
};

/**
 * Handle /stats bot
 */
const handleStatsBot = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const tokenId = interaction.options.getInteger("id", true);
  await interaction.deferReply();

  log.info(`Bot stats requested for #${tokenId}`);

  const [bot, botStats] = await Promise.all([
    fetchBot(tokenId),
    getBotStats(tokenId),
  ]);

  if (!bot) {
    await interaction.editReply({
      content: `◈ Bot #${tokenId} not found.`,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(STATS_COLOR)
    .setTitle(`◈ Combat Stats: ${bot.name} ◈`)
    .setURL(getBotUrl(tokenId));

  if (botStats) {
    const winRate =
      botStats.wins + botStats.losses > 0
        ? Math.round((botStats.wins / (botStats.wins + botStats.losses)) * 100)
        : 0;

    const avgDamageDealt =
      botStats.battlesParticipated > 0
        ? Math.round(botStats.totalDamageDealt / botStats.battlesParticipated)
        : 0;

    const avgDamageTaken =
      botStats.battlesParticipated > 0
        ? Math.round(botStats.totalDamageTaken / botStats.battlesParticipated)
        : 0;

    embed.addFields(
      {
        name: "⚔ Battle Record ⚔",
        value: [
          `**Wins:** ${botStats.wins}`,
          `**Losses:** ${botStats.losses}`,
          `**Win Rate:** ${winRate}%`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "◉ Combat Stats ◉",
        value: [
          `**Avg Damage/Battle:** ${avgDamageDealt}`,
          `**Avg Taken/Battle:** ${avgDamageTaken}`,
          `**Critical Hits:** ${botStats.criticalHits}`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "◈ Totals ◈",
        value: [
          `**Battles:** ${botStats.battlesParticipated}`,
          `**Total Damage:** ${botStats.totalDamageDealt}`,
          `**Total Taken:** ${botStats.totalDamageTaken}`,
        ].join("\n"),
        inline: true,
      }
    );
  } else {
    embed.setDescription(
      `${bot.name} hasn't participated in any arena battles yet!\n\nBring them into the fight with \`/arena challenge bot:${tokenId}\``
    );
  }

  await interaction.editReply({ embeds: [embed] });
};

/**
 * Handle /stats command
 */
export const handleStats = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "me":
      await handleStatsMe(interaction);
      break;
    case "arena":
      await handleStatsArena(interaction);
      break;
    case "server":
      await handleStatsServer(interaction);
      break;
    case "bot":
      await handleStatsBot(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown stats command.",
        ephemeral: true,
      });
  }
};

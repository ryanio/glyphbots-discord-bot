/**
 * /arena Command Handler
 *
 * Handles arena battle commands.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import { fetchBot, fetchBotStory, getBotUrl } from "../api/glyphbots";
import {
  createBattle,
  createFighterState,
  forfeitBattle,
  getAllBattles,
  getUserBattle,
  isUserInBattle,
  setAnnouncementMessage,
} from "../arena/state";
import { arenaQuickstart } from "../help/embeds";
import { prefixedLogger } from "../lib/logger";
import type { Config } from "../lib/types";

const log = prefixedLogger("ArenaCmd");

/** Arena brand color */
const ARENA_COLOR: HexColorString = "#ff4444";

/** Error color */
const ERROR_COLOR: HexColorString = "#ff4444";

/** Success color */
const SUCCESS_COLOR: HexColorString = "#00ff88";

type ChallengeEmbedOpts = {
  userId: string;
  username: string;
  botName: string;
  tokenId: number;
  faction: string | null;
  role: string | null;
  stats: Record<string, number> | null;
};

/**
 * Build challenge announcement embed
 */
const buildChallengeEmbed = (opts: ChallengeEmbedOpts): EmbedBuilder => {
  const { userId, botName, tokenId, faction, role, stats } = opts;
  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle("⚔ ═══ ARENA CHALLENGE ═══")
    .setDescription(
      [
        "",
        `▸ **CHALLENGER:** <@${userId}>`,
        `▸ **${botName}** ([#${tokenId}](${getBotUrl(tokenId)}))`,
        faction ? `├─ Faction: ${faction}` : "",
        role ? `└─ Role: ${role}` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n")
    );

  if (stats) {
    embed.addFields({
      name: "◉ Stats",
      value: `STR ${stats.strength ?? 0} │ AGI ${stats.agility ?? 0} │ INT ${stats.intellect ?? 0}`,
      inline: true,
    });
  }

  embed.addFields({
    name: "⏱ Time Remaining",
    value: "Accepting challengers for **2:00**...",
    inline: true,
  });

  embed.setFooter({ text: "Who dares face this challenger?" });

  return embed;
};

/**
 * Build challenge buttons
 */
const buildChallengeButtons = (
  battleId: string
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`arena_accept_${battleId}`)
      .setLabel("Accept Challenge")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🎯"),
    new ButtonBuilder()
      .setCustomId(`arena_watch_${battleId}`)
      .setLabel("Watch")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("👁️")
  );

/**
 * Handle /arena challenge
 */
const handleChallenge = async (
  interaction: ChatInputCommandInteraction,
  config: Config
): Promise<void> => {
  const tokenId = interaction.options.getInteger("bot", true);
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // Check if arena channel is configured
  if (!config.arenaChannelId) {
    await interaction.reply({
      content: "⚔ Arena is not configured for this server.",
      ephemeral: true,
    });
    return;
  }

  // Check if user is already in a battle
  if (isUserInBattle(userId)) {
    await interaction.reply({
      content:
        "◈ You are already in an active battle. Use `/arena forfeit` to surrender.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  // Fetch bot data
  const bot = await fetchBot(tokenId);
  if (!bot) {
    const errorEmbed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("▸ Bot Not Found")
      .setDescription(`Bot #${tokenId} could not be found.`);

    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  // Fetch story for stats
  const story = await fetchBotStory(tokenId);

  // Create fighter state
  const challenger = createFighterState(userId, username, bot, story);

  // Create battle
  const battle = createBattle(
    config.arenaChannelId,
    challenger,
    config.arenaMaxRounds
  );

  // Build and send challenge announcement
  const embed = buildChallengeEmbed({
    userId,
    username,
    botName: bot.name,
    tokenId: bot.tokenId,
    faction: story?.arc?.faction ?? null,
    role: story?.arc?.role ?? null,
    stats: story?.storyStats ?? null,
  });

  const buttons = buildChallengeButtons(battle.id);

  const reply = await interaction.editReply({
    embeds: [embed],
    components: [buttons],
  });

  // Store message ID for later updates
  setAnnouncementMessage(battle, reply.id);

  log.info(`Challenge created: ${username} with ${bot.name} (${battle.id})`);
};

/**
 * Handle /arena stats
 */
const handleStats = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const targetUser = interaction.options.getUser("user") ?? interaction.user;

  // For now, show placeholder stats
  // Will be implemented with proper tracking in Phase 3
  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(`⚔ Arena Stats: ${targetUser.username}`)
    .addFields(
      {
        name: "◉ Overall",
        value: [
          "**Total Battles:** 0",
          "**Wins:** 0 │ **Losses:** 0",
          "**Win Rate:** N/A",
        ].join("\n"),
        inline: true,
      },
      {
        name: "✦ Streaks",
        value: ["**Current:** 0 wins", "**Best Ever:** 0 wins"].join("\n"),
        inline: true,
      }
    )
    .setFooter({ text: "Battle stats are tracked from your arena fights." });

  await interaction.reply({ embeds: [embed] });
};

/**
 * Handle /arena leaderboard
 */
const handleLeaderboard = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  // Placeholder leaderboard - will be implemented in Phase 3
  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle("✦ ═══ Arena Leaderboard ═══")
    .setDescription("Top fighters this season")
    .addFields({
      name: "◉ Rankings",
      value:
        "No battles recorded yet.\n\nStart a fight with `/arena challenge` to be the first on the leaderboard.",
    })
    .setFooter({ text: "Rankings update after each battle" });

  await interaction.reply({ embeds: [embed] });
};

/**
 * Handle /arena history
 */
const handleHistory = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  // Get active battles for now
  const activeBattles = getAllBattles();

  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle("✦ Arena History")
    .setDescription("Recent battles in the arena");

  if (activeBattles.length === 0) {
    embed.addFields({
      name: "⚔ Active Battles",
      value: "No active battles right now. Start one with `/arena challenge`.",
    });
  } else {
    const battleList = activeBattles
      .slice(0, 5)
      .map((battle) => {
        const status =
          battle.phase === "challenge" ? "◉ Open" : `⚔ Round ${battle.round}`;
        const vs = battle.blueFighter
          ? `⟷ ${battle.blueFighter.bot.name}`
          : "awaiting opponent";
        return `${status} **${battle.redFighter.bot.name}** ${vs}`;
      })
      .join("\n");

    embed.addFields({
      name: `⚔ Active Battles (${activeBattles.length})`,
      value: battleList,
    });
  }

  embed.setFooter({ text: "Full battle history coming soon." });

  await interaction.reply({ embeds: [embed] });
};

/**
 * Handle /arena forfeit
 */
const handleForfeit = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const userId = interaction.user.id;

  const battle = getUserBattle(userId);
  if (!battle) {
    await interaction.reply({
      content: "▸ You are not in an active battle.",
      ephemeral: true,
    });
    return;
  }

  const success = forfeitBattle(battle, userId);
  if (!success) {
    await interaction.reply({
      content: "▸ Unable to forfeit this battle.",
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle("▸ Battle Forfeited")
    .setDescription(
      "You have surrendered the battle. Your opponent wins by forfeit."
    );

  await interaction.reply({ embeds: [embed] });

  // TODO: Update battle thread with forfeit message
};

/**
 * Handle /arena help
 */
const handleArenaHelp = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  await interaction.reply({ embeds: [arenaQuickstart] });
};

/**
 * Handle /arena command
 */
export const handleArena = async (
  interaction: ChatInputCommandInteraction,
  config: Config
): Promise<void> => {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "challenge":
      await handleChallenge(interaction, config);
      break;
    case "stats":
      await handleStats(interaction);
      break;
    case "leaderboard":
      await handleLeaderboard(interaction);
      break;
    case "history":
      await handleHistory(interaction);
      break;
    case "forfeit":
      await handleForfeit(interaction);
      break;
    case "help":
      await handleArenaHelp(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown arena command.",
        ephemeral: true,
      });
  }
};

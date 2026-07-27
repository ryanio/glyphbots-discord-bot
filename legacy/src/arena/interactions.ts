/**
 * Arena Interaction Handlers
 *
 * Handles button clicks and select menu interactions for arena battles.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type HexColorString,
  type SelectMenuComponentOptionData,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { fetchBot, fetchBotStory } from "../api/glyphbots";
import { prefixedLogger } from "../lib/logger";
import type { Config } from "../lib/types";
import { getFighterAbilities } from "./combat";
import { applyCrowdAction, type CrowdAction } from "./spectators";
import {
  acceptChallenge,
  addPendingSpectator,
  type BattleState,
  cancelChallenge,
  createFighterState,
  getBattle,
  getBattleByThread,
  getUserBattle,
  isUserInBattle,
  type Stance,
  setFighterAction,
  setFighterStance,
} from "./state";
import {
  buildPreBattleEmbed,
  createBattleThread,
  updateChallengeAnnouncement,
} from "./threads";

const log = prefixedLogger("ArenaInteract");

/** Arena brand color */
const ARENA_COLOR: HexColorString = "#ff4444";

/** Error color */
const ERROR_COLOR: HexColorString = "#ff4444";

/**
 * Build stance selection buttons
 */
export const buildStanceButtons = (
  odwerId: string
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`stance_aggressive_${odwerId}`)
      .setLabel("Aggressive")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("⚡"),
    new ButtonBuilder()
      .setCustomId(`stance_defensive_${odwerId}`)
      .setLabel("Defensive")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🛡️"),
    new ButtonBuilder()
      .setCustomId(`stance_deceptive_${odwerId}`)
      .setLabel("Deceptive")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🎭")
  );

/**
 * Build ability selection menu
 */
export const buildAbilityMenu = (
  battle: BattleState,
  odwerId: string
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const fighter =
    battle.redFighter.userId === odwerId
      ? battle.redFighter
      : battle.blueFighter;

  if (!fighter) {
    throw new Error("Fighter not found in battle");
  }

  const abilities = getFighterAbilities(fighter);
  const getAbilityEmoji = (type: string): string => {
    if (type === "attack") {
      return "⚔️";
    }
    if (type === "defensive") {
      return "🛡️";
    }
    return "✨";
  };
  const options: SelectMenuComponentOptionData[] = abilities.map((ability) => ({
    label: ability.name,
    description: ability.effect.slice(0, 50),
    value: ability.name,
    emoji: getAbilityEmoji(ability.type),
  }));

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ability_${odwerId}`)
      .setPlaceholder("Choose your action...")
      .addOptions(options)
  );
};

/**
 * Build spectator action buttons
 */
export const buildSpectatorButtons = (
  battleId: string
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`cheer_red_${battleId}`)
      .setLabel("Cheer Red")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔴"),
    new ButtonBuilder()
      .setCustomId(`cheer_blue_${battleId}`)
      .setLabel("Cheer Blue")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🔵"),
    new ButtonBuilder()
      .setCustomId(`bloodlust_${battleId}`)
      .setLabel("Bloodlust")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("💀"),
    new ButtonBuilder()
      .setCustomId(`surge_${battleId}`)
      .setLabel("Surge")
      .setStyle(ButtonStyle.Success)
      .setEmoji("⚡")
  );

/**
 * Handle Accept Challenge button
 */
export const handleAcceptChallenge = async (
  interaction: ButtonInteraction,
  battleId: string,
  _config: Config
): Promise<void> => {
  const userId = interaction.user.id;
  const _username = interaction.user.username;

  // Get the battle
  const battle = getBattle(battleId);
  if (!battle) {
    await interaction.reply({
      content: "◈ This challenge has expired or no longer exists.",
      ephemeral: true,
    });
    return;
  }

  // Check if challenge phase
  if (battle.phase !== "challenge") {
    await interaction.reply({
      content: "◈ This challenge has already been accepted.",
      ephemeral: true,
    });
    return;
  }

  // Check if user is the challenger
  if (battle.redFighter.userId === userId) {
    await interaction.reply({
      content: "◈ You cannot accept your own challenge.",
      ephemeral: true,
    });
    return;
  }

  // Check if user is already in a battle
  if (isUserInBattle(userId)) {
    const userBattle = getUserBattle(userId);
    if (userBattle?.phase === "challenge") {
      await interaction.reply({
        content:
          "◈ You already have an active challenge! Use `/arena cancel` to cancel it first.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content:
          "◈ You are already in an active battle! Use `/arena forfeit` to surrender.",
        ephemeral: true,
      });
    }
    return;
  }

  // Prompt user to select their bot
  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle("▸ Select Your Fighter")
    .setDescription(
      "Enter your bot's token ID to fight!\n\nUse `/info bot id:<number>` to check bot stats before choosing."
    )
    .setFooter({ text: "The battle will begin once you select your bot." });

  // For now, we'll use a simple prompt. In a full implementation,
  // you might want to show owned bots from wallet connection.
  const menu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`select_bot_${battleId}_${userId}`)
      .setPlaceholder("Enter a bot ID (1-11111)...")
      .addOptions(
        // Quick picks for demonstration
        {
          label: "Random Bot #1234",
          value: "1234",
          description: "Select bot #1234",
        },
        {
          label: "Random Bot #5678",
          value: "5678",
          description: "Select bot #5678",
        },
        {
          label: "Random Bot #4421",
          value: "4421",
          description: "Select bot #4421",
        }
      )
  );

  await interaction.reply({
    embeds: [embed],
    components: [menu],
    ephemeral: true,
  });
};

/**
 * Handle bot selection for accepting challenge
 */
export const handleBotSelection = async (
  interaction: StringSelectMenuInteraction,
  battleId: string,
  odwerId: string,
  config: Config
): Promise<void> => {
  const tokenId = Number.parseInt(interaction.values[0], 10);
  const username = interaction.user.username;

  if (Number.isNaN(tokenId) || tokenId < 1 || tokenId > 11_111) {
    await interaction.reply({
      content: "◈ Invalid bot ID selected.",
      ephemeral: true,
    });
    return;
  }

  const battle = getBattle(battleId);
  if (!battle || battle.phase !== "challenge") {
    await interaction.reply({
      content: "◈ This challenge is no longer available.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  // Fetch bot and story
  const bot = await fetchBot(tokenId);
  if (!bot) {
    await interaction.followUp({
      content: `❌ Bot #${tokenId} not found.`,
      ephemeral: true,
    });
    return;
  }

  const story = await fetchBotStory(tokenId);

  // Create fighter state
  const opponent = createFighterState(odwerId, username, bot, story);

  // Accept the challenge
  const success = acceptChallenge(battle, opponent);
  if (!success) {
    await interaction.followUp({
      content: "◈ Failed to accept challenge.",
      ephemeral: true,
    });
    return;
  }

  // Create battle thread
  const thread = await createBattleThread(interaction, battle);
  if (!thread) {
    await interaction.followUp({
      content: "◈ Failed to create battle thread.",
      ephemeral: true,
    });
    return;
  }

  // Update the original challenge announcement
  if (
    battle.announcementMessageId &&
    interaction.channel?.type === ChannelType.GuildText
  ) {
    await updateChallengeAnnouncement(
      interaction.channel as TextChannel,
      battle.announcementMessageId,
      battle,
      thread.id
    );
  }

  // Post pre-battle message with stance selection
  const preBattleEmbed = buildPreBattleEmbed(
    battle,
    config.arenaRoundTimeoutSeconds
  );

  const redStanceButtons = buildStanceButtons(battle.redFighter.userId);
  const blueUserId = battle.blueFighter?.userId ?? "";
  const blueStanceButtons = buildStanceButtons(blueUserId);

  await thread.send({
    content: `⚔ **Battle Thread Created!**\n\n<@${battle.redFighter.userId}> and <@${battle.blueFighter?.userId}>, choose your opening stance!`,
    embeds: [preBattleEmbed],
    components: [redStanceButtons, blueStanceButtons],
  });

  await interaction.editReply({
    content: `◈ You've entered the arena with **${bot.name}**. Head to <#${thread.id}> to fight.`,
    components: [],
    embeds: [],
  });

  log.info(`Battle ${battleId} accepted: ${username} with ${bot.name}`);
};

/**
 * Handle Watch button
 */
export const handleWatch = async (
  interaction: ButtonInteraction,
  battleId: string
): Promise<void> => {
  const battle = getBattle(battleId);
  if (!battle) {
    await interaction.reply({
      content: "◈ This challenge no longer exists.",
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;

  // Add to pending spectators
  addPendingSpectator(battle, userId);

  await interaction.reply({
    content:
      "◉ You'll be notified when the battle starts and added to the battle thread.",
    ephemeral: true,
  });

  log.info(`User ${userId} watching battle ${battleId}`);
};

/**
 * Handle Cancel Challenge button
 */
export const handleCancelChallenge = async (
  interaction: ButtonInteraction,
  battleId: string,
  challengerUserId: string,
  _config: Config
): Promise<void> => {
  const userId = interaction.user.id;

  if (userId !== challengerUserId) {
    await interaction.reply({
      content: "◈ Only the challenger can cancel this challenge.",
      ephemeral: true,
    });
    return;
  }

  const battle = getBattle(battleId);
  if (!battle) {
    await interaction.reply({
      content: "◈ This challenge no longer exists.",
      ephemeral: true,
    });
    return;
  }

  if (battle.phase !== "challenge") {
    await interaction.reply({
      content:
        "◈ This challenge has already been accepted. Use `/arena forfeit` to surrender.",
      ephemeral: true,
    });
    return;
  }

  const success = cancelChallenge(battle, userId);
  if (!success) {
    await interaction.reply({
      content: "◈ Unable to cancel this challenge.",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  const canceledEmbed = new EmbedBuilder()
    .setColor(ERROR_COLOR)
    .setTitle("⚔ ═══ CHALLENGE CANCELED ═══")
    .setDescription(`Challenge by <@${userId}> has been canceled.`)
    .setFooter({ text: "The challenger withdrew their challenge." });

  await interaction.editReply({
    embeds: [canceledEmbed],
    components: [],
  });

  log.info(`Challenge canceled via button: ${userId} (${battleId})`);
};

/**
 * Handle stance selection button
 */
export const handleStanceSelection = async (
  interaction: ButtonInteraction,
  stance: Stance,
  targetOdwerId: string
): Promise<void> => {
  const userId = interaction.user.id;

  // Verify this is the correct user
  if (userId !== targetOdwerId) {
    await interaction.reply({
      content: "◈ This button is not for you.",
      ephemeral: true,
    });
    return;
  }

  // Get battle from thread
  const threadId = interaction.channelId;
  const battle = getBattleByThread(threadId);

  if (!battle) {
    await interaction.reply({
      content: "◈ Could not find the battle for this thread.",
      ephemeral: true,
    });
    return;
  }

  // Set stance
  const success = setFighterStance(battle, userId, stance);
  if (!success) {
    await interaction.reply({
      content: "◈ Could not set stance. The battle may have already started.",
      ephemeral: true,
    });
    return;
  }

  const getStanceEmoji = (s: Stance): string => {
    if (s === "aggressive") {
      return "⚡";
    }
    if (s === "defensive") {
      return "🛡️";
    }
    return "🎭";
  };
  const stanceEmoji = getStanceEmoji(stance);

  await interaction.reply({
    content: `${stanceEmoji} You've chosen the **${stance}** stance. ◈`,
    ephemeral: true,
  });

  // Check if both fighters have selected stances (combat phase started)
  if (battle.phase === "combat") {
    // Post round 1 message with ability selection
    // This will be handled by a separate combat flow
    log.info(`Battle ${battle.id} entering combat phase`);
  }
};

/**
 * Handle ability selection
 */
export const handleAbilitySelection = async (
  interaction: StringSelectMenuInteraction,
  targetOdwerId: string
): Promise<void> => {
  const userId = interaction.user.id;

  if (userId !== targetOdwerId) {
    await interaction.reply({
      content: "❌ This menu is not for you!",
      ephemeral: true,
    });
    return;
  }

  const threadId = interaction.channelId;
  const battle = getBattleByThread(threadId);

  if (!battle || battle.phase !== "combat") {
    await interaction.reply({
      content: "◈ Could not find an active battle.",
      ephemeral: true,
    });
    return;
  }

  const abilityName = interaction.values[0];
  const success = setFighterAction(battle, userId, abilityName);

  if (!success) {
    await interaction.reply({
      content: "◈ Could not set action.",
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `⚔ You've selected **${abilityName}**. Waiting for opponent... ◈`,
    ephemeral: true,
  });

  // Combat resolution will be handled separately when both fighters select
};

/**
 * Extract action type from custom ID
 */
const extractSpectatorAction = (
  customId: string
): { action: CrowdAction; battleId: string } | null => {
  if (customId.startsWith("cheer_red_")) {
    return {
      action: "cheer_red",
      battleId: customId.replace("cheer_red_", ""),
    };
  }
  if (customId.startsWith("cheer_blue_")) {
    return {
      action: "cheer_blue",
      battleId: customId.replace("cheer_blue_", ""),
    };
  }
  if (customId.startsWith("bloodlust_")) {
    return {
      action: "bloodlust",
      battleId: customId.replace("bloodlust_", ""),
    };
  }
  if (customId.startsWith("surge_")) {
    return { action: "surge", battleId: customId.replace("surge_", "") };
  }
  return null;
};

/**
 * Build arena event embed
 */
const buildArenaEventEmbed = (
  event: NonNullable<
    Awaited<ReturnType<typeof applyCrowdAction>>["triggeredEvent"]
  >
): EmbedBuilder => {
  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle("⚡ ARENA EVENT")
    .setDescription(event.description);

  if (event.redEffect) {
    embed.addFields({
      name: "🔴 Red Fighter Effect",
      value: `${event.redEffect.type}: +${event.redEffect.value}% (${event.redEffect.duration} rounds)`,
      inline: true,
    });
  }

  if (event.blueEffect) {
    embed.addFields({
      name: "🔵 Blue Fighter Effect",
      value: `${event.blueEffect.type}: +${event.blueEffect.value}% (${event.blueEffect.duration} rounds)`,
      inline: true,
    });
  }

  if (event.redDamage !== undefined) {
    embed.addFields({
      name: "Damage Dealt",
      value: `🔴 Red: ${event.redDamage} | 🔵 Blue: ${event.blueDamage ?? 0}`,
      inline: false,
    });
  }

  return embed;
};

/**
 * Handle spectator action button
 */
export const handleSpectatorAction = async (
  interaction: ButtonInteraction
): Promise<void> => {
  const customId = interaction.customId;
  const userId = interaction.user.id;

  // Extract action type and battle ID from customId
  const actionData = extractSpectatorAction(customId);
  if (!actionData) {
    await interaction.reply({
      content: "◉ Unknown spectator action.",
      ephemeral: true,
    });
    return;
  }

  const { action } = actionData;

  // Get battle from thread ID
  const threadId = interaction.channelId;
  const battle = getBattleByThread(threadId);

  if (!battle) {
    await interaction.reply({
      content: "◉ Could not find the battle for this thread.",
      ephemeral: true,
    });
    return;
  }

  // Verify user is a spectator
  if (!battle.spectators.has(userId)) {
    await interaction.reply({
      content:
        "◉ You are not a spectator in this battle. Join the thread to spectate!",
      ephemeral: true,
    });
    return;
  }

  // Apply the crowd action
  const result = applyCrowdAction(battle, userId, action);

  if (!result.success) {
    await interaction.reply({
      content: `◉ ${result.message}`,
      ephemeral: true,
    });
    return;
  }

  // Reply with success message
  await interaction.reply({
    content: `◉ ${result.message}`,
    ephemeral: true,
  });

  // If an arena event was triggered, post it to the thread
  if (
    result.triggeredEvent &&
    interaction.channel &&
    interaction.channel.type === ChannelType.PublicThread
  ) {
    const eventEmbed = buildArenaEventEmbed(result.triggeredEvent);
    await interaction.channel.send({ embeds: [eventEmbed] });
  }

  log.info(`Spectator action ${action} by ${userId} in battle ${battle.id}`);
};

/**
 * Handle arena my stats button
 */
const handleArenaMyStats = async (
  interaction: ButtonInteraction
): Promise<void> => {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  const { getUserStats } = await import("../arena/tracking");
  const userStats = await getUserStats(userId);

  const STATS_COLOR: HexColorString = "#00ff88";

  const embed = new EmbedBuilder()
    .setColor(STATS_COLOR)
    .setTitle(`◉ ${interaction.user.username}'s Stats`)
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
        name: "⚔ Arena Record",
        value: [
          `**Wins:** ${userStats.wins}`,
          `**Losses:** ${userStats.losses}`,
          `**Win Rate:** ${winRate}%`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "✦ Streaks",
        value: [
          `**Current:** ${userStats.currentStreak} wins`,
          `**Best Ever:** ${userStats.bestStreak} wins`,
        ].join("\n"),
        inline: true,
      },
      {
        name: "◈ Achievements",
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
      "You haven't participated in any arena battles yet.\n\nStart your journey with `/arena challenge`"
    );
  }

  await interaction.editReply({ embeds: [embed] });
};

/**
 * Handle arena leaderboard button
 */
const handleArenaLeaderboard = async (
  interaction: ButtonInteraction
): Promise<void> => {
  await interaction.deferReply({ ephemeral: true });

  const { getLeaderboard, getServerStats } = await import("../arena/tracking");
  const [leaderboard, serverStats] = await Promise.all([
    getLeaderboard(10),
    getServerStats(),
  ]);

  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle("✦ ═══ Arena Leaderboard ═══")
    .setDescription("Top fighters this season");

  embed.addFields({
    name: "◉ Server Stats",
    value: [
      `**Total Battles:** ${serverStats.totalBattles}`,
      `**Total Rounds:** ${serverStats.totalRounds}`,
      `**Epic Victories:** ${serverStats.epicVictories}`,
      `**Unique Fighters:** ${serverStats.uniqueFighters}`,
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

  embed.setFooter({ text: "Rankings update after each battle" });

  await interaction.editReply({ embeds: [embed] });
};

/**
 * Main button interaction router
 */
export const handleArenaButton = async (
  interaction: ButtonInteraction,
  config: Config
): Promise<void> => {
  const customId = interaction.customId;

  if (customId.startsWith("arena_accept_")) {
    const battleId = customId.replace("arena_accept_", "");
    await handleAcceptChallenge(interaction, battleId, config);
  } else if (customId.startsWith("arena_watch_")) {
    const battleId = customId.replace("arena_watch_", "");
    await handleWatch(interaction, battleId);
  } else if (customId.startsWith("arena_cancel_")) {
    const parts = customId.replace("arena_cancel_", "").split("_");
    const battleId = parts[0];
    const challengerUserId = parts[1];
    await handleCancelChallenge(
      interaction,
      battleId,
      challengerUserId,
      config
    );
  } else if (customId === "arena_my_stats") {
    await handleArenaMyStats(interaction);
  } else if (customId === "arena_leaderboard") {
    await handleArenaLeaderboard(interaction);
  } else if (customId.startsWith("stance_")) {
    const parts = customId.split("_");
    const stance = parts[1] as Stance;
    const odwerId = parts[2];
    await handleStanceSelection(interaction, stance, odwerId);
  } else if (
    customId.startsWith("cheer_") ||
    customId.startsWith("bloodlust_") ||
    customId.startsWith("surge_")
  ) {
    await handleSpectatorAction(interaction);
  } else {
    await interaction.reply({
      content: "Unknown button interaction.",
      ephemeral: true,
    });
  }
};

/**
 * Main select menu interaction router
 */
export const handleArenaSelectMenu = async (
  interaction: StringSelectMenuInteraction,
  config: Config
): Promise<void> => {
  const customId = interaction.customId;

  if (customId.startsWith("select_bot_")) {
    const parts = customId.split("_");
    const battleId = parts[2];
    const odwerId = parts[3];
    await handleBotSelection(interaction, battleId, odwerId, config);
  } else if (customId.startsWith("ability_")) {
    const odwerId = customId.replace("ability_", "");
    await handleAbilitySelection(interaction, odwerId);
  } else {
    await interaction.reply({
      content: "Unknown select menu interaction.",
      ephemeral: true,
    });
  }
};

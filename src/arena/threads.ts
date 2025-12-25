/**
 * Arena Thread Management
 *
 * Creates and manages Discord threads for arena battles.
 */

import {
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
  type Message,
  type StringSelectMenuInteraction,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";
import { THREAD_AUTO_ARCHIVE_MINUTES } from "../lib/constants";
import { prefixedLogger } from "../lib/logger";
import {
  activateSpectators,
  type BattleState,
  type FighterState,
  setBattleThread,
} from "./state";

const log = prefixedLogger("ArenaThreads");

/** Arena brand color */
const ARENA_COLOR: HexColorString = "#ff4444";

/**
 * Format stats as a visual bar
 */
const statsBar = (value: number): string => {
  const filled = Math.floor(value / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
};

/**
 * Format HP as a visual bar
 */
export const hpBar = (current: number, max: number): string => {
  const percentage = current / max;
  const totalBlocks = 12;
  const filledBlocks = Math.ceil(percentage * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;

  return "█".repeat(filledBlocks) + "░".repeat(emptyBlocks);
};

/** Format stats block for fighter display */
const formatStatsBlock = (stats: {
  strength?: number;
  agility?: number;
  intellect?: number;
  luck?: number;
  endurance?: number;
  charisma?: number;
}): string[] => {
  const lines: string[] = ["```"];
  lines.push(`STR ${statsBar(stats.strength ?? 0)} ${stats.strength ?? 0}`);
  lines.push(`AGI ${statsBar(stats.agility ?? 0)} ${stats.agility ?? 0}`);
  lines.push(`INT ${statsBar(stats.intellect ?? 0)} ${stats.intellect ?? 0}`);
  lines.push(`LCK ${statsBar(stats.luck ?? 0)} ${stats.luck ?? 0}`);
  lines.push(`END ${statsBar(stats.endurance ?? 0)} ${stats.endurance ?? 0}`);
  lines.push(`CHA ${statsBar(stats.charisma ?? 0)} ${stats.charisma ?? 0}`);
  lines.push("```");
  return lines;
};

/**
 * Build fighter display embed field
 */
const formatFighterStats = (
  fighter: FighterState,
  color: "◈" | "◈"
): string => {
  const lines = [`${color} **${fighter.bot.name}** (#${fighter.bot.tokenId})`];

  if (fighter.story) {
    lines.push(`${fighter.story.arc.faction} • ${fighter.story.arc.role}`);
  }

  if (fighter.story?.storyStats) {
    lines.push(...formatStatsBlock(fighter.story.storyStats));
  }

  if (fighter.story?.storyPowers && fighter.story.storyPowers.length > 0) {
    lines.push(
      `**⚡ Powers:** ${fighter.story.storyPowers.slice(0, 3).join(" • ")}`
    );
  }

  return lines.join("\n");
};

/**
 * Build pre-battle embed showing both fighters
 */
export const buildPreBattleEmbed = (battle: BattleState): EmbedBuilder => {
  if (!battle.blueFighter) {
    throw new Error("Cannot build pre-battle embed without blue fighter");
  }

  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle("⚔️ ═══ FIGHTERS LOCKED IN ═══ ⚔️")
    .setDescription(
      `<@${battle.redFighter.userId}> **⟷** <@${battle.blueFighter.userId}>`
    )
    .addFields(
      {
        name: "◈ Red Fighter ◈",
        value: formatFighterStats(battle.redFighter, "◈"),
        inline: true,
      },
      {
        name: "◈ Blue Fighter ◈",
        value: formatFighterStats(battle.blueFighter, "◈"),
        inline: true,
      }
    )
    .setFooter({ text: "⏱ Choose your opening stance! (30 seconds)" });

  return embed;
};

/**
 * Build round status embed
 */
export const buildRoundEmbed = (battle: BattleState): EmbedBuilder => {
  if (!battle.blueFighter) {
    throw new Error("Cannot build round embed without blue fighter");
  }

  const redHpPercent = Math.round(
    (battle.redFighter.hp / battle.redFighter.maxHp) * 100
  );
  const blueHpPercent = Math.round(
    (battle.blueFighter.hp / battle.blueFighter.maxHp) * 100
  );

  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(`⚔️ ━━━ ROUND ${battle.round} OF ${battle.maxRounds} ━━━ ⚔️`)
    .addFields(
      {
        name: `◈ ${battle.redFighter.bot.name}`,
        value: `${hpBar(battle.redFighter.hp, battle.redFighter.maxHp)} ${battle.redFighter.hp}/${battle.redFighter.maxHp} HP (${redHpPercent}%)`,
        inline: true,
      },
      {
        name: `◈ ${battle.blueFighter.bot.name}`,
        value: `${hpBar(battle.blueFighter.hp, battle.blueFighter.maxHp)} ${battle.blueFighter.hp}/${battle.blueFighter.maxHp} HP (${blueHpPercent}%)`,
        inline: true,
      }
    );

  // Add last round recap if available
  if (battle.roundLog.length > 0) {
    const lastRound = battle.roundLog.at(-1);
    if (lastRound) {
      embed.addFields({
        name: `✦ Round ${lastRound.round} Recap ✦`,
        value: lastRound.narrative.slice(0, 1024),
      });
    }
  }

  // Add crowd energy
  const crowdBar =
    "█".repeat(Math.floor(battle.crowdEnergy / 10)) +
    "░".repeat(10 - Math.floor(battle.crowdEnergy / 10));
  embed.addFields({
    name: "◉ Crowd Energy ◉",
    value: `${crowdBar} ${battle.crowdEnergy}%`,
  });

  embed.setFooter({ text: "⏱ Choose your action! (30 seconds)" });

  return embed;
};

/**
 * Build victory embed
 */
export const buildVictoryEmbed = (
  battle: BattleState,
  winner: FighterState,
  loser: FighterState,
  isEpic: boolean
): EmbedBuilder => {
  const _winnerColor = battle.redFighter === winner ? "🔴" : "🔵";
  const _loserColor = battle.redFighter === loser ? "🔴" : "🔵";

  const embed = new EmbedBuilder()
    .setColor(ARENA_COLOR)
    .setTitle(isEpic ? "✦ ═══ EPIC VICTORY ═══ ✦" : "✦ ═══ VICTORY ═══ ✦")
    .setDescription(`**◈ ${winner.bot.name} CLAIMS GLORY! ◈**`)
    .addFields(
      {
        name: "◉ Final Score ◉",
        value: [
          `◈ ${winner.bot.name}: ${hpBar(winner.hp, winner.maxHp)} ${winner.hp} HP ⟵ **WINNER**`,
          `◈ ${loser.bot.name}: ⚰ DEFEATED`,
        ].join("\n"),
      },
      {
        name: "⚔ Battle Stats ⚔",
        value: [
          `**Rounds:** ${battle.round}`,
          `**Crowd Energy:** ${battle.crowdEnergy}%`,
          `**Spectators:** ${battle.spectators.size}`,
        ].join("\n"),
        inline: true,
      }
    )
    .setFooter({
      text: `Winner: ${winner.username} • Battle ID: ${battle.id}`,
    });

  return embed;
};

/**
 * Create a battle thread
 */
export const createBattleThread = async (
  interaction:
    | ButtonInteraction
    | ChatInputCommandInteraction
    | StringSelectMenuInteraction,
  battle: BattleState
): Promise<ThreadChannel | null> => {
  if (!battle.blueFighter) {
    log.error("Cannot create thread: no blue fighter");
    return null;
  }

  try {
    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      log.error("Cannot create thread: invalid channel type");
      return null;
    }

    const textChannel = channel as TextChannel;
    const threadName = `⚔ ${battle.redFighter.bot.name} ⟷ ${battle.blueFighter.bot.name}`;

    const thread = await textChannel.threads.create({
      name: threadName,
      autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
      type: ChannelType.PublicThread,
      reason: `Arena battle ${battle.id}`,
    });

    // Store thread ID in battle
    setBattleThread(battle, thread.id);

    // Add fighters to thread
    await thread.members.add(battle.redFighter.userId);
    await thread.members.add(battle.blueFighter.userId);

    // Add pending spectators to thread
    for (const odwerId of battle.pendingSpectators) {
      try {
        await thread.members.add(odwerId);
      } catch {
        // Ignore errors adding spectators
      }
    }

    // Move pending spectators to active
    activateSpectators(battle);

    log.info(`Created battle thread: ${thread.name} (${thread.id})`);

    return thread;
  } catch (error) {
    log.error("Failed to create battle thread:", error);
    return null;
  }
};

/**
 * Update the original challenge announcement
 */
export const updateChallengeAnnouncement = async (
  channel: TextChannel,
  messageId: string,
  battle: BattleState,
  threadId: string
): Promise<void> => {
  if (!battle.blueFighter) {
    return;
  }

  try {
    const message = await channel.messages.fetch(messageId);

    const embed = new EmbedBuilder()
      .setColor(ARENA_COLOR)
      .setTitle("⚔ ═══ BATTLE STARTED ═══ ⚔")
      .setDescription(
        [
          `◈ <@${battle.redFighter.userId}> (${battle.redFighter.bot.name})`,
          "**⟷**",
          `◈ <@${battle.blueFighter.userId}> (${battle.blueFighter.bot.name})`,
        ].join("\n")
      )
      .addFields({
        name: "◉ Battle Thread ◉",
        value: `<#${threadId}>`,
      })
      .setFooter({ text: "Click the thread link to watch or spectate!" });

    await message.edit({
      embeds: [embed],
      components: [], // Remove buttons
    });

    log.info(`Updated challenge announcement ${messageId}`);
  } catch (error) {
    log.error("Failed to update challenge announcement:", error);
  }
};

/**
 * Post the initial battle message in thread
 */
export const postPreBattleMessage = async (
  thread: ThreadChannel,
  battle: BattleState
): Promise<Message | null> => {
  try {
    const embed = buildPreBattleEmbed(battle);
    const message = await thread.send({ embeds: [embed] });
    return message;
  } catch (error) {
    log.error("Failed to post pre-battle message:", error);
    return null;
  }
};

/**
 * Post round status in thread
 */
export const postRoundMessage = async (
  thread: ThreadChannel,
  battle: BattleState
): Promise<Message | null> => {
  try {
    const embed = buildRoundEmbed(battle);
    const message = await thread.send({ embeds: [embed] });
    return message;
  } catch (error) {
    log.error("Failed to post round message:", error);
    return null;
  }
};

type VictoryMessageOpts = {
  thread: ThreadChannel;
  battle: BattleState;
  winner: FighterState;
  loser: FighterState;
  isEpic: boolean;
};

/**
 * Post victory message in thread
 */
export const postVictoryMessage = async (
  opts: VictoryMessageOpts
): Promise<Message | null> => {
  try {
    const embed = buildVictoryEmbed(
      opts.battle,
      opts.winner,
      opts.loser,
      opts.isEpic
    );
    const message = await opts.thread.send({ embeds: [embed] });
    return message;
  } catch (error) {
    log.error("Failed to post victory message:", error);
    return null;
  }
};

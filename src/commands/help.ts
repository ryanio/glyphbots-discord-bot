/**
 * /help Command Handler
 *
 * Provides context-aware help and documentation.
 */

import type { ChatInputCommandInteraction } from "discord.js";
import { getHelpEmbed } from "../help/embeds";
import type { Config } from "../lib/types";

/**
 * Handle /help command
 */
export const handleHelp = async (
  interaction: ChatInputCommandInteraction,
  config: Config
): Promise<void> => {
  const topic = interaction.options.getString("topic");
  const channelId = interaction.channelId;

  const { embed, components } = getHelpEmbed(topic, channelId, {
    loreChannelId: config.loreChannelId,
    arenaChannelId: config.arenaChannelId ?? undefined,
    playgroundChannelId: config.playgroundChannelId ?? undefined,
  });

  await interaction.reply({
    embeds: [embed],
    components: components ?? [],
  });
};

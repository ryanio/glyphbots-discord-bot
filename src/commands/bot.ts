import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  fetchBot,
  fetchBotStory,
  getBotPngUrl,
  getBotUrl,
} from "../api/glyphbots";
import {
  fetchAccountNFTs,
  fetchNFT,
  getOpenSeaUrl,
  shortAddress,
} from "../api/opensea";
import { prefixedLogger } from "../lib/logger";
import type { Bot, BotStory } from "../lib/types";
import { getUserWallet } from "../lib/wallet-state";

const log = prefixedLogger("BotCmd");

const BOT_COLOR: HexColorString = "#00ff88";
const ERROR_COLOR: HexColorString = "#ff4444";
const MAX_BOT_ID = 11_111;
const BOT_NAME_REGEX = /^GlyphBot #\d+ - /;

const statsBar = (value: number): string => {
  const filled = Math.floor(value / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
};

const formatStatsBlock = (stats: BotStory["storyStats"]): string => {
  if (!stats) {
    return "";
  }
  return [
    `STR ${statsBar(stats.strength ?? 0)} ${stats.strength ?? 0}`,
    `AGI ${statsBar(stats.agility ?? 0)} ${stats.agility ?? 0}`,
    `INT ${statsBar(stats.intellect ?? 0)} ${stats.intellect ?? 0}`,
    `LCK ${statsBar(stats.luck ?? 0)} ${stats.luck ?? 0}`,
    `END ${statsBar(stats.endurance ?? 0)} ${stats.endurance ?? 0}`,
    `CHA ${statsBar(stats.charisma ?? 0)} ${stats.charisma ?? 0}`,
  ].join("\n");
};

const _formatETH = (value: string, decimals: number): string => {
  const num = Number(value) / 10 ** decimals;
  if (num < 0.0001) {
    return `${num.toExponential(2)} ETH`;
  }
  if (num < 1) {
    return `${num.toFixed(4)} ETH`;
  }
  return `${num.toFixed(3)} ETH`;
};

const buildBotEmbed = async (
  tokenId: number,
  bot: Bot,
  story: BotStory | null
): Promise<EmbedBuilder> => {
  const embed = new EmbedBuilder()
    .setColor(BOT_COLOR)
    .setTitle(`GlyphBot #${tokenId}`)
    .setURL(getBotUrl(tokenId))
    .setDescription(`**${bot.name.replace(BOT_NAME_REGEX, "")}**`)
    .setImage(getBotPngUrl(tokenId));

  // Add OpenSea data
  const nft = await fetchNFT(tokenId);
  if (nft?.owners?.[0]) {
    embed.addFields({
      name: "Owner",
      value: `\`${shortAddress(nft.owners[0].address)}\``,
      inline: true,
    });
  }

  if (nft?.rarity?.rank) {
    embed.addFields({
      name: "Rarity",
      value: `#${nft.rarity.rank.toLocaleString()} / ${MAX_BOT_ID.toLocaleString()}`,
      inline: true,
    });
  }

  // Add traits
  if (bot.traits.length > 0) {
    const traitList = bot.traits
      .filter((t) => t.value !== "None" && t.value !== "No")
      .slice(0, 6)
      .map((t) => `**${t.trait_type}:** ${t.value}`)
      .join("\n");
    if (traitList) {
      embed.addFields({ name: "Traits", value: traitList, inline: true });
    }
  }

  // Add story info
  if (story) {
    embed.addFields({
      name: "Role",
      value: `${story.arc.faction} • ${story.arc.role}`,
      inline: true,
    });

    if (story.storyStats) {
      embed.addFields({
        name: "Stats",
        value: `\`\`\`\n${formatStatsBlock(story.storyStats)}\n\`\`\``,
      });
    }

    if (story.storyPowers && story.storyPowers.length > 0) {
      embed.addFields({
        name: "Powers",
        value: story.storyPowers.slice(0, 3).join(" • "),
      });
    }
  }

  embed.setFooter({ text: "GlyphBots" });

  return embed;
};

const getRandomTokenId = (): number =>
  Math.floor(Math.random() * MAX_BOT_ID) + 1;

const fetchRandomFromUsername = async (
  username: string
): Promise<number | undefined> => {
  log.debug(`Fetching random bot for OpenSea user: ${username}`);

  // OpenSea usernames map to addresses via the account endpoint
  // We need to get their NFTs from the collection
  const nfts = await fetchAccountNFTs(username);

  if (nfts.length === 0) {
    return;
  }

  const randomIndex = Math.floor(Math.random() * nfts.length);
  return Number(nfts[randomIndex].identifier);
};

export const handleBot = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const tokenIdOption = interaction.options.getInteger("id");
  const isRandom = interaction.options.getBoolean("random") ?? false;
  const usernameOption = interaction.options.getString("user");

  await interaction.deferReply();

  let tokenId: number;

  if (usernameOption) {
    // Fetch random bot from OpenSea username
    const randomId = await fetchRandomFromUsername(usernameOption);
    if (!randomId) {
      const embed = new EmbedBuilder()
        .setColor(ERROR_COLOR)
        .setTitle("No GlyphBots Found")
        .setDescription(
          `No GlyphBots found for OpenSea user **${usernameOption}**.`
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    tokenId = randomId;
    log.info(`Random bot from user ${usernameOption}: #${tokenId}`);
  } else if (isRandom) {
    // Check if user has wallet connected, use their bots first
    const wallet = await getUserWallet(interaction.user.id);
    if (wallet) {
      const nfts = await fetchAccountNFTs(wallet);
      if (nfts.length > 0) {
        const randomIndex = Math.floor(Math.random() * nfts.length);
        tokenId = Number(nfts[randomIndex].identifier);
        log.info(
          `Random owned bot for ${interaction.user.username}: #${tokenId}`
        );
      } else {
        tokenId = getRandomTokenId();
        log.info(`Random bot (no owned): #${tokenId}`);
      }
    } else {
      tokenId = getRandomTokenId();
      log.info(`Random bot: #${tokenId}`);
    }
  } else if (tokenIdOption) {
    tokenId = tokenIdOption;
  } else {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("Missing Bot ID")
      .setDescription(
        "Please provide a bot ID, use `random:true`, or specify a `user`."
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const [bot, story] = await Promise.all([
    fetchBot(tokenId),
    fetchBotStory(tokenId),
  ]);

  if (!bot) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("Bot Not Found")
      .setDescription(`GlyphBot #${tokenId} could not be found.`);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const embed = await buildBotEmbed(tokenId, bot, story);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("View Bot")
      .setStyle(ButtonStyle.Link)
      .setURL(getBotUrl(tokenId))
      .setEmoji("🤖"),
    new ButtonBuilder()
      .setLabel("OpenSea")
      .setStyle(ButtonStyle.Link)
      .setURL(getOpenSeaUrl(tokenId))
      .setEmoji("🌊")
  );

  await interaction.editReply({ embeds: [embed], components: [buttons] });
  log.info(`Displayed bot #${tokenId}`);
};

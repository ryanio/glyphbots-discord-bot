import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type HexColorString,
} from "discord.js";
import {
  fetchAccountNFTs,
  isValidEthereumAddress,
  shortAddress,
} from "../api/opensea";
import { prefixedLogger } from "../lib/logger";
import {
  clearUserWallet,
  getUserWallet,
  setUserWallet,
} from "../lib/wallet-state";

const log = prefixedLogger("WalletCmd");

const SUCCESS_COLOR: HexColorString = "#00ff88";
const ERROR_COLOR: HexColorString = "#ff4444";
const INFO_COLOR: HexColorString = "#5865f2";

const handleSetWallet = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const address = interaction.options.getString("address", true);
  const userId = interaction.user.id;

  if (!isValidEthereumAddress(address)) {
    const embed = new EmbedBuilder()
      .setColor(ERROR_COLOR)
      .setTitle("❌ Invalid Address")
      .setDescription(
        "Please provide a valid Ethereum address.\n\n" +
          "Example: `0x00A839dE7922491683f547a67795204763ff8237`"
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const nfts = await fetchAccountNFTs(address, 1);

  await setUserWallet(userId, address);

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle("✅ Wallet Connected")
    .setDescription(
      [
        "Your Ethereum address has been saved!",
        "",
        `**Address:** \`${shortAddress(address)}\``,
        nfts.length > 0
          ? "\n🤖 We found GlyphBots in this wallet! Use `/mybots` to see them."
          : "\n💡 No GlyphBots found in this wallet yet. [Get one on OpenSea!](https://opensea.io/collection/glyphbots)",
      ].join("\n")
    );

  await interaction.editReply({ embeds: [embed] });
  log.info(
    `Wallet set for ${interaction.user.username}: ${shortAddress(address)}`
  );
};

const handleViewWallet = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const userId = interaction.user.id;
  const wallet = await getUserWallet(userId);

  if (!wallet) {
    const embed = new EmbedBuilder()
      .setColor(INFO_COLOR)
      .setTitle("🔗 No Wallet Connected")
      .setDescription(
        "You haven't connected an Ethereum wallet yet.\n\n" +
          "Use `/wallet set` to connect your wallet and access your GlyphBots!"
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const nfts = await fetchAccountNFTs(wallet);

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle("🔗 Your Connected Wallet")
    .setDescription(
      [
        `**Address:** \`${shortAddress(wallet)}\``,
        "",
        nfts.length > 0
          ? `🤖 **GlyphBots Owned:** ${nfts.length}`
          : "No GlyphBots found in this wallet.",
        "",
        nfts.length > 0 ? "Use `/mybots` to see your collection!" : "",
      ]
        .filter(Boolean)
        .join("\n")
    );

  await interaction.editReply({ embeds: [embed] });
};

const handleClearWallet = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const userId = interaction.user.id;
  const cleared = await clearUserWallet(userId);

  if (!cleared) {
    const embed = new EmbedBuilder()
      .setColor(INFO_COLOR)
      .setTitle("🔗 No Wallet to Clear")
      .setDescription("You don't have a wallet connected.");

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(SUCCESS_COLOR)
    .setTitle("✅ Wallet Disconnected")
    .setDescription(
      "Your Ethereum wallet has been removed.\n\n" +
        "Use `/wallet set` to connect a new wallet."
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
  log.info(`Wallet cleared for ${interaction.user.username}`);
};

export const handleWallet = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "set":
      await handleSetWallet(interaction);
      break;
    case "view":
      await handleViewWallet(interaction);
      break;
    case "clear":
      await handleClearWallet(interaction);
      break;
    default:
      await interaction.reply({
        content: "Unknown wallet command.",
        ephemeral: true,
      });
  }
};

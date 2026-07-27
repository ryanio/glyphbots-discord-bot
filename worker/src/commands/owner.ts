/**
 * `/owner`.
 *
 * The thumbnail is `getBotPngUrl`, as it was on the Node bot. OpenSea supplies
 * the owner address and the rarity rank, never the image.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { shortAddress } from "../api/glyphbots";
import { getOpenSeaUrl } from "../api/opensea";
import { COLORS } from "../config";
import { linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import type { CommandHandler } from "./context";

export const handleOwner: CommandHandler = async (ctx) => {
  const tokenId = ctx.options.getInteger("bot");

  if (tokenId === null) {
    return errorReply("❌ Missing Bot ID", "Please provide a bot token id.");
  }

  const nft = await ctx.opensea.fetchNFT(tokenId);

  if (!nft) {
    return errorReply(
      "❌ Bot Not Found",
      `GlyphBot #${tokenId} was not found.`
    );
  }

  const owner = nft.owners?.[0];
  if (!owner) {
    return errorReply(
      "❌ Owner Not Found",
      `Could not determine the owner of GlyphBot #${tokenId}.`
    );
  }

  const account = await ctx.opensea.fetchAccount(owner.address);
  const displayName = account?.username || shortAddress(owner.address);
  const botName = nft.name ?? `GlyphBot #${tokenId}`;

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`🤖 ${botName}`)
    .setDescription(
      [
        `**Owner:** ${account?.username ? `@${account.username}` : displayName}`,
        `**Address:** \`${shortAddress(owner.address)}\``,
        "",
        account?.bio ? `*"${account.bio}"*` : "",
        "",
        nft.rarity
          ? `**Rarity Rank:** #${nft.rarity.rank.toLocaleString()}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .setThumbnail(ctx.glyphbots.getBotPngUrl(tokenId))
    .setFooter({ text: "Data from OpenSea" });

  return embedReply(embed, [
    linkButtonRow([
      { label: "View Bot", url: ctx.glyphbots.getBotUrl(tokenId), emoji: "🤖" },
      { label: "View on OpenSea", url: getOpenSeaUrl(tokenId), emoji: "🌊" },
    ]),
  ]);
};

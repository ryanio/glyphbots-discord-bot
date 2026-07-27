/**
 * `/artifact`, ported from `src/commands/artifact.ts`.
 *
 * `artifact.imageUrl` stays on the embed. It is worth being explicit about why
 * that does not violate the no-SVG rule: this field comes from the GlyphBots
 * API, not from OpenSea, and artifact images are already JPEG or PNG. The rule
 * is about OpenSea's `image_url`, which is `image/svg+xml` for this contract
 * and never reaches an embed anywhere in this package. No OpenSea call happens
 * on this path at all.
 *
 * The one open question, carried over from the plan's preflight and still
 * unverified: artifact images run 7 to 8 MB, and whether Discord's proxy
 * thumbnails them reliably needs a live post to find out.
 */

import { EmbedBuilder } from "@discordjs/builders";
import { getOpenSeaArtifactUrl } from "../api/opensea";
import type { Artifact } from "../api/types";
import { COLORS } from "../config";
import { type LinkButton, linkButtonRow } from "../discord/buttons";
import { embedReply, errorReply } from "../discord/embeds";
import { createLogger } from "../utils/logger";
import type { CommandContext, CommandHandler } from "./context";
import { BOT_NAME_PREFIX } from "./format";

const log = createLogger("ArtifactCmd");

const RECENT_FETCH_LIMIT = 50;

const buildArtifactEmbed = async (
  artifact: Artifact,
  ctx: CommandContext
): Promise<EmbedBuilder> => {
  const embed = new EmbedBuilder()
    .setColor(COLORS.artifact)
    .setTitle(artifact.title);

  if (artifact.contractTokenId) {
    embed.setURL(ctx.glyphbots.getArtifactUrl(artifact.contractTokenId));
    embed.addFields({
      name: "Token ID",
      value: `#${artifact.contractTokenId}`,
      inline: true,
    });
  }

  if (artifact.type) {
    embed.addFields({
      name: "Type",
      value: artifact.type.charAt(0).toUpperCase() + artifact.type.slice(1),
      inline: true,
    });
  }

  const originBot = await ctx.glyphbots.fetchBot(artifact.botTokenId);
  const botName =
    originBot?.name?.replace(BOT_NAME_PREFIX, "") ?? `#${artifact.botTokenId}`;

  embed.addFields({
    name: "Origin Bot",
    value: `[${botName}](${ctx.glyphbots.getBotUrl(artifact.botTokenId)})`,
    inline: true,
  });

  if (artifact.imageUrl) {
    embed.setImage(artifact.imageUrl);
  }

  // The mint date moves to the footer. It was a fourth inline field, which
  // wrapped onto a second row of its own for one short date.
  const minted = artifact.mintedAt
    ? new Date(artifact.mintedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return embed.setFooter({
    text: minted ? `GlyphBots Artifacts · Minted ${minted}` : "GlyphBots Artifacts",
  });
};

/** Resolve the artifact this invocation is about, or an error body. */
const resolveArtifact = async (
  ctx: CommandContext
): Promise<{ artifact: Artifact } | { error: ReturnType<typeof errorReply> }> => {
  const tokenIdOption = ctx.options.getInteger("id");
  const isRandom = ctx.options.getBoolean("random") ?? false;

  if (isRandom) {
    const recent = await ctx.glyphbots.fetchRecentArtifacts(RECENT_FETCH_LIMIT);
    const pick = recent[Math.floor(Math.random() * recent.length)];

    if (!pick) {
      return {
        error: errorReply(
          "No Artifacts Found",
          "No recent artifacts could be found."
        ),
      };
    }

    log.info(`Random artifact: ${pick.title} (#${pick.contractTokenId})`);
    return { artifact: pick };
  }

  if (tokenIdOption !== null) {
    const artifact = await ctx.glyphbots.fetchArtifact(tokenIdOption);
    if (!artifact) {
      return {
        error: errorReply(
          "Artifact Not Found",
          `Artifact #${tokenIdOption} could not be found.`
        ),
      };
    }
    return { artifact };
  }

  return {
    error: errorReply(
      "Missing Artifact ID",
      "Please provide an artifact ID or use `random:true`."
    ),
  };
};

export const handleArtifact: CommandHandler = async (ctx) => {
  const resolved = await resolveArtifact(ctx);

  if ("error" in resolved) {
    return resolved.error;
  }

  const { artifact } = resolved;
  const embed = await buildArtifactEmbed(artifact, ctx);

  const buttons: LinkButton[] = [];

  if (artifact.contractTokenId) {
    buttons.push(
      {
        label: "View Artifact",
        url: ctx.glyphbots.getArtifactUrl(artifact.contractTokenId),
        emoji: "✨",
      },
      {
        label: "OpenSea",
        url: getOpenSeaArtifactUrl(artifact.contractTokenId),
        emoji: "🌊",
      }
    );
  }

  buttons.push({
    label: "Origin Bot",
    url: ctx.glyphbots.getBotUrl(artifact.botTokenId),
    emoji: "🤖",
  });

  return embedReply(embed, [linkButtonRow(buttons)]);
};

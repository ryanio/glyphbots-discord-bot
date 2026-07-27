/**
 * Embeds for the sales feed, ported from
 * `opensea-activity-bot/src/platforms/discord/utils.ts`.
 *
 * **No image bytes are fetched, ever.** The Node bot ran every embed image
 * through `fetchImageBuffer` (`src/utils/utils.ts:228-266`), which rasterized
 * SVG to PNG with `sharp` (`:198-221`) and attached the result as an
 * `AttachmentBuilder` referenced by `attachment://`. That existed because
 * OpenSea serves `image/svg+xml` for these contracts and Discord renders
 * nothing for SVG, so a plain URL showed an empty embed.
 *
 * GlyphBots removes the problem rather than solving it: the site serves
 * first-party PNGs by token id (`getBotPngUrl`, verified 200 `image/png`), so
 * the embed carries a URL and the Worker never touches the pixels. `sharp`,
 * `AttachmentBuilder`, `fetchImageBuffer` and `convertSvgToPng` are all gone.
 * `image_url` is not on the OpenSea types in `../api/types.ts` at all, which
 * makes reaching for it a compile error rather than a review comment.
 */

import { EmbedBuilder } from "@discordjs/builders";
import type { APIEmbed } from "discord-api-types/v10";
import type { GlyphBotsClient } from "../api/glyphbots";
import { shortAddress } from "../api/glyphbots";
import { getOpenSeaCollectionUrl, getOpenSeaUrl } from "../api/opensea";
import type { OpenSeaEvent, OpenSeaPayment } from "../api/types";
import { COLORS, SALES_TOP_ITEMS } from "../config";

/** Clients the embeds need. Narrowed so tests can hand over two functions. */
export type SalesEmbedClients = {
  glyphbots: Pick<GlyphBotsClient, "getBotPngUrl" | "getBotUrl">;
  /** Address to display name. Resolved once per address per tick by the caller. */
  displayName: (address: string) => Promise<string>;
};

const MAX_DECIMALS = 4;
const TRAILING_ZEROS = /(\.\d*?)0+$/;
const TRAILING_DOT = /\.$/;

/**
 * `formatAmount` from `src/utils/utils.ts:111-136`, without `ethers`.
 *
 * The original went through `formatUnits` then `Number.parseFloat`, which
 * loses precision above 2^53 wei. This does the scaling in `BigInt` and rounds
 * half up at four decimals, so the displayed string matches for every amount
 * the original got right and stays exact for the ones it did not. WETH still
 * prints as ETH.
 */
export const formatAmount = (
  quantity: string,
  decimals: number,
  symbol: string
): string => {
  let scaled: bigint;
  try {
    scaled = BigInt(quantity);
  } catch {
    return `? ${symbol}`;
  }

  const divisor = 10n ** BigInt(Math.max(0, decimals));
  const shifted = scaled * 10n ** BigInt(MAX_DECIMALS);
  let units = shifted / divisor;
  if ((shifted % divisor) * 2n >= divisor) {
    units += 1n;
  }

  const digits = units.toString().padStart(MAX_DECIMALS + 1, "0");
  const whole = digits.slice(0, -MAX_DECIMALS);
  const fraction = digits.slice(-MAX_DECIMALS);
  const value = `${whole}.${fraction}`
    .replace(TRAILING_ZEROS, "$1")
    .replace(TRAILING_DOT, "");

  return `${value} ${symbol === "WETH" ? "ETH" : symbol}`;
};

const priceOf = (payment: OpenSeaPayment | undefined): string | null =>
  payment ? formatAmount(payment.quantity, payment.decimals, payment.symbol) : null;

/** Numeric price for sorting, `getPurchasePrice` (`event-grouping.ts:456-468`). */
export const priceValue = (event: OpenSeaEvent): bigint => {
  if (!event.payment?.quantity) {
    return 0n;
  }
  try {
    return BigInt(event.payment.quantity);
  } catch {
    return 0n;
  }
};

/** Highest first, `sortEventsByPrice` (`event-grouping.ts:471-484`). */
export const sortByPriceDesc = (events: OpenSeaEvent[]): OpenSeaEvent[] =>
  [...events].sort((a, b) => {
    const left = priceValue(a);
    const right = priceValue(b);
    if (left > right) {
      return -1;
    }
    return left < right ? 1 : 0;
  });

/**
 * `calculateTotalSpent` (`event-grouping.ts:642-673`), minus the runtime
 * `require("./utils")` at `:671`.
 */
export const totalSpent = (events: OpenSeaEvent[]): string | null => {
  const payments = events
    .map((event) => event.payment)
    .filter(
      (payment): payment is OpenSeaPayment =>
        payment !== undefined &&
        (payment.symbol === "ETH" || payment.symbol === "WETH")
    );

  const first = payments[0];
  if (!first) {
    return null;
  }

  let sum = 0n;
  for (const payment of payments) {
    try {
      sum += BigInt(payment.quantity);
    } catch {
      // A malformed quantity contributes nothing rather than failing the post.
    }
  }

  return formatAmount(sum.toString(), first.decimals, first.symbol);
};

const tokenIdOf = (event: OpenSeaEvent): number | null => {
  const raw = event.nft?.identifier;
  if (raw === undefined) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const itemLabel = (event: OpenSeaEvent): string => {
  const tokenId = tokenIdOf(event);
  const name = event.nft?.name;
  if (tokenId === null) {
    return name ?? "Unknown item";
  }
  return name ? `${name} #${tokenId}` : `GlyphBot #${tokenId}`;
};

const itemUrl = (event: OpenSeaEvent): string | null => {
  const tokenId = tokenIdOf(event);
  return tokenId === null ? (event.nft?.opensea_url ?? null) : getOpenSeaUrl(tokenId);
};

/**
 * Escape Discord markdown in text that came from a third party
 * (`discord/utils.ts:51-52`). OpenSea usernames are user-chosen and regularly
 * contain underscores.
 */
export const escapeMarkdown = (text: string): string =>
  text.replace(/(?<special>[_*~`|>])/g, "\\$<special>");

/** One sale, `buildSaleEmbed` + `buildEmbed` (`discord/utils.ts:122-135,347-382`). */
export const buildSaleEmbed = async (
  event: OpenSeaEvent,
  clients: SalesEmbedClients
): Promise<APIEmbed> => {
  const tokenId = tokenIdOf(event);
  const embed = new EmbedBuilder()
    .setColor(COLORS.sale)
    .setTitle(`Purchased: ${itemLabel(event)}`);

  const url = itemUrl(event);
  if (url) {
    embed.setURL(url);
  }

  if (tokenId !== null) {
    embed.setImage(clients.glyphbots.getBotPngUrl(tokenId));
  }

  const price = priceOf(event.payment);
  if (price) {
    embed.addFields({ name: "Price", value: price, inline: true });
  }

  if (event.buyer) {
    embed.addFields({
      name: "By",
      value: escapeMarkdown(await clients.displayName(event.buyer)),
      inline: true,
    });
  }

  if (tokenId !== null) {
    embed.addFields({
      name: "Bot",
      value: `[View](${clients.glyphbots.getBotUrl(tokenId)})`,
      inline: true,
    });
  }

  return embed.toJSON() as APIEmbed;
};

/** One sweep, `buildGroupEmbed` (`discord/utils.ts:484-536`). */
export const buildGroupEmbed = async (
  events: OpenSeaEvent[],
  clients: SalesEmbedClients
): Promise<APIEmbed> => {
  const sorted = sortByPriceDesc(events);
  const count = events.length;
  const embed = new EmbedBuilder()
    .setColor(COLORS.sale)
    .setTitle(`${count} items purchased`)
    .setURL(getOpenSeaCollectionUrl());

  const spent = totalSpent(events);
  if (spent) {
    embed.addFields({ name: "Total Spent", value: spent, inline: true });
  }

  const buyer = sorted[0]?.buyer;
  if (buyer) {
    embed.addFields({
      name: "Buyer",
      value: escapeMarkdown(await clients.displayName(buyer)),
      inline: true,
    });
  }

  const top = sorted.slice(0, SALES_TOP_ITEMS);
  if (top.length > 0) {
    let list = top
      .map((event, index) => {
        const price = priceOf(event.payment);
        const suffix = price ? ` - ${price}` : "";
        const url = itemUrl(event);
        const label = itemLabel(event);
        return url
          ? `${index + 1}. [${label}](${url})${suffix}`
          : `${index + 1}. ${label}${suffix}`;
      })
      .join("\n");
    if (count > SALES_TOP_ITEMS) {
      list += "\n…";
    }
    embed.addFields({ name: "Top Items", value: list });
  }

  // The thumbnail is the priciest item, and it is a first-party PNG URL rather
  // than an attachment. See the note at the top of this file.
  const headline = tokenIdOf(sorted[0] ?? events[0] ?? ({} as OpenSeaEvent));
  if (headline !== null) {
    embed.setThumbnail(clients.glyphbots.getBotPngUrl(headline));
  }

  return embed.toJSON() as APIEmbed;
};

/** Fallback display name when OpenSea has no account for an address. */
export const fallbackName = (address: string): string => shortAddress(address);

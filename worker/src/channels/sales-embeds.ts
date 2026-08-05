/**
 * Embeds for the sales feed, covering both watched collections.
 *
 * **No image bytes are fetched, ever.** Every picture on these embeds is a URL
 * Discord fetches for itself: `getBotPngUrl` for a bot, the artifact's own
 * `imageUrl` off the GlyphBots API for an artifact. Neither is an OpenSea URL,
 * and `image_url` is not on the OpenSea types in `../api/types.ts` at all, so
 * reaching for one is a compile error rather than a review comment. The bots'
 * OpenSea art is SVG and Discord renders nothing for it.
 *
 * Which collection an event belongs to decides four things here, and
 * `collectionOf` is the only thing that decides it: what an unnamed item is
 * called, where its picture comes from, which marketplace link is right, and
 * whether there is a rarity rank to print. A bot token id pointed at the
 * artifacts contract, or the reverse, produces a working link to the wrong
 * item, so all four go through `resolveItem` rather than being decided
 * separately.
 */

import { EmbedBuilder } from "@discordjs/builders";
import type { APIEmbed } from "discord-api-types/v10";
import type { Collection } from "../api/collections";
import { collectionOf } from "../api/collections";
import type { ResolvedName } from "../api/display-name";
import type { GlyphBotsClient } from "../api/glyphbots";
import {
  getOpenSeaArtifactUrl,
  getOpenSeaCollectionUrl,
  getOpenSeaUrl,
} from "../api/opensea";
import type { Artifact, OpenSeaEvent, OpenSeaPayment } from "../api/types";
import { rarityBadge } from "../commands/rarity";
import { COLORS, SALES_TOP_ITEMS } from "../config";
import { formatActor } from "../discord/embeds";
import type { SaleKind } from "./sale-kind";
import { groupTitle, SALE_KIND_TITLES } from "./sale-kind";

/** Clients the embeds need. Narrowed so tests can hand over four functions. */
export type SalesEmbedClients = {
  glyphbots: Pick<
    GlyphBotsClient,
    "getArtifactUrl" | "getBotPngUrl" | "getBotUrl"
  >;
  /**
   * Address to name. Resolved once per address per tick by the caller, and
   * answering the OpenSea username or ENS name where there is one. See
   * `../api/display-name.ts`.
   */
  displayName: (address: string) => Promise<ResolvedName>;
  /**
   * Rarity rank for one bot, or null when there is none. The caller primes
   * every token in the tick first, so this costs one request however many
   * items the sweep held. See `../api/rarity-ranks.ts`.
   *
   * Bots only. Artifacts are not ranked and asking about one would answer with
   * the rank of the bot that happens to share its number.
   */
  rarityRank: (tokenId: number) => Promise<number | null>;
  /**
   * One artifact's title, picture and source bot, memoized for the tick. See
   * `../api/artifact-details.ts`. Never called for a bot sale.
   */
  artifact: (tokenId: number) => Promise<Artifact | null>;
};

const MAX_DECIMALS = 4;
const TRAILING_ZEROS = /(\.\d*?)0+$/;
const TRAILING_DOT = /\.$/;

/**
 * `formatAmount` from `opensea-activity-bot/src/utils/utils.ts:111-136`,
 * without `ethers`.
 *
 * The original went through `formatUnits` then `Number.parseFloat`, which
 * loses precision above 2^53 wei. This does the scaling in `BigInt` and rounds
 * half up at four decimals, so the displayed string matches for every amount
 * the original got right and stays exact for the ones it did not. WETH still
 * prints as ETH.
 */
const formatAmount = (
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
  payment
    ? formatAmount(payment.quantity, payment.decimals, payment.symbol)
    : null;

/** Numeric price for sorting, `getPurchasePrice` (`event-grouping.ts:456-468`). */
const priceValue = (event: OpenSeaEvent): bigint => {
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
const sortByPriceDesc = (events: OpenSeaEvent[]): OpenSeaEvent[] =>
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
const totalSpent = (events: OpenSeaEvent[]): string | null => {
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

/** Every `#123` in a name, so the number can be compared rather than matched. */
const TOKEN_MARKER = /#(\d+)/g;

/**
 * One item's name, as a title reads it.
 *
 * The token id is appended only when the name does not already carry it.
 * OpenSea names a bot `GlyphBot #3101 - Jumpynexus`, and pinning the id on the
 * end of that gives `GlyphBot #3101 - Jumpynexus #3101`. Artifacts are named
 * without a number, so they get one.
 *
 * The comparison is on the parsed number rather than on the substring: `#31`
 * appears inside `#3101` and would otherwise read as a match.
 */
const itemLabel = (
  name: string | null,
  collection: Collection,
  tokenId: number
): string => {
  if (!name) {
    return `${collection.noun} #${tokenId}`;
  }

  for (const match of name.matchAll(TOKEN_MARKER)) {
    if (match[1] === String(tokenId)) {
      return name;
    }
  }

  return `${name} #${tokenId}`;
};

/**
 * Everything an embed says about one item, resolved once.
 *
 * Both builders go through this, so a sale and the same sale inside a sweep
 * cannot disagree about what the thing is called or where it links.
 */
type Item = {
  collection: Collection;
  tokenId: number | null;
  label: string;
  /** Marketplace link. Null only when the event carries no usable token id. */
  url: string | null;
  /** Artwork, or null when there is none to show. */
  image: string | null;
  /** Where the item lives on glyphbots.com. */
  siteUrl: string | null;
  /**
   * The bot an artifact was generated from. Null for a bot, which is its own
   * source, and null for an artifact the API had nothing for.
   */
  sourceBotTokenId: number | null;
};

const resolveItem = async (
  event: OpenSeaEvent,
  clients: SalesEmbedClients
): Promise<Item> => {
  const collection = collectionOf(event);
  const tokenId = tokenIdOf(event);
  // Truthy, not nullish: OpenSea sends `name: ""` for a token it has not
  // finished indexing, which is routine for artifacts, and an empty title makes
  // `setTitle` throw on "Purchased: ".
  const eventName = event.nft?.name || null;

  if (tokenId === null) {
    return {
      collection,
      tokenId: null,
      label: eventName ?? "Unknown item",
      url: event.nft?.opensea_url ?? null,
      image: null,
      siteUrl: null,
      sourceBotTokenId: null,
    };
  }

  if (collection.key === "artifacts") {
    // The one network call on this path, and it is what the API knows that the
    // event does not: the title, the picture and the bot behind it.
    const artifact = await clients.artifact(tokenId);
    return {
      collection,
      tokenId,
      label: itemLabel(artifact?.title || eventName, collection, tokenId),
      url: getOpenSeaArtifactUrl(tokenId),
      image: artifact?.imageUrl ?? null,
      siteUrl: clients.glyphbots.getArtifactUrl(tokenId),
      sourceBotTokenId: artifact?.botTokenId ?? null,
    };
  }

  return {
    collection,
    tokenId,
    label: itemLabel(eventName, collection, tokenId),
    url: getOpenSeaUrl(tokenId),
    image: clients.glyphbots.getBotPngUrl(tokenId),
    siteUrl: clients.glyphbots.getBotUrl(tokenId),
    sourceBotTokenId: null,
  };
};

/** The rank, or null for anything that is not a ranked bot. */
const rankOf = async (
  item: Item,
  clients: SalesEmbedClients
): Promise<number | null> =>
  item.collection.key === "bots" && item.tokenId !== null
    ? await clients.rarityRank(item.tokenId)
    : null;

/**
 * One sale, `buildSaleEmbed` + `buildEmbed` (`discord/utils.ts:122-135,347-382`).
 *
 * The title leads with what actually happened rather than always "Purchased":
 * see `./sale-kind.ts` for how a filled listing is told apart from an accepted
 * bid. `kind` defaults to `purchase` so a caller that has not classified the
 * event gets the old wording rather than a wrong one.
 *
 * "By" became "Buyer" with the same change. It was fine while every post was a
 * purchase; under "Offer accepted" it reads as the person who did the
 * accepting, which is the seller, and the field holds the buyer.
 */
export const buildSaleEmbed = async (
  event: OpenSeaEvent,
  clients: SalesEmbedClients,
  kind: SaleKind = "purchase"
): Promise<APIEmbed> => {
  const item = await resolveItem(event, clients);
  const embed = new EmbedBuilder()
    .setColor(COLORS.sale)
    .setTitle(`${SALE_KIND_TITLES[kind]}: ${item.label}`);

  if (item.url) {
    embed.setURL(item.url);
  }

  if (item.image) {
    embed.setImage(item.image);
  }

  const price = priceOf(event.payment);
  if (price) {
    embed.addFields({ name: "Price", value: price, inline: true });
  }

  // Artifacts are ERC-1155, so a sale can be several copies of one token and
  // the price above is what the whole lot went for. A bot sale is always one.
  if (event.quantity > 1) {
    embed.addFields({
      name: "Quantity",
      value: `×${event.quantity}`,
      inline: true,
    });
  }

  // Next to the price on purpose: the two are read together, and the rank is
  // the only thing on this embed that says whether the price was a good one.
  const rank = await rankOf(item, clients);
  if (rank !== null) {
    embed.addFields({ name: "Rarity", value: rarityBadge(rank), inline: true });
  }

  if (event.buyer) {
    embed.addFields({
      name: "Buyer",
      value: formatActor(await clients.displayName(event.buyer)),
      inline: true,
    });
  }

  // Named for what it links to rather than "View", so an artifact post carries
  // both its own page and the bot it came from without the two reading alike.
  if (item.siteUrl) {
    embed.addFields({
      name: item.collection.noun,
      value: `[View](${item.siteUrl})`,
      inline: true,
    });
  }

  if (item.sourceBotTokenId !== null) {
    embed.addFields({
      name: "Bot",
      value: `[#${item.sourceBotTokenId}](${clients.glyphbots.getBotUrl(item.sourceBotTokenId)})`,
      inline: true,
    });
  }

  return embed.toJSON() as APIEmbed;
};

/**
 * One sweep, `buildGroupEmbed` (`discord/utils.ts:484-536`).
 *
 * Every event in a group shares a collection, because `actorKeyFor` puts it in
 * the key. That is what lets the title name what was bought, the header link
 * point at the right collection, and the thumbnail come from the right place.
 */
export const buildGroupEmbed = async (
  events: OpenSeaEvent[],
  clients: SalesEmbedClients,
  kinds: SaleKind[] = []
): Promise<APIEmbed> => {
  const sorted = sortByPriceDesc(events);
  const count = events.length;
  const collection = collectionOf(sorted[0] ?? ({} as OpenSeaEvent));
  const embed = new EmbedBuilder()
    .setColor(COLORS.sale)
    .setTitle(groupTitle(count, kinds, collection.plural))
    .setURL(getOpenSeaCollectionUrl(collection.slug));

  const spent = totalSpent(events);
  if (spent) {
    embed.addFields({ name: "Total Spent", value: spent, inline: true });
  }

  const buyer = sorted[0]?.buyer;
  if (buyer) {
    embed.addFields({
      name: "Buyer",
      value: formatActor(await clients.displayName(buyer)),
      inline: true,
    });
  }

  // The priciest few, resolved before the rows are written because the
  // thumbnail comes out of the same list and must not be a second lookup.
  const top: Item[] = [];
  for (const event of sorted.slice(0, SALES_TOP_ITEMS)) {
    top.push(await resolveItem(event, clients));
  }

  if (top.length > 0) {
    // A for loop rather than `map`, because the rank lookup is async. It is
    // also cached by the caller, so this is four map reads in the usual case.
    const rows: string[] = [];
    for (const [index, item] of top.entries()) {
      const price = priceOf(sorted[index]?.payment);
      const suffix = price ? ` - ${price}` : "";
      const link = item.url ? `[${item.label}](${item.url})` : item.label;
      const rank = await rankOf(item, clients);
      const rarity = rank === null ? "" : ` · ${rarityBadge(rank)}`;
      rows.push(`${index + 1}. ${link}${suffix}${rarity}`);
    }

    let list = rows.join("\n");
    if (count > SALES_TOP_ITEMS) {
      list += "\n…";
    }
    embed.addFields({ name: "Top Items", value: list });
  }

  // The thumbnail is the priciest item, and it is a URL rather than an
  // attachment. See the note at the top of this file.
  const headline = top[0]?.image;
  if (headline) {
    embed.setThumbnail(headline);
  }

  return embed.toJSON() as APIEmbed;
};

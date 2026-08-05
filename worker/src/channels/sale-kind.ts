/**
 * Telling a filled listing from an accepted offer.
 *
 * #trading-floor posted "Purchased: GlyphBot #1780" for every sale, including
 * the ones where nobody bought anything: the holder accepted a standing bid.
 * Reading those two as the same event is wrong in the direction that matters,
 * because a collection-offer sweep and a floor purchase say opposite things
 * about the collection.
 *
 * ## The event alone does not say
 *
 * An OpenSea v2 `sale` event carries `seller`, `buyer`, `payment`,
 * `transaction`, `order_hash` and `protocol_address`, and nothing that names a
 * side. So there are two signals, and this module uses both.
 *
 * **The free one, and why it is only a fallback.** Seaport cannot pull native
 * ETH from a bidder's wallet, so an offer has to be denominated in an ERC-20
 * and in practice that is WETH; a listing on this chain settles in native ETH.
 * An ERC-20 payment therefore means an offer was accepted, and it is right
 * nearly always. Nearly: a seller *can* denominate a listing in WETH, and that
 * case would read as an accepted offer with no way to tell from the event.
 *
 * **The definitive one.** `order_hash` and `protocol_address` together fetch
 * the Seaport order that filled, and which side signed it is plain in the
 * order: `parameters.offer` holds the NFT on a listing and an ERC-20 on a bid.
 * A filled order still resolves (status `FULFILLED`, verified live 2026-07-27),
 * so this works after the fact and not just while the order is live. It also
 * comes with `criteria`, which is the only way to know a collection offer from
 * a trait offer from a plain one.
 *
 * One extra request per distinct order hash buys all of that. The cache is what
 * makes it cheap rather than merely affordable: a collection-offer sweep is N
 * sale events sharing a single order hash (observed: six events, one hash), so
 * the whole sweep costs one lookup. Sales run about 1.24/day, so even the
 * uncached worst case is noise against the subrequest budget.
 *
 * When the lookup fails, for any reason, this falls back to the payment
 * heuristic rather than refusing to classify. A slightly wrong title is a much
 * better outcome than a post that does not go out.
 */

import type { OpenSeaClient } from "../api/opensea";
import type { OpenSeaEvent, OpenSeaOrder } from "../api/types";
import { createLogger } from "../utils/logger";

const log = createLogger("Sales/kind");

/**
 * What actually happened, from the buyer's side.
 *
 * `purchase` is someone filling a listing. The other three are a holder
 * accepting a bid, split by how the bid was scoped, because "collection offer
 * accepted" and "offer accepted" are genuinely different news.
 */
export type SaleKind =
  | "purchase"
  | "offer"
  | "collection-offer"
  | "trait-offer";

/** True for everything except an outright purchase. */
export const isOfferKind = (kind: SaleKind): boolean => kind !== "purchase";

/**
 * Seaport `ItemType`, the enum used by `parameters.offer[].itemType`.
 *
 * Only the split matters here: 0 and 1 are currency, 2 through 5 are the NFT
 * (the `_WITH_CRITERIA` pair being how a criteria-based order names a set of
 * tokens rather than one).
 */
const SEAPORT_ITEM_TYPE = {
  NATIVE: 0,
  ERC20: 1,
  ERC721: 2,
  ERC1155: 3,
  ERC721_WITH_CRITERIA: 4,
  ERC1155_WITH_CRITERIA: 5,
} as const;

/** The zero address, which is how a native-ETH payment names its token. */
const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * The free signal: an ERC-20 payment means a bid was filled.
 *
 * Used when there is no order to look up and whenever the lookup fails. It
 * cannot tell a collection offer from any other, so it never answers anything
 * more specific than `offer`.
 */
export const classifyByPayment = (event: OpenSeaEvent): SaleKind => {
  const payment = event.payment;
  if (!payment) {
    return "purchase";
  }

  const isNative =
    payment.token_address?.toLowerCase() === NATIVE_TOKEN_ADDRESS ||
    payment.symbol === "ETH";

  return isNative ? "purchase" : "offer";
};

/** Read the side and the scope off a fetched order. Pure. */
export const classifyOrder = (order: OpenSeaOrder): SaleKind | null => {
  const offered = order.protocol_data?.parameters?.offer?.[0];
  if (!offered) {
    return null;
  }

  const offersAnNFT =
    offered.itemType === SEAPORT_ITEM_TYPE.ERC721 ||
    offered.itemType === SEAPORT_ITEM_TYPE.ERC1155 ||
    offered.itemType === SEAPORT_ITEM_TYPE.ERC721_WITH_CRITERIA ||
    offered.itemType === SEAPORT_ITEM_TYPE.ERC1155_WITH_CRITERIA;

  if (offersAnNFT) {
    return "purchase";
  }

  const offersCurrency =
    offered.itemType === SEAPORT_ITEM_TYPE.NATIVE ||
    offered.itemType === SEAPORT_ITEM_TYPE.ERC20;

  if (!offersCurrency) {
    // An item type outside the enum. Say nothing rather than guess; the caller
    // falls back to the payment heuristic.
    return null;
  }

  if (order.criteria?.trait) {
    return "trait-offer";
  }
  if (order.criteria?.collection || order.criteria?.contract) {
    return "collection-offer";
  }
  return "offer";
};

export type SaleClassifier = (event: OpenSeaEvent) => Promise<SaleKind>;

/**
 * Build a classifier for one tick, memoized on the order hash.
 *
 * The memo is the point: a sweep against one standing collection offer arrives
 * as many sale events carrying the same `order_hash`, and they all get the same
 * answer for one request.
 */
export const createSaleClassifier = (
  opensea: Pick<OpenSeaClient, "fetchOrder">
): SaleClassifier => {
  const cache = new Map<string, SaleKind>();

  return async (event) => {
    const fallback = classifyByPayment(event);
    const { order_hash: orderHash, protocol_address: protocolAddress } = event;

    if (!(orderHash && protocolAddress)) {
      return fallback;
    }

    const cached = cache.get(orderHash);
    if (cached) {
      return cached;
    }

    let kind: SaleKind | null = null;
    try {
      const order = await opensea.fetchOrder(orderHash, protocolAddress);
      kind = order ? classifyOrder(order) : null;
    } catch {
      kind = null;
    }

    if (kind === null) {
      log.debug(
        `Order ${orderHash} told us nothing, wording this sale from its payment token instead (${fallback})`
      );
      // Deliberately not cached. The fallback is cheap to recompute and an
      // order that failed once may resolve on the next tick.
      return fallback;
    }

    cache.set(orderHash, kind);
    return kind;
  };
};

/** The verb for one sale, as it leads the embed title. */
export const SALE_KIND_TITLES: Record<SaleKind, string> = {
  purchase: "Purchased",
  offer: "Offer accepted",
  "collection-offer": "Collection offer accepted",
  "trait-offer": "Trait offer accepted",
};

/**
 * The title for a settled sweep.
 *
 * A group is one actor's events in one collection (`actorKeyFor` in
 * `./sales-grouping.ts` keys sales by buyer and collection), so the framing is
 * the buyer's throughout and `plural` can name what they bought: "GlyphBots",
 * "artifacts". It defaults to "items" for a caller that has not said.
 *
 * Note the wording for an offer sweep is "bought via" rather than "N offers
 * accepted": six fills against one standing collection offer is one offer, not
 * six, and pluralising it would be a straight lie about what happened. The
 * plain `offer` case is the exception and stays counted, because there really
 * were N separate bids, and it names the offers rather than the items for the
 * same reason.
 *
 * A mixed group keeps the general wording. It is the honest term for "this
 * buyer ended up with N of them", and mixing a sweep with a floor purchase is
 * rare enough not to deserve a sentence of its own.
 */
export const groupTitle = (
  count: number,
  kinds: SaleKind[],
  plural = "items"
): string => {
  const first = kinds[0];
  const uniform =
    first !== undefined && kinds.every((kind) => kind === first) ? first : null;

  switch (uniform) {
    case "collection-offer":
      return `${count} ${plural} bought via collection offer`;
    case "trait-offer":
      return `${count} ${plural} bought via trait offer`;
    case "offer":
      return `${count} offers accepted`;
    default:
      return `${count} ${plural} purchased`;
  }
};

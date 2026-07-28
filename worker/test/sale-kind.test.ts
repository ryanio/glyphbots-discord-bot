/**
 * Telling a filled listing from an accepted offer.
 *
 * The order payloads below are trimmed copies of live responses (glyphbots,
 * 2026-07-27): one collection offer that a sweeper filled repeatedly, and one
 * ordinary listing that sold. Their shape is the whole basis for the
 * classification, so they are reproduced rather than invented.
 */

import { describe, expect, it, vi } from "vitest";
import type { OpenSeaEvent, OpenSeaOrder } from "../src/api/types";
import {
  classifyByPayment,
  classifyOrder,
  createSaleClassifier,
  groupTitle,
  isOfferKind,
} from "../src/channels/sale-kind";

const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const NATIVE = "0x0000000000000000000000000000000000000000";
const SEAPORT = "0x0000000000000068f116a894984e2db1123eb395";

const sale = (overrides: Partial<OpenSeaEvent> = {}): OpenSeaEvent => ({
  event_type: "sale",
  event_timestamp: 1_785_188_207,
  chain: "ethereum",
  quantity: 1,
  buyer: "0x00a839de7922491683f547a67795204763ff8237",
  seller: "0xd1c90016bc2663f03fabc2bfa2b8d8d342784d41",
  order_hash: "0xaa06",
  protocol_address: SEAPORT,
  payment: {
    quantity: "200000000000000",
    token_address: WETH,
    decimals: 18,
    symbol: "WETH",
  },
  ...overrides,
});

/** The buyer signed it and put WETH up: a bid. */
const collectionOffer: OpenSeaOrder = {
  order_hash: "0xaa06",
  status: "ACTIVE",
  criteria: { collection: { slug: "glyphbots" } },
  protocol_data: {
    parameters: {
      offerer: "0x00a839de7922491683f547a67795204763ff8237",
      offer: [
        {
          itemType: 1,
          token: WETH,
          identifierOrCriteria: "0",
          startAmount: "4000000000000000",
          endAmount: "4000000000000000",
        },
      ],
    },
  },
};

/** The seller signed it and put the NFT up: a listing. */
const listing: OpenSeaOrder = {
  order_hash: "0xe0f8",
  status: "FULFILLED",
  criteria: null,
  protocol_data: {
    parameters: {
      offerer: "0xbf8cdbeedd1e5c06c20c60c926c42f5b37ff2a92",
      offer: [
        {
          itemType: 2,
          token: "0xb6c2c2d2999c1b532e089a7ad4cb7f8c91cf5075",
          identifierOrCriteria: "1780",
          startAmount: "1",
          endAmount: "1",
        },
      ],
    },
  },
};

describe("classifyByPayment", () => {
  it("reads native ETH as a purchase", () => {
    expect(
      classifyByPayment(
        sale({
          payment: {
            quantity: "1",
            token_address: NATIVE,
            decimals: 18,
            symbol: "ETH",
          },
        })
      )
    ).toBe("purchase");
  });

  it("reads an ERC-20 payment as an accepted offer", () => {
    // Seaport cannot pull native ETH from a bidder, so a bid is always some
    // ERC-20 and in practice WETH.
    expect(classifyByPayment(sale())).toBe("offer");
  });

  it("reads a missing payment as a purchase", () => {
    expect(classifyByPayment(sale({ payment: undefined }))).toBe("purchase");
  });
});

describe("classifyOrder", () => {
  it("calls an order offering the NFT a purchase", () => {
    expect(classifyOrder(listing)).toBe("purchase");
  });

  it("calls an order offering currency against a collection a collection offer", () => {
    expect(classifyOrder(collectionOffer)).toBe("collection-offer");
  });

  it("separates a trait offer from a collection offer", () => {
    expect(
      classifyOrder({
        ...collectionOffer,
        criteria: {
          collection: { slug: "glyphbots" },
          trait: { type: "Theme", value: "Ocean" },
        },
      })
    ).toBe("trait-offer");
  });

  it("calls an uncriteria'd bid a plain offer", () => {
    expect(classifyOrder({ ...collectionOffer, criteria: null })).toBe("offer");
  });

  it("answers null for an order it cannot read", () => {
    // The caller falls back to the payment heuristic rather than guessing.
    expect(classifyOrder({ order_hash: "0x", protocol_data: {} })).toBeNull();
  });
});

describe("createSaleClassifier", () => {
  it("prefers the order over the payment heuristic", async () => {
    // The case the heuristic gets wrong on its own: a listing denominated in
    // WETH, which pays like a bid and is not one.
    const classify = createSaleClassifier({
      fetchOrder: vi.fn(() => Promise.resolve(listing)),
    });

    expect(await classify(sale())).toBe("purchase");
  });

  it("fetches one order for a whole sweep", async () => {
    // Six fills of one standing collection offer arrive as six sale events
    // carrying the same order hash. That must cost one request.
    const fetchOrder = vi.fn(() => Promise.resolve(collectionOffer));
    const classify = createSaleClassifier({ fetchOrder });

    for (let i = 0; i < 6; i += 1) {
      expect(await classify(sale({ event_timestamp: 1000 + i }))).toBe(
        "collection-offer"
      );
    }

    expect(fetchOrder).toHaveBeenCalledTimes(1);
    expect(fetchOrder).toHaveBeenCalledWith("0xaa06", SEAPORT);
  });

  it("falls back to the payment when the order cannot be fetched", async () => {
    const classify = createSaleClassifier({
      fetchOrder: vi.fn(() => Promise.resolve(null)),
    });

    expect(await classify(sale())).toBe("offer");
  });

  it("falls back to the payment when the order lookup throws", async () => {
    const classify = createSaleClassifier({
      fetchOrder: vi.fn(() => Promise.reject(new Error("500"))),
    });

    expect(await classify(sale())).toBe("offer");
  });

  it("does not spend a request when the event names no order", async () => {
    const fetchOrder = vi.fn(() => Promise.resolve(null));
    const classify = createSaleClassifier({ fetchOrder });

    expect(
      await classify(
        sale({ order_hash: undefined, protocol_address: undefined })
      )
    ).toBe("offer");
    expect(fetchOrder).not.toHaveBeenCalled();
  });
});

describe("groupTitle", () => {
  it("keeps the original wording for a sweep of purchases", () => {
    expect(groupTitle(6, Array(6).fill("purchase"))).toBe("6 items purchased");
  });

  it("says what a collection offer sweep actually was", () => {
    // Not "6 collection offers accepted": six fills against one standing offer
    // is one offer.
    expect(groupTitle(6, Array(6).fill("collection-offer"))).toBe(
      "6 items bought via collection offer"
    );
  });

  it("names trait offers separately", () => {
    expect(groupTitle(3, Array(3).fill("trait-offer"))).toBe(
      "3 items bought via trait offer"
    );
  });

  it("pluralises plain offers, which really are one each", () => {
    expect(groupTitle(2, ["offer", "offer"])).toBe("2 offers accepted");
  });

  it("falls back to the general wording for a mixed group", () => {
    expect(groupTitle(2, ["purchase", "collection-offer"])).toBe(
      "2 items purchased"
    );
  });

  it("falls back when nothing was classified at all", () => {
    expect(groupTitle(4, [])).toBe("4 items purchased");
  });
});

describe("isOfferKind", () => {
  it("is true for every kind except an outright purchase", () => {
    expect(isOfferKind("purchase")).toBe(false);
    expect(isOfferKind("offer")).toBe(true);
    expect(isOfferKind("collection-offer")).toBe(true);
    expect(isOfferKind("trait-offer")).toBe(true);
  });
});

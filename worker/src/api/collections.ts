/**
 * The two collections the sales feed watches, and how to tell an event's from
 * the event alone.
 *
 * They are separate in every way that reaches an embed: separate contracts,
 * separate OpenSea slugs, separate artwork, and only one of them has a rarity
 * rank. So nothing downstream of a sweep may assume which one it is holding.
 * Ask `collectionOf`.
 *
 * The descriptors carry the display nouns as well as the ids, because the
 * alternative is a `key === "artifacts"` ternary at every place a title is
 * built, and there are six of those across the two embed builders. A third
 * collection is a third entry here and nothing else.
 */

import {
  ARTIFACTS_COLLECTION_SLUG,
  ARTIFACTS_CONTRACT,
  GLYPHBOTS_COLLECTION_SLUG,
  GLYPHBOTS_CONTRACT,
} from "../config";
import type { OpenSeaEvent } from "./types";

export type CollectionKey = "bots" | "artifacts";

export type Collection = {
  key: CollectionKey;
  /** OpenSea slug, which is what the events endpoint is scoped by. */
  slug: string;
  contract: string;
  /** One item, as `${noun} #${tokenId}` when nothing has named it. */
  noun: string;
  /** Several items, as a group title reads them. */
  plural: string;
};

export const BOTS: Collection = {
  key: "bots",
  slug: GLYPHBOTS_COLLECTION_SLUG,
  contract: GLYPHBOTS_CONTRACT,
  noun: "GlyphBot",
  plural: "GlyphBots",
};

/**
 * Artifacts are ERC-1155 where the bots are ERC-721, which is why "artifacts"
 * is lower case next to "GlyphBots": a bot is a named character and an artifact
 * is an edition of a thing.
 */
export const ARTIFACTS: Collection = {
  key: "artifacts",
  slug: ARTIFACTS_COLLECTION_SLUG,
  contract: ARTIFACTS_CONTRACT,
  noun: "Artifact",
  plural: "artifacts",
};

/** Both, in the order one tick sweeps them. */
export const WATCHED_COLLECTIONS: readonly Collection[] = [BOTS, ARTIFACTS];

const BY_SLUG = new Map(
  WATCHED_COLLECTIONS.map((collection) => [collection.slug, collection])
);

const BY_CONTRACT = new Map(
  WATCHED_COLLECTIONS.map((collection) => [
    collection.contract.toLowerCase(),
    collection,
  ])
);

export const collectionOfSlug = (slug: string | undefined): Collection | null =>
  (slug === undefined ? null : BY_SLUG.get(slug)) ?? null;

export const collectionOfContract = (
  address: string | undefined
): Collection | null =>
  (address === undefined ? null : BY_CONTRACT.get(address.toLowerCase())) ??
  null;

/**
 * Which collection one event belongs to.
 *
 * The slug is read first and the contract second, because both are on the live
 * payload (verified 2026-08-04 on an artifact sale) and the slug is the thing
 * the sweep actually asked for. Either one alone would do; taking both means a
 * response that drops one field still classifies.
 *
 * An event carrying neither falls back to bots. Every event reaching this comes
 * from a sweep of one of the two slugs, so the fallback is unreachable in
 * practice; it answers a collection rather than null so that a payload missing
 * both fields still produces a post, with the wrong picture at worst.
 */
export const collectionOf = (event: OpenSeaEvent): Collection =>
  collectionOfSlug(event.nft?.collection) ??
  collectionOfContract(event.nft?.contract) ??
  BOTS;

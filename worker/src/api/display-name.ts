/**
 * One address, one name a human recognises.
 *
 * Every surface that used to print `0x1a2b3c…7f8e9d` goes through here now: the
 * sales feed's buyer, the mint watcher's minter, `/owner`, `/sales`,
 * `/activity`, `/listings` and the inline `b#123` lookup. The address is the
 * last resort rather than the default.
 *
 * ## Where the name comes from
 *
 * `/accounts/{address}` answers three name fields and they are read in this
 * order, most deliberate first:
 *
 *   1. `username`, the handle the holder chose on OpenSea.
 *   2. `ens_name`, the reverse record. OpenSea does the resolution, which is
 *      the only reason there is no ENS client in this Worker.
 *   3. `display_name`, OpenSea's own pick between the two. Read last purely as
 *      a backstop; in practice it repeats one of the first two.
 *
 * Then the shortened address, which is not a failure: an address with no name
 * anywhere is the common case, and `shortAddress` is a perfectly good label for
 * it.
 *
 * ## The cache is per call site, on purpose
 *
 * This was `createNameResolver` inside `../channels/sales.ts`, private to the
 * sales feed. It is here because the same lookup and the same caching are
 * wanted by five other places, and the reasoning about lifetime carries over
 * unchanged: the Node bot kept a process-lifetime LRU
 * (`opensea-activity-bot/src/opensea.ts:183-193`), a Worker isolate does not
 * live long enough for that to pay off, and one sweep or one interaction is a
 * handful of distinct addresses. So a resolver is built per tick, per command
 * invocation or per message, and dies with it.
 *
 * A lookup failure is never an error. It resolves to the short address and the
 * caller cannot tell the difference except through `isAddress`.
 */

import { createLogger, getErrorMessage } from "../utils/logger";
import { shortAddress } from "./glyphbots";
import type { OpenSeaClient } from "./opensea";
import type { OpenSeaAccount } from "./types";

const log = createLogger("Names");

export type ResolvedName = {
  /** The address as it was asked for, unchanged. */
  address: string;
  /** What to print: the username, else the ENS name, else the short address. */
  label: string;
  username: string | null;
  ens: string | null;
  /**
   * True when `label` is the shortened address, so a caller can render it as a
   * code span rather than as prose. See `formatActor` in
   * `../discord/embeds.ts`.
   */
  isAddress: boolean;
};

/** Trim, and treat an empty or whitespace-only field as absent. */
const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * Pick the label for one account. Pure, so the preference order is testable
 * without a network.
 */
export const preferredName = (
  account: OpenSeaAccount | null,
  address: string
): ResolvedName => {
  const username = clean(account?.username);
  const ens = clean(account?.ens_name);
  const display = clean(account?.display_name);
  const label = username ?? ens ?? display;

  return {
    address,
    label: label ?? shortAddress(address),
    username,
    ens,
    isAddress: label === null,
  };
};

/** A name for an address, with no OpenSea account behind it. */
export const addressOnly = (address: string): ResolvedName =>
  preferredName(null, address);

export type DisplayNameResolver = {
  resolve: (address: string) => Promise<ResolvedName>;
  /**
   * Record an account this caller already fetched for its own reasons, so the
   * resolver does not spend a second request on the same address. The username
   * lookup path in `../lookups/embeds.ts` is the case this exists for: it
   * fetches the account by handle, and would otherwise re-fetch it by address
   * one call later.
   */
  prime: (account: OpenSeaAccount) => void;
};

export const createDisplayNameResolver = (
  opensea: Pick<OpenSeaClient, "fetchAccount">
): DisplayNameResolver => {
  const cache = new Map<string, ResolvedName>();

  return {
    prime: (account) => {
      if (account.address) {
        cache.set(
          account.address.toLowerCase(),
          preferredName(account, account.address)
        );
      }
    },

    resolve: async (address) => {
      const key = address.toLowerCase();
      const cached = cache.get(key);
      if (cached) {
        return cached;
      }

      let account: OpenSeaAccount | null = null;
      try {
        account = await opensea.fetchAccount(address);
      } catch (error) {
        log.debug(
          `Name lookup failed for ${address}: ${getErrorMessage(error)}`
        );
      }

      const resolved = preferredName(account, address);
      cache.set(key, resolved);
      return resolved;
    },
  };
};

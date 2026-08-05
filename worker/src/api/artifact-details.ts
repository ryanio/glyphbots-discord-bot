/**
 * First-party details for the artifacts in one tick, asked for once each.
 *
 * The same shape and lifetime as `./display-name.ts` and `./rarity-ranks.ts`:
 * one resolver per cron tick or per command invocation, a memo that lives as
 * long as the resolver, and a miss cached as a miss so a token that the API has
 * nothing for is not asked about twice.
 *
 * This is what puts a picture and a title on an artifact sale. An OpenSea sale
 * event carries `nft.name` but it is routinely the empty string for these
 * tokens (live example: artifact #175), and the API here always has the title,
 * the image and the bot the artifact came from.
 *
 * Unlike ranks there is no batch endpoint, so this is one request per distinct
 * token id. That is affordable because it is bounded by what a single message
 * can show: one for a lone sale, at most `SALES_TOP_ITEMS` plus a thumbnail for
 * a sweep. Artifacts are ERC-1155, so the same id really can appear several
 * times in one window, and the memo is what makes that free.
 */

import type { GlyphBotsClient } from "./glyphbots";
import type { Artifact } from "./types";

export type ArtifactDetails = {
  /** One artifact by contract token id. `null` when the API has none. */
  get: (tokenId: number) => Promise<Artifact | null>;
};

export const createArtifactDetails = (
  glyphbots: Pick<GlyphBotsClient, "fetchArtifact">
): ArtifactDetails => {
  // Promises rather than values, so two callers asking for the same id before
  // the first answer lands share the one request.
  const cache = new Map<number, Promise<Artifact | null>>();

  return {
    get: (tokenId) => {
      if (!(Number.isInteger(tokenId) && tokenId > 0)) {
        return Promise.resolve(null);
      }

      const cached = cache.get(tokenId);
      if (cached) {
        return cached;
      }

      // The client already turns every failure into `null`, so nothing here
      // can reject and no caller has to guard against a missing artifact
      // differently from a failed lookup.
      const pending = glyphbots.fetchArtifact(tokenId);
      cache.set(tokenId, pending);
      return pending;
    },
  };
};

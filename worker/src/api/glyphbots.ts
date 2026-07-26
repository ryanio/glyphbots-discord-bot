/**
 * GlyphBots API client, ported from `src/api/glyphbots.ts`.
 *
 * The Node version reads `process.env.GLYPHBOTS_API_URL` at module scope
 * (`src/api/glyphbots.ts:17`), which on Workers is `undefined` at import time
 * no matter what the binding says. Here the base URL is a constructor
 * argument: the scheduled handler builds a client from its `env` and passes it
 * down. No module-level singleton reads the environment.
 *
 * Phase 1 needs the recently-minted list and the two URL helpers. The rest of
 * the surface (`fetchBot`, `fetchBotStory`, `fetchArtifact`, ...) arrives with
 * the slash commands in Phase 2.
 */

import { DEFAULT_GLYPHBOTS_API_URL } from "../config";
import { createLogger, getErrorMessage } from "../utils/logger";
import type { Artifact, ArtifactsListResponse } from "./types";

const log = createLogger("GlyphBots API");

const JSON_HEADERS = { "Content-Type": "application/json" };

export type GlyphBotsClient = {
  /** Origin the client is pointed at. */
  baseUrl: string;
  fetchRecentArtifacts: (limit?: number) => Promise<Artifact[]>;
  getArtifactUrl: (contractTokenId: number) => string;
  getBotPngUrl: (tokenId: number) => string;
  getBotUrl: (tokenId: number) => string;
};

/**
 * Build a client bound to one origin. Call this from the request or scheduled
 * handler with the live `env`, never at module scope.
 */
export const createGlyphBotsClient = (
  env: { GLYPHBOTS_API_URL?: string } = {}
): GlyphBotsClient => {
  const baseUrl = env.GLYPHBOTS_API_URL ?? DEFAULT_GLYPHBOTS_API_URL;

  const fetchRecentArtifacts = async (limit = 50): Promise<Artifact[]> => {
    const url = `${baseUrl}/api/artifacts/recently-minted?limit=${limit}`;
    log.debug(`Fetching recent artifacts from ${url}`);

    try {
      const response = await fetch(url, { headers: JSON_HEADERS });

      if (!response.ok) {
        log.error(`Failed to fetch recent artifacts: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as ArtifactsListResponse;

      if (!data.ok) {
        log.error(`API error: ${data.error}`);
        return [];
      }

      log.debug(`Fetched ${data.items.length} recent artifacts`);
      return data.items;
    } catch (error) {
      log.error(`Error fetching recent artifacts: ${getErrorMessage(error)}`);
      return [];
    }
  };

  return {
    baseUrl,
    fetchRecentArtifacts,
    getArtifactUrl: (contractTokenId) =>
      `${baseUrl}/artifact/${contractTokenId}`,
    getBotPngUrl: (tokenId) => `${baseUrl}/bots/pngs/${tokenId}.png`,
    getBotUrl: (tokenId) => `${baseUrl}/bot/${tokenId}`,
  };
};

/**
 * Shorten an address for display, identical to `src/api/opensea.ts:131`.
 * Lives here so Phase 1 does not need the OpenSea module at all.
 */
export const shortAddress = (addr: string): string =>
  `${addr.slice(0, 7)}…${addr.slice(37, 42)}`;

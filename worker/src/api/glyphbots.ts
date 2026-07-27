/**
 * GlyphBots API client.
 *
 * The base URL is a constructor argument rather than a module-level read of
 * the environment. The Node bot did the latter (`src/api/glyphbots.ts:17` at
 * `c75d6a8`), which on Workers resolves to `undefined` at import time no
 * matter what the binding says, because the module body runs before any
 * binding exists. Here the request or scheduled handler builds a client from
 * its `env` and passes it down, and no singleton captures anything.
 */

import { DEFAULT_GLYPHBOTS_API_URL } from "../config";
import { createLogger, getErrorMessage } from "../utils/logger";
import type {
  Artifact,
  ArtifactResponse,
  ArtifactSummary,
  ArtifactsListResponse,
  Bot,
  BotResponse,
  BotStory,
  BotStoryResponse,
} from "./types";

const log = createLogger("GlyphBots API");

const JSON_HEADERS = { "Content-Type": "application/json" };

export type GlyphBotsClient = {
  /** Origin the client is pointed at. */
  baseUrl: string;
  fetchArtifact: (contractTokenId: number) => Promise<Artifact | null>;
  /** Mint counts for the idle nudge's fun facts. `null` when unavailable. */
  fetchArtifactSummary: () => Promise<ArtifactSummary | null>;
  fetchBot: (tokenId: number) => Promise<Bot | null>;
  fetchBotStory: (tokenId: number) => Promise<BotStory | null>;
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

  const fetchArtifact = async (
    contractTokenId: number
  ): Promise<Artifact | null> => {
    const url = `${baseUrl}/api/artifacts/${contractTokenId}`;
    log.debug(`Fetching artifact ${contractTokenId} from ${url}`);

    try {
      const response = await fetch(url, { headers: JSON_HEADERS });

      if (!response.ok) {
        log.error(
          `Failed to fetch artifact ${contractTokenId}: ${response.status}`
        );
        return null;
      }

      const data = (await response.json()) as ArtifactResponse;

      if (!(data.ok && data.artifact)) {
        log.error(`API error for artifact ${contractTokenId}: ${data.error}`);
        return null;
      }

      return data.artifact;
    } catch (error) {
      log.error(
        `Error fetching artifact ${contractTokenId}: ${getErrorMessage(error)}`
      );
      return null;
    }
  };

  /**
   * The summary branch of the same endpoint the mint watcher polls.
   *
   * Every field is checked before the object is handed back, because the only
   * consumer prints these numbers as claims about the collection. A response
   * missing a count reads as no summary at all rather than as a zero.
   */
  const fetchArtifactSummary = async (): Promise<ArtifactSummary | null> => {
    const url = `${baseUrl}/api/artifacts/recently-minted?summary=true`;

    try {
      const response = await fetch(url, { headers: JSON_HEADERS });

      if (!response.ok) {
        log.error(`Failed to fetch the artifact summary: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as Partial<ArtifactSummary>;
      const { total, last1d, last7d, last30d } = data;

      if (
        ![total, last1d, last7d, last30d].every(
          (count) => typeof count === "number" && Number.isFinite(count)
        )
      ) {
        log.warn("Artifact summary was missing a count, ignoring it");
        return null;
      }

      return {
        total: total as number,
        last1d: last1d as number,
        last7d: last7d as number,
        last30d: last30d as number,
      };
    } catch (error) {
      log.error(
        `Error fetching the artifact summary: ${getErrorMessage(error)}`
      );
      return null;
    }
  };

  const fetchBot = async (tokenId: number): Promise<Bot | null> => {
    const url = `${baseUrl}/api/bot/${tokenId}`;
    log.debug(`Fetching bot ${tokenId} from ${url}`);

    try {
      const response = await fetch(url, { headers: JSON_HEADERS });

      if (!response.ok) {
        log.error(`Failed to fetch bot ${tokenId}: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as BotResponse;
      return data.bot ?? null;
    } catch (error) {
      log.error(`Error fetching bot ${tokenId}: ${getErrorMessage(error)}`);
      return null;
    }
  };

  const fetchBotStory = async (tokenId: number): Promise<BotStory | null> => {
    const url = `${baseUrl}/api/bot/${tokenId}/story`;
    log.debug(`Fetching story for bot ${tokenId} from ${url}`);

    try {
      const response = await fetch(url, { headers: JSON_HEADERS });

      if (!response.ok) {
        log.error(
          `Failed to fetch story for bot ${tokenId}: ${response.status}`
        );
        return null;
      }

      const data = (await response.json()) as BotStoryResponse;

      if (data.error) {
        log.warn(`Story API warning for bot ${tokenId}: ${data.error}`);
      }

      return data.story ?? null;
    } catch (error) {
      log.error(
        `Error fetching story for bot ${tokenId}: ${getErrorMessage(error)}`
      );
      return null;
    }
  };

  return {
    baseUrl,
    fetchArtifact,
    fetchArtifactSummary,
    fetchBot,
    fetchBotStory,
    fetchRecentArtifacts,
    getArtifactUrl: (contractTokenId) =>
      `${baseUrl}/artifact/${contractTokenId}`,
    getBotPngUrl: (tokenId) => `${baseUrl}/bots/pngs/${tokenId}.png`,
    getBotUrl: (tokenId) => `${baseUrl}/bot/${tokenId}`,
  };
};

/**
 * Shorten an address for display.
 *
 * Lives here rather than in `./opensea.ts` so the mint watcher, which touches
 * no OpenSea endpoint, does not have to import that module for one helper.
 */
export const shortAddress = (addr: string): string =>
  `${addr.slice(0, 7)}…${addr.slice(37, 42)}`;

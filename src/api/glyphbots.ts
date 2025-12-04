import { prefixedLogger } from "../lib/logger";
import type {
  Artifact,
  ArtifactResponse,
  ArtifactsListResponse,
  ArtifactsSummaryResponse,
  Bot,
  BotResponse,
  BotStory,
  BotStoryResponse,
} from "../lib/types";
import { DEFAULT_GLYPHBOTS_API_URL, getErrorMessage } from "../lib/utils";

const log = prefixedLogger("GlyphBots API");

const API_BASE_URL = process.env.GLYPHBOTS_API_URL ?? DEFAULT_GLYPHBOTS_API_URL;

/**
 * Fetch options with JSON headers
 */
const fetchOptions: RequestInit = {
  headers: {
    "Content-Type": "application/json",
  },
};

/**
 * Fetch the summary of recently minted artifacts
 * Returns counts for total, last 1d, 7d, and 30d
 */
export const fetchArtifactsSummary =
  async (): Promise<ArtifactsSummaryResponse | null> => {
    const url = `${API_BASE_URL}/api/artifacts/recently-minted?summary=true`;
    log.debug(`Fetching artifacts summary from ${url}`);

    try {
      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        log.error(`Failed to fetch artifacts summary: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as ArtifactsSummaryResponse;
      log.debug(
        `Artifacts summary: total=${data.total}, last7d=${data.last7d}`
      );
      return data;
    } catch (error) {
      log.error(`Error fetching artifacts summary: ${getErrorMessage(error)}`);
      return null;
    }
  };

/**
 * Fetch recently minted artifacts list
 */
export const fetchRecentArtifacts = async (limit = 50): Promise<Artifact[]> => {
  const url = `${API_BASE_URL}/api/artifacts/recently-minted?limit=${limit}`;
  log.debug(`Fetching recent artifacts from ${url}`);

  try {
    const response = await fetch(url, fetchOptions);

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

/**
 * Fetch a single artifact by contract token ID
 */
export const fetchArtifact = async (
  contractTokenId: number
): Promise<Artifact | null> => {
  const url = `${API_BASE_URL}/api/artifacts/${contractTokenId}`;
  log.debug(`Fetching artifact ${contractTokenId} from ${url}`);

  try {
    const response = await fetch(url, fetchOptions);

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

    log.debug(`Fetched artifact: ${data.artifact.title}`);
    return data.artifact;
  } catch (error) {
    log.error(
      `Error fetching artifact ${contractTokenId}: ${getErrorMessage(error)}`
    );
    return null;
  }
};

/**
 * Fetch bot data by token ID
 */
export const fetchBot = async (tokenId: number): Promise<Bot | null> => {
  const url = `${API_BASE_URL}/api/bot/${tokenId}`;
  log.debug(`Fetching bot ${tokenId} from ${url}`);

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      log.error(`Failed to fetch bot ${tokenId}: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as BotResponse;
    log.debug(`Fetched bot: ${data.bot.name} (#${data.bot.tokenId})`);
    return data.bot;
  } catch (error) {
    log.error(`Error fetching bot ${tokenId}: ${getErrorMessage(error)}`);
    return null;
  }
};

/**
 * Fetch bot story/mission data by token ID
 */
export const fetchBotStory = async (
  tokenId: number
): Promise<BotStory | null> => {
  const url = `${API_BASE_URL}/api/bot/${tokenId}/story`;
  log.debug(`Fetching story for bot ${tokenId} from ${url}`);

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      log.error(`Failed to fetch story for bot ${tokenId}: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as BotStoryResponse;

    if (data.error) {
      log.warn(`Story API warning for bot ${tokenId}: ${data.error}`);
    }

    if (!data.story) {
      log.debug(`No story found for bot ${tokenId}`);
      return null;
    }

    log.debug(`Fetched story for bot ${tokenId}: ${data.story.arc.title}`);
    return data.story;
  } catch (error) {
    log.error(
      `Error fetching story for bot ${tokenId}: ${getErrorMessage(error)}`
    );
    return null;
  }
};

/**
 * Get the URL to view a bot on the GlyphBots website
 */
export const getBotUrl = (tokenId: number): string =>
  `${API_BASE_URL}/bot/${tokenId}`;

/**
 * Get the URL to view an artifact on the GlyphBots website
 */
export const getArtifactUrl = (artifactId: string): string =>
  `${API_BASE_URL}/artifact/${artifactId}`;

/**
 * Playground Content Rotation System
 *
 * Manages the scheduling and rotation of playground content.
 */

import { prefixedLogger } from "../lib/logger";

const log = prefixedLogger("PlaygroundRotation");

/** Content types with weights */
export type ContentType =
  | "spotlight"
  | "postcard"
  | "discovery"
  | "recap"
  | "encounter"
  | "help";

/** Content weights for random selection */
export const CONTENT_WEIGHTS: Record<ContentType, number> = {
  spotlight: 15,
  postcard: 15,
  discovery: 15,
  recap: 20,
  encounter: 15,
  help: 20,
};

/** Rotation state */
export type RotationState = {
  lastContentType: ContentType | null;
  recentContentTypes: ContentType[];
  lastPostTimestamp: number;
};

/** Max recent types to track for anti-duplicate */
const MAX_RECENT_TYPES = 3;

/** In-memory rotation state */
let rotationState: RotationState = {
  lastContentType: null,
  recentContentTypes: [],
  lastPostTimestamp: 0,
};

/**
 * Get the current rotation state
 */
export const getRotationState = (): RotationState => rotationState;

/**
 * Set the rotation state (for initialization)
 */
export const setRotationState = (state: RotationState): void => {
  rotationState = state;
};

/**
 * Select next content type using weighted random selection
 * Avoids recently posted types
 */
export const selectNextContentType = (): ContentType => {
  // Get available content types (exclude recently posted)
  const availableTypes = (Object.keys(CONTENT_WEIGHTS) as ContentType[]).filter(
    (type) => !rotationState.recentContentTypes.includes(type)
  );

  // If all types used recently, use all except the very last one
  const pool =
    availableTypes.length > 0
      ? availableTypes
      : (Object.keys(CONTENT_WEIGHTS) as ContentType[]).filter(
          (type) => type !== rotationState.lastContentType
        );

  // Calculate total weight for available types
  const totalWeight = pool.reduce(
    (sum, type) => sum + CONTENT_WEIGHTS[type],
    0
  );

  // Weighted random selection
  let random = Math.random() * totalWeight;
  for (const type of pool) {
    random -= CONTENT_WEIGHTS[type];
    if (random <= 0) {
      return type;
    }
  }

  // Fallback to first available
  return pool[0];
};

/**
 * Record that a content type was posted
 */
export const recordContentPost = (type: ContentType): void => {
  rotationState.lastContentType = type;
  rotationState.lastPostTimestamp = Date.now();

  // Add to recent types, maintain max size
  rotationState.recentContentTypes.push(type);
  if (rotationState.recentContentTypes.length > MAX_RECENT_TYPES) {
    rotationState.recentContentTypes.shift();
  }

  log.info(`Recorded content post: ${type}`);
};

/**
 * Calculate next post interval (random between min and max)
 */
export const calculateNextInterval = (
  minMinutes: number,
  maxMinutes: number
): number => {
  const minMs = minMinutes * 60 * 1000;
  const maxMs = maxMinutes * 60 * 1000;
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
};

/**
 * Check if enough time has passed since last post
 */
export const canPostContent = (minIntervalMinutes: number): boolean => {
  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const elapsed = Date.now() - rotationState.lastPostTimestamp;
  return elapsed >= minIntervalMs;
};

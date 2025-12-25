/**
 * Google AI Client
 *
 * Provides text and image generation using Google's Gemini models.
 * Text uses gemini-2.0-flash (fast, cheap)
 * Images use gemini-2.0-flash-exp-image-generation (2K quality)
 */

import { GoogleGenAI } from "@google/genai";
import { prefixedLogger } from "../lib/logger";
import { getErrorMessage } from "../lib/utils";

const log = prefixedLogger("GoogleAI");

/** Text generation model (fast, cheap) */
const TEXT_MODEL = "gemini-2.0-flash";

/** Image generation model */
const IMAGE_MODEL = "gemini-2.0-flash-exp-image-generation";

/** Maximum retries for API calls */
const MAX_RETRIES = 3;

/** Retry delay in milliseconds */
const RETRY_DELAY_MS = 1000;

/** Regex for parsing data URLs */
const DATA_URL_MIME_REGEX = /^data:([^;]+);/;

/** Regex for parsing full data URLs with base64 */
const DATA_URL_BASE64_REGEX = /^data:([^;]+);base64,(.+)$/;

/** Text generation parameters */
export type TextGenerationParams = {
  systemPrompt?: string;
  userPrompt: string;
  imageUrl?: string;
  maxTokens?: number;
  temperature?: number;
};

/** Image generation parameters */
export type ImageGenerationParams = {
  prompt: string;
  imageUrls?: string[];
  aspectRatio?: "1:1" | "16:9" | "9:16" | "3:4" | "4:3";
};

/** Image generation result */
export type ImageResult = {
  imageData: string;
  mimeType: string;
} | null;

/** Content part for messages */
type ContentPart =
  | { text: string }
  | { fileData: { fileUri: string; mimeType: string } }
  | { inlineData: { mimeType: string; data: string } };

/**
 * Get the Google AI API key from environment
 */
const getApiKey = (): string => {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY environment variable is required");
  }
  return apiKey;
};

/**
 * Create a Google AI client instance
 */
const createClient = (): GoogleGenAI =>
  new GoogleGenAI({ apiKey: getApiKey() });

/**
 * Delay execution for retry
 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get MIME type from URL or content type header
 */
const getMimeTypeFromUrl = (url: string): string => {
  if (url.startsWith("data:")) {
    const match = url.match(DATA_URL_MIME_REGEX);
    return match ? match[1] : "image/png";
  }
  const extension = url.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
  };
  return mimeMap[extension ?? ""] ?? "image/png";
};

/**
 * Process a single image URL and add to parts array
 */
const processImageUrl = (url: string, parts: ContentPart[]): void => {
  if (url.startsWith("data:")) {
    const match = url.match(DATA_URL_BASE64_REGEX);
    if (match) {
      parts.push({
        inlineData: { mimeType: match[1], data: match[2] },
      });
    }
  } else if (url.startsWith("http://") || url.startsWith("https://")) {
    const mimeType = getMimeTypeFromUrl(url);
    parts.push({ fileData: { fileUri: url, mimeType } });
  }
};

/**
 * Build contents array with text and optional images
 * Uses fileUri for HTTP URLs to avoid base64 encoding
 */
const buildContents = (prompt: string, imageUrls?: string[]): ContentPart[] => {
  const parts: ContentPart[] = [{ text: prompt }];

  if (imageUrls && imageUrls.length > 0) {
    for (const url of imageUrls) {
      processImageUrl(url, parts);
    }

    log.debug(`Added ${imageUrls.length} image(s) to request`);
  }

  return parts;
};

/**
 * Extract text from response parts
 */
const extractTextFromParts = (
  parts: Array<{ text?: string; inlineData?: unknown }>
): string | null => {
  const textParts: string[] = [];
  for (const part of parts) {
    if (part.text) {
      textParts.push(part.text);
    }
  }
  return textParts.length > 0 ? textParts.join("") : null;
};

/**
 * Parse response parts to extract images and text
 */
const parseResponseParts = (
  parts: Array<{
    inlineData?: { mimeType?: string; data?: string };
    text?: string;
  }>
): { imageDataUrls: string[]; textContent?: string } => {
  const imageDataUrls: string[] = [];
  let textContent: string | undefined;

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType ?? "image/png";
      imageDataUrls.push(`data:${mimeType};base64,${part.inlineData.data}`);
    } else if (part.text) {
      textContent = part.text;
    }
  }

  return { imageDataUrls, textContent };
};

/**
 * Extract image from response parts (returns first image)
 */
const extractImageFromParts = (
  parts: Array<{ inlineData?: { mimeType?: string; data?: string } }>
): ImageResult => {
  const { imageDataUrls } = parseResponseParts(parts);
  if (imageDataUrls.length === 0) {
    return null;
  }

  const firstImage = imageDataUrls[0];
  const match = firstImage.match(DATA_URL_BASE64_REGEX);
  if (!match) {
    return null;
  }

  return {
    imageData: match[2],
    mimeType: match[1],
  };
};

/**
 * Generate text using Gemini with retries
 */
export const generateText = async (
  params: TextGenerationParams
): Promise<string | null> => {
  const {
    systemPrompt,
    userPrompt,
    imageUrl,
    maxTokens = 2000,
    temperature = 0.8,
  } = params;

  log.debug(`Generating text (model: ${TEXT_MODEL})`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ai = createClient();
      const contents = buildContents(
        userPrompt,
        imageUrl ? [imageUrl] : undefined
      );

      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents,
        config: {
          ...(systemPrompt && {
            systemInstruction: { parts: [{ text: systemPrompt }] },
          }),
          maxOutputTokens: maxTokens,
          temperature,
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const text = extractTextFromParts(parts);

      if (!text) {
        log.error("No text content in response");
        return null;
      }

      log.debug(`Generated text (${text.length} chars)`);
      return text.trim();
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) {
        log.error(`Error generating text: ${getErrorMessage(error)}`);
        return null;
      }

      log.warn(
        `Request failed (attempt ${attempt}/${MAX_RETRIES}): ${getErrorMessage(error)}`
      );
      await delay(RETRY_DELAY_MS * attempt);
    }
  }

  return null;
};

/**
 * Generate an image using Gemini with retries
 */
export const generateImage = async (
  params: ImageGenerationParams
): Promise<ImageResult> => {
  const { prompt, imageUrls, aspectRatio = "16:9" } = params;

  log.debug(
    `Generating image (model: ${IMAGE_MODEL}, aspect: ${aspectRatio}, reference images: ${imageUrls?.length ?? 0})`
  );

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ai = createClient();
      const contents =
        imageUrls && imageUrls.length > 0
          ? buildContents(prompt, imageUrls)
          : prompt;

      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: {
            aspectRatio,
          },
        },
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      const image = extractImageFromParts(parts);

      if (!image) {
        log.error("No image content in response");
        return null;
      }

      log.debug(`Generated image (${image.mimeType})`);
      return image;
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) {
        log.error(`Error generating image: ${getErrorMessage(error)}`);
        return null;
      }

      log.warn(
        `Request failed (attempt ${attempt}/${MAX_RETRIES}): ${getErrorMessage(error)}`
      );
      await delay(RETRY_DELAY_MS * attempt);
    }
  }

  return null;
};

/**
 * Convert image result to data URL for Discord embeds
 */
export const imageToDataUrl = (image: NonNullable<ImageResult>): string =>
  `data:${image.mimeType};base64,${image.imageData}`;

/**
 * Convert image result to Buffer for Discord attachments
 */
export const imageToBuffer = (image: NonNullable<ImageResult>): Buffer =>
  Buffer.from(image.imageData, "base64");

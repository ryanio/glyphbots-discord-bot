/**
 * OpenRouter API Client
 *
 * Generic client for sending chat completion requests to OpenRouter.
 * No domain-specific logic - just API communication.
 */

import { prefixedLogger } from "../lib/logger";
import { getErrorMessage } from "../lib/utils";

const log = prefixedLogger("OpenRouter");

/** OpenRouter API endpoint */
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Message content part for multimodal messages */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

/** Message type for chat requests */
export type ChatMessage =
  | { role: "system" | "assistant"; content: string }
  | { role: "user"; content: string | ContentPart[] };

/** Chat completion response */
export type ChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type: string; text?: string }>;
    };
  }>;
};

/** Chat completion request parameters */
export type ChatCompletionParams = {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

/**
 * Send a chat completion request to OpenRouter
 */
export const sendChatCompletion = async (
  params: ChatCompletionParams
): Promise<ChatResponse> => {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
  }

  log.debug(`Sending request to OpenRouter (model: ${params.model})`);

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? 2000,
      temperature: params.temperature ?? 0.8,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
  }

  return (await response.json()) as ChatResponse;
};

/**
 * Extract text content from a chat response
 * Handles both string and array content formats
 */
export const extractResponseContent = (
  response: ChatResponse
): string | null => {
  const rawContent = response.choices?.at(0)?.message?.content;

  if (!rawContent) {
    return null;
  }

  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (Array.isArray(rawContent)) {
    const textParts: string[] = [];
    for (const item of rawContent) {
      if (item.type === "text" && "text" in item && item.text) {
        textParts.push(item.text);
      }
    }
    return textParts.join("") || null;
  }

  return null;
};

/**
 * Send a chat completion and extract the text response
 * Returns null if the request fails or no content is returned
 */
export const generateText = async (
  params: ChatCompletionParams
): Promise<string | null> => {
  try {
    const response = await sendChatCompletion(params);
    const content = extractResponseContent(response);

    if (!content) {
      log.error("No content returned from OpenRouter");
      return null;
    }

    return content.trim();
  } catch (error) {
    log.error(`Error generating text: ${getErrorMessage(error)}`);
    return null;
  }
};

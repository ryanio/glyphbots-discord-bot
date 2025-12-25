// Mock @google/genai
const mockGenerateContent = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

import { imageToBuffer, imageToDataUrl } from "../../src/api/google-ai";

describe("Google AI Client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateContent.mockClear();
    process.env.GOOGLE_AI_API_KEY = "test-api-key";
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("imageToDataUrl", () => {
    it("should convert image result to data URL", () => {
      const imageResult = {
        imageData: "dGVzdCBpbWFnZSBkYXRh", // base64 for "test image data"
        mimeType: "image/png",
      };

      const result = imageToDataUrl(imageResult);

      expect(result).toBe("data:image/png;base64,dGVzdCBpbWFnZSBkYXRh");
    });

    it("should handle different mime types", () => {
      const jpegResult = {
        imageData: "dGVzdA==",
        mimeType: "image/jpeg",
      };

      expect(imageToDataUrl(jpegResult)).toBe(
        "data:image/jpeg;base64,dGVzdA=="
      );
    });
  });

  describe("imageToBuffer", () => {
    it("should convert image result to Buffer", () => {
      const imageResult = {
        imageData: "dGVzdCBpbWFnZSBkYXRh", // base64 for "test image data"
        mimeType: "image/png",
      };

      const result = imageToBuffer(imageResult);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.toString()).toBe("test image data");
    });
  });

  describe("generateText (mocked)", () => {
    it("should handle successful API response", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "Generated text content" }],
            },
          },
        ],
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      // Clear module cache to ensure fresh import
      jest.resetModules();
      const { generateText } = await import("../../src/api/google-ai");

      const result = await generateText({
        userPrompt: "Test prompt",
        systemPrompt: "You are a test assistant",
      });

      expect(result).toBe("Generated text content");
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("should return null on API error", async () => {
      mockGenerateContent
        .mockRejectedValueOnce(new Error("API error 1"))
        .mockRejectedValueOnce(new Error("API error 2"))
        .mockRejectedValueOnce(new Error("API error 3"));

      jest.resetModules();
      const { generateText } = await import("../../src/api/google-ai");

      const result = await generateText({
        userPrompt: "Test prompt",
      });

      expect(result).toBeNull();
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
    });

    it("should handle missing API key", async () => {
      delete process.env.GOOGLE_AI_API_KEY;

      jest.resetModules();
      const { generateText } = await import("../../src/api/google-ai");

      const result = await generateText({
        userPrompt: "Test prompt",
      });

      expect(result).toBeNull();
    });
  });

  describe("generateImage (mocked)", () => {
    it("should handle successful image generation", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "image/png",
                    data: "dGVzdCBpbWFnZQ==",
                  },
                },
              ],
            },
          },
        ],
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      jest.resetModules();
      const { generateImage } = await import("../../src/api/google-ai");

      const result = await generateImage({
        prompt: "A test image",
        aspectRatio: "16:9",
      });

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("image/png");
      expect(result?.imageData).toBe("dGVzdCBpbWFnZQ==");
    });

    it("should return null when no image in response", async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: "No image generated" }],
            },
          },
        ],
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      jest.resetModules();
      const { generateImage } = await import("../../src/api/google-ai");

      const result = await generateImage({
        prompt: "A test image",
      });

      expect(result).toBeNull();
    });
  });
});

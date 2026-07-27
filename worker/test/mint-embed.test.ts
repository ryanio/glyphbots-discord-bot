import { describe, expect, it } from "vitest";
import { buildMintEmbed } from "../src/channels/mints";
import { createArtifact, mintedArtifact } from "./fixtures";

const TEST_ORIGIN = "https://example.test";

const api = {
  getArtifactUrl: (id: number) => `${TEST_ORIGIN}/artifact/${id}`,
  getBotUrl: (id: number) => `${TEST_ORIGIN}/bot/${id}`,
};

describe("buildMintEmbed", () => {
  it("uses the artifact title when present", () => {
    const embed = buildMintEmbed(mintedArtifact("a1", "2025-01-02T00:00:00Z", 12), api);
    expect(embed.toJSON().title).toBe("◈ Artifact a1 #12");
  });

  it("falls back to Artifact when the title is null", () => {
    // The site API stores null when title extraction comes back empty; the
    // embed must never render the word "null".
    const artifact = {
      ...createArtifact({ contractTokenId: 175, title: null }),
      mintedAt: "2025-01-02T00:00:00Z",
      contractTokenId: 175,
    };
    const embed = buildMintEmbed(artifact, api);
    expect(embed.toJSON().title).toBe("◈ Artifact #175");
  });
});

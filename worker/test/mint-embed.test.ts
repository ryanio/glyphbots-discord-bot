import { describe, expect, it } from "vitest";
import { preferredName } from "../src/api/display-name";
import type { MintedArtifact } from "../src/channels/mints";
import { buildMintEmbed } from "../src/channels/mints";
import { createArtifact, mintedArtifact } from "./fixtures";

const TEST_ORIGIN = "https://example.test";
const MINTER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const api = {
  getArtifactUrl: (id: number) => `${TEST_ORIGIN}/artifact/${id}`,
  getBotUrl: (id: number) => `${TEST_ORIGIN}/bot/${id}`,
};

const minterField = (
  artifact: MintedArtifact,
  minter: Parameters<typeof buildMintEmbed>[2] = null
): string | undefined =>
  buildMintEmbed(artifact, api, minter)
    .toJSON()
    .fields?.find((field) => field.name === "◈ Minter")?.value;

const minted = (minter: string | null): MintedArtifact => ({
  ...createArtifact({ contractTokenId: 12, minter }),
  mintedAt: "2025-01-02T00:00:00Z",
  contractTokenId: 12,
});

describe("buildMintEmbed", () => {
  it("uses the artifact title when present", () => {
    const embed = buildMintEmbed(
      mintedArtifact("a1", "2025-01-02T00:00:00Z", 12),
      api
    );
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

  it("names the minter when OpenSea knows one", () => {
    const name = preferredName(
      { address: MINTER, username: null, ens_name: "vitalik.eth" },
      MINTER
    );
    expect(minterField(minted(MINTER), name)).toBe("vitalik.eth");
  });

  it("escapes a name that contains Discord formatting", () => {
    // Usernames are user-chosen and underscores are common in them.
    const name = preferredName({ address: MINTER, username: "a_b_c" }, MINTER);
    expect(minterField(minted(MINTER), name)).toBe("a\\_b\\_c");
  });

  it("keeps the short address, in a code span, when there is no name", () => {
    expect(minterField(minted(MINTER))).toBe("`0xd8dA6…96045`");
  });
});

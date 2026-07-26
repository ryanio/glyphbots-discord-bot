/** GlyphBots API shapes, copied from `src/lib/types.ts`. */

export type Artifact = {
  id: string;
  botTokenId: number;
  imageUrl: string;
  title: string;
  createdAt: string;
  mintedAt: string | null;
  contractTokenId: number | null;
  mintQuantity: number | null;
  aicArtworkIds?: number[];
  minter: string | null;
  imageCid?: string;
  mintTxHash?: string;
  sourceBotIds?: number[];
  durationMs?: number;
  type: string | null;
};

export type ArtifactsListResponse = {
  ok: boolean;
  items: Artifact[];
  nextCursor?: string | null;
  error?: string;
};

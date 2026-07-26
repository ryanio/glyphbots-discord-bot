/**
 * FeedStateDO, the mint cursor's home.
 *
 * One singleton instance (`idFromName('singleton')`). It holds exactly one
 * record in Phase 1: `{ lastMintedAtMs, postedArtifactIds }`, the state that
 * `src/lib/state.ts` used to keep in `.state/glyphbots-discord-bot-state.json`
 * on the droplet.
 *
 * Why a DO and not KV: the cron does a read-modify-write every five minutes,
 * and on a failed send it rewinds the timestamp. The DO input gate holds other
 * events while a storage await is in flight, so that sequence is atomic. KV is
 * eventually consistent and has no compare-and-set, so two overlapping ticks
 * could clobber each other and drop a mint.
 *
 * The interface is deliberately narrow: read the cursor, write the cursor.
 * Phase 4 adds the OpenSea cursor and the settle-window groups as separate
 * keys; it should not need to touch this handler's shape.
 */

import { createLogger } from "../utils/logger";

const log = createLogger("feed-state-do");

const MINT_CURSOR_KEY = "mintCursor";

/**
 * `null` means genuinely absent (cold start, seed and post nothing), which is
 * a different thing from a cursor whose `lastMintedAtMs` is null.
 */
export type MintsCursorState = {
  lastMintedAtMs: number | null;
  postedArtifactIds: string[];
};

/** Reject a stored shape that does not parse, rather than poisoning a poll. */
const parseCursor = (value: unknown): MintsCursorState | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<MintsCursorState>;
  const { lastMintedAtMs, postedArtifactIds } = candidate;

  const timestampOk =
    lastMintedAtMs === null ||
    (typeof lastMintedAtMs === "number" && Number.isFinite(lastMintedAtMs));
  const idsOk =
    Array.isArray(postedArtifactIds) &&
    postedArtifactIds.every((id) => typeof id === "string");

  if (!(timestampOk && idsOk)) {
    log.warn("Stored mint cursor failed validation, treating as absent");
    return null;
  }

  return {
    lastMintedAtMs: lastMintedAtMs ?? null,
    postedArtifactIds: [...postedArtifactIds],
  };
};

export class FeedStateDO implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/mint-cursor") {
      if (req.method === "GET") {
        return this.readMintCursor();
      }
      if (req.method === "PUT") {
        return this.writeMintCursor(req);
      }
      return Promise.resolve(new Response("method not allowed", {
        status: 405,
      }));
    }

    return Promise.resolve(new Response("not found", { status: 404 }));
  }

  private async readMintCursor(): Promise<Response> {
    const stored = await this.state.storage.get<unknown>(MINT_CURSOR_KEY);
    const cursor = stored === undefined ? null : parseCursor(stored);
    return Response.json({ cursor });
  }

  private async writeMintCursor(req: Request): Promise<Response> {
    const body = (await req.json()) as { cursor?: unknown };
    const cursor = parseCursor(body.cursor);

    if (!cursor) {
      return new Response("invalid cursor", { status: 400 });
    }

    await this.state.storage.put(MINT_CURSOR_KEY, cursor);
    return Response.json({ ok: true });
  }
}

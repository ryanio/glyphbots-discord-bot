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
 * Phase 4 adds a second record under `salesState`: the OpenSea cursor, the
 * pending settle-window groups, the processed key set and the deferred message
 * queue, all in one value so they are written in one transaction and cannot
 * diverge. It is the same DO rather than a new one, since it is the same kind
 * of state on the same tick cadence, and a second namespace would only add a
 * migration.
 *
 * A third record lands under `idleState`: when a human last spoke in
 * `#general`, and what the bot has posted about the silence since. It is here
 * for the same reason the sales state is, plus one of its own: two writers
 * touch it (the gateway on every human message, the hourly nudge cron), so the
 * read-modify-write has to happen behind the input gate rather than on the
 * Worker side. That is why this record takes an operation
 * (`src/channels/idle.ts`) instead of a whole value.
 *
 * The three records never interact; each path reads and writes only its own key.
 */

import { applyIdleUpdate, GALLERY_KINDS, NUDGE_KINDS } from "../channels/idle";
import type {
  GalleryKind,
  IdleState,
  IdleUpdate,
  NudgeKind,
} from "../channels/idle";
import type { SalesFeedState } from "../channels/sales";
import { createLogger } from "../utils/logger";

const log = createLogger("feed-state-do");

const MINT_CURSOR_KEY = "mintCursor";
const SALES_STATE_KEY = "salesState";
const IDLE_STATE_KEY = "idleState";

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

/**
 * Validate the sales record structurally.
 *
 * Deliberately shallow: it checks the containers, not every OpenSea event
 * inside them. A cursor that fails this is treated as absent, which re-seeds
 * and posts nothing, and that is the safe direction. Being stricter would risk
 * discarding a live cursor over a field OpenSea added.
 */
const parseSalesState = (value: unknown): SalesFeedState | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<SalesFeedState>;
  const { lastEventTimestamp, grouping, deferred } = candidate;

  const timestampOk =
    typeof lastEventTimestamp === "number" &&
    Number.isFinite(lastEventTimestamp);
  const groupingOk =
    typeof grouping === "object" &&
    grouping !== null &&
    typeof grouping.actorGroups === "object" &&
    grouping.actorGroups !== null &&
    Array.isArray(grouping.processedKeys);
  const deferredOk = Array.isArray(deferred);

  if (!(timestampOk && groupingOk && deferredOk)) {
    log.warn("Stored sales state failed validation, treating as absent");
    return null;
  }

  return { lastEventTimestamp, grouping, deferred };
};

const isTimestamp = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

const isNudgeKind = (value: unknown): value is NudgeKind | null =>
  value === null ||
  (typeof value === "string" && (NUDGE_KINDS as readonly string[]).includes(value));

const isGalleryKind = (value: unknown): value is GalleryKind | null =>
  value === null ||
  (typeof value === "string" &&
    (GALLERY_KINDS as readonly string[]).includes(value));

/**
 * Validate the idle record.
 *
 * Stricter than the sales one, because it is small enough to check field by
 * field and because the two failure directions are asymmetric: a record read as
 * absent seeds and posts nothing, which is safe, while a record with a garbage
 * timestamp could read as two days of silence and post immediately.
 */
const parseIdleState = (value: unknown): IdleState | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<IdleState>;

  if (
    !(
      isTimestamp(candidate.lastHumanMessageAtMs) &&
      isTimestamp(candidate.lastNudgeAtMs) &&
      isTimestamp(candidate.lastGalleryAtMs) &&
      isNudgeKind(candidate.lastNudgeKind) &&
      isGalleryKind(candidate.lastGalleryKind)
    )
  ) {
    log.warn("Stored idle state failed validation, treating as absent");
    return null;
  }

  return {
    lastHumanMessageAtMs: candidate.lastHumanMessageAtMs ?? null,
    lastNudgeAtMs: candidate.lastNudgeAtMs ?? null,
    lastNudgeKind: candidate.lastNudgeKind ?? null,
    lastGalleryAtMs: candidate.lastGalleryAtMs ?? null,
    lastGalleryKind: candidate.lastGalleryKind ?? null,
  };
};

/** Reject an operation that did not come from `IdleUpdate`. */
const parseIdleUpdate = (value: unknown): IdleUpdate | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const candidate = value as Partial<IdleUpdate>;
  const { op, atMs } = candidate;

  if (typeof atMs !== "number" || !Number.isFinite(atMs)) {
    return null;
  }
  if (op === "seed" || op === "human-message") {
    return { op, atMs };
  }
  if (op === "nudge") {
    const { kind } = candidate as { kind?: unknown };
    return isNudgeKind(kind) && kind !== null ? { op, atMs, kind } : null;
  }
  if (op === "gallery") {
    const { kind } = candidate as { kind?: unknown };
    return isGalleryKind(kind) && kind !== null ? { op, atMs, kind } : null;
  }
  return null;
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

    if (url.pathname === "/sales-state") {
      if (req.method === "GET") {
        return this.readSalesState();
      }
      if (req.method === "PUT") {
        return this.writeSalesState(req);
      }
      return Promise.resolve(new Response("method not allowed", {
        status: 405,
      }));
    }

    if (url.pathname === "/idle-state") {
      if (req.method === "GET") {
        return this.readIdleState();
      }
      if (req.method === "POST") {
        return this.applyIdleState(req);
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

  private async readSalesState(): Promise<Response> {
    const stored = await this.state.storage.get<unknown>(SALES_STATE_KEY);
    const state = stored === undefined ? null : parseSalesState(stored);
    return Response.json({ state });
  }

  /**
   * One write covers the cursor, the pending groups and the deferred queue.
   * The input gate serializes it against any other tick, so two overlapping
   * crons cannot interleave a read-modify-write and lose a sale.
   */
  private async writeSalesState(req: Request): Promise<Response> {
    const body = (await req.json()) as { state?: unknown };
    const state = parseSalesState(body.state);

    if (!state) {
      return new Response("invalid sales state", { status: 400 });
    }

    await this.state.storage.put(SALES_STATE_KEY, state);
    return Response.json({ ok: true });
  }

  private async readIdleState(): Promise<Response> {
    const stored = await this.state.storage.get<unknown>(IDLE_STATE_KEY);
    const state = stored === undefined ? null : parseIdleState(stored);
    return Response.json({ state });
  }

  /**
   * Read, apply one operation, write, all inside the gate.
   *
   * The gateway writes here on every human message and the cron writes here
   * once an hour. Doing the merge on the Worker side instead would let the
   * cron's write drop a message that landed while it was building an embed,
   * which is the one failure that would have the bot talking over somebody.
   */
  private async applyIdleState(req: Request): Promise<Response> {
    const update = parseIdleUpdate(await req.json());

    if (!update) {
      return new Response("invalid idle update", { status: 400 });
    }

    const stored = await this.state.storage.get<unknown>(IDLE_STATE_KEY);
    const current = stored === undefined ? null : parseIdleState(stored);
    const next = applyIdleUpdate(current, update);

    await this.state.storage.put(IDLE_STATE_KEY, next);
    return Response.json({ state: next });
  }
}

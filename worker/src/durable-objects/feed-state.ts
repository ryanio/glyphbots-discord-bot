/**
 * FeedStateDO, where every scheduled feed keeps what it needs between ticks.
 *
 * One singleton instance (`idFromName('singleton')`) holding three records
 * under three keys. They never interact; each path reads and writes only its
 * own.
 *
 * - `mintCursor`: `{ lastMintedAtMs, postedArtifactIds }`, the mint watcher's
 *   position in the artifact feed. On the droplet this was a JSON file at
 *   `.state/glyphbots-discord-bot-state.json`.
 * - `salesState`: the OpenSea cursor, the pending settle-window groups, the
 *   processed key set and the deferred message queue, in one value so they are
 *   written in one transaction and cannot diverge.
 * - `idleState`: when a human last spoke in `#general`, and what the bot has
 *   posted about the silence since.
 *
 * All three live in the same DO rather than one each: same kind of state on the
 * same tick cadence, and a second namespace would only add a migration.
 *
 * ## Why a Durable Object and not KV
 *
 * Every tick here is a read-modify-write, and two of them rewind on failure: a
 * mint whose send failed holds the timestamp back, an undelivered sale holds
 * the cursor back. The DO input gate holds other events while a storage await
 * is in flight, so the whole sequence is atomic. KV is eventually consistent
 * and has no compare-and-set, so two overlapping ticks could clobber each other
 * and drop a mint.
 *
 * ## Why every record takes an operation rather than a value
 *
 * The gate serializes each `fetch`, not a pair of them. A caller that read a
 * record, spent several seconds posting to Discord and then wrote a whole new
 * value would have its read and its write on opposite sides of the gate, which
 * is the failure the DO was chosen to avoid, reintroduced one layer up. So the
 * three `POST` paths below take *what changed* and this class does the merge:
 * read, apply, write, no yield in between.
 *
 * The idle record makes the point sharpest, since it has two independent
 * writers (the gateway on every human message, the hourly cron). The other two
 * have one writer each, and still need it: their read and their write are
 * minutes of network apart, and the sales record in particular carries the
 * processed key set, which is the only thing standing between a re-served event
 * and a duplicate post.
 *
 * It buys one more thing, smaller but worth naming. Validation now happens on a
 * small operation rather than on a whole computed record, so there is no path
 * where a post succeeds and the write recording it is then rejected as
 * malformed, leaving the next tick to post it again.
 */

import type {
  GalleryKind,
  IdleState,
  IdleUpdate,
  NudgeKind,
} from "../channels/idle";
import { applyIdleUpdate, GALLERY_KINDS, NUDGE_KINDS } from "../channels/idle";
import type {
  MintCursorUpdate,
  MintRecord,
  MintsCursorState,
} from "../channels/mints";
import { applyMintCursorUpdate } from "../channels/mints";
import type { SalesFeedState, SalesUpdate } from "../channels/sales";
import { applySalesUpdate } from "../channels/sales";
import { createLogger } from "../utils/logger";

const log = createLogger("feed-state-do");

const MINT_CURSOR_KEY = "mintCursor";
const SALES_STATE_KEY = "salesState";
const IDLE_STATE_KEY = "idleState";

const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const METHOD_NOT_ALLOWED = 405;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isTimestamp = (value: unknown): value is number | null =>
  value === null || isFiniteNumber(value);

const isNudgeKind = (value: unknown): value is NudgeKind | null =>
  value === null ||
  (typeof value === "string" &&
    (NUDGE_KINDS as readonly string[]).includes(value));

const isGalleryKind = (value: unknown): value is GalleryKind | null =>
  value === null ||
  (typeof value === "string" &&
    (GALLERY_KINDS as readonly string[]).includes(value));

/** Reject a stored shape that does not parse, rather than poisoning a poll. */
const parseCursor = (value: unknown): MintsCursorState | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<MintsCursorState>;
  const { lastMintedAtMs, postedArtifactIds } = candidate;

  const idsOk =
    Array.isArray(postedArtifactIds) &&
    postedArtifactIds.every((id) => typeof id === "string");

  if (!(isTimestamp(lastMintedAtMs) && idsOk)) {
    log.warn("Stored mint cursor failed validation, treating as absent");
    return null;
  }

  return {
    lastMintedAtMs: lastMintedAtMs ?? null,
    postedArtifactIds: [...postedArtifactIds],
  };
};

const parseMintRecords = (value: unknown): MintRecord[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const records: MintRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const { id, mintedAtMs } = entry as Partial<MintRecord>;
    if (typeof id !== "string" || !isFiniteNumber(mintedAtMs)) {
      return null;
    }
    records.push({ id, mintedAtMs });
  }
  return records;
};

/** Reject an operation that did not come from `MintCursorUpdate`. */
const parseMintCursorUpdate = (value: unknown): MintCursorUpdate | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { op, handled, failed } = value as {
    op?: unknown;
    handled?: unknown;
    failed?: unknown;
  };

  const handledRecords = parseMintRecords(handled);
  if (!handledRecords) {
    return null;
  }

  if (op === "seed") {
    return { op, handled: handledRecords };
  }

  if (op === "advance") {
    const failedRecords = parseMintRecords(failed);
    return failedRecords
      ? { op, handled: handledRecords, failed: failedRecords }
      : null;
  }

  return null;
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

  const groupingOk =
    typeof grouping === "object" &&
    grouping !== null &&
    typeof grouping.actorGroups === "object" &&
    grouping.actorGroups !== null &&
    Array.isArray(grouping.processedKeys);

  if (
    !(
      isFiniteNumber(lastEventTimestamp) &&
      groupingOk &&
      Array.isArray(deferred)
    )
  ) {
    log.warn("Stored sales state failed validation, treating as absent");
    return null;
  }

  return { lastEventTimestamp, grouping, deferred };
};

/**
 * Reject an operation that did not come from `SalesUpdate`.
 *
 * Same shallowness as the record above and for the same reason: the containers
 * are checked, the OpenSea events inside them are not. What is checked strictly
 * is `advanceTo`, because it is the one field that moves the cursor.
 */
const parseSalesUpdate = (value: unknown): SalesUpdate | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { op } = value as { op?: unknown };

  if (op === "seed") {
    const { at } = value as { at?: unknown };
    return isFiniteNumber(at) ? { op, at } : null;
  }

  if (op !== "commit") {
    return null;
  }

  const { processedKeys, actorGroups, deferred, advanceTo } = value as {
    processedKeys?: unknown;
    actorGroups?: unknown;
    deferred?: unknown;
    advanceTo?: unknown;
  };

  const keysOk =
    Array.isArray(processedKeys) &&
    processedKeys.every((key) => typeof key === "string");
  const groupsOk = typeof actorGroups === "object" && actorGroups !== null;

  if (
    !(keysOk && groupsOk && Array.isArray(deferred) && isTimestamp(advanceTo))
  ) {
    return null;
  }

  return {
    op,
    processedKeys,
    actorGroups: actorGroups as SalesFeedState["grouping"]["actorGroups"],
    deferred: deferred as SalesFeedState["deferred"],
    advanceTo,
  };
};

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

  if (!isFiniteNumber(atMs)) {
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

/**
 * One record's storage key, validator and merge.
 *
 * The three paths were three copy-pasted blocks with three identical 405
 * handlers between them. As a table the routing is written once and adding a
 * fourth record is a row rather than a branch.
 */
type Record_<State, Update> = {
  key: string;
  /** Stored JSON to a record, or `null` when it does not parse. */
  parseState: (value: unknown) => State | null;
  /** Request body to an operation, or `null` when it is not one. */
  parseUpdate: (value: unknown) => Update | null;
  apply: (current: State | null, update: Update) => State;
  /** Named in the 400 body, so a rejection says which path rejected it. */
  label: string;
};

const RECORDS = {
  "/mint-cursor": {
    key: MINT_CURSOR_KEY,
    parseState: parseCursor,
    parseUpdate: parseMintCursorUpdate,
    apply: applyMintCursorUpdate,
    label: "mint cursor",
  } satisfies Record_<MintsCursorState, MintCursorUpdate>,
  "/sales-state": {
    key: SALES_STATE_KEY,
    parseState: parseSalesState,
    parseUpdate: parseSalesUpdate,
    apply: applySalesUpdate,
    label: "sales state",
  } satisfies Record_<SalesFeedState, SalesUpdate>,
  "/idle-state": {
    key: IDLE_STATE_KEY,
    parseState: parseIdleState,
    parseUpdate: parseIdleUpdate,
    apply: applyIdleUpdate,
    label: "idle state",
  } satisfies Record_<IdleState, IdleUpdate>,
  // biome-ignore lint/suspicious/noExplicitAny: three record types, one table
} as const satisfies globalThis.Record<string, Record_<any, any>>;

export class FeedStateDO implements DurableObject {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const record = (
      RECORDS as globalThis.Record<
        string,
        // biome-ignore lint/suspicious/noExplicitAny: see the table above
        Record_<any, any> | undefined
      >
    )[pathname];

    if (!record) {
      return Promise.resolve(new Response("not found", { status: NOT_FOUND }));
    }
    if (req.method === "GET") {
      return this.read(record);
    }
    if (req.method === "POST") {
      return this.apply(record, req);
    }
    return Promise.resolve(
      new Response("method not allowed", { status: METHOD_NOT_ALLOWED })
    );
  }

  // biome-ignore lint/suspicious/noExplicitAny: see the table above
  private async read(record: Record_<any, any>): Promise<Response> {
    return Response.json({ state: await this.load(record) });
  }

  /**
   * Read, apply one operation, write, all on this side of the input gate.
   *
   * Nothing here awaits anything but storage, so no other request can
   * interleave between the read and the write.
   */
  private async apply(
    // biome-ignore lint/suspicious/noExplicitAny: see the table above
    record: Record_<any, any>,
    req: Request
  ): Promise<Response> {
    const update = record.parseUpdate(await req.json());

    if (!update) {
      return new Response(`invalid ${record.label} update`, {
        status: BAD_REQUEST,
      });
    }

    const next = record.apply(await this.load(record), update);
    await this.state.storage.put(record.key, next);

    return Response.json({ state: next });
  }

  private async load(
    // biome-ignore lint/suspicious/noExplicitAny: see the table above
    record: Record_<any, any>
  ): Promise<unknown> {
    const stored = await this.state.storage.get<unknown>(record.key);
    return stored === undefined ? null : record.parseState(stored);
  }
}

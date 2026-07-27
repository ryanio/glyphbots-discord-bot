/**
 * GatewayDO: the one WebSocket this Worker holds open to Discord.
 *
 * Modelled directly on Coral's production gateway DO
 * (`/Users/rg/dev/coral/packages/worker/src/durable-objects/discord-gateway.ts`),
 * which has been running this exact lifecycle against Discord for months. The
 * differences from Coral are noted inline and are all subtractions.
 *
 * ## Hibernation: this DO does NOT hibernate, on purpose
 *
 * Coral's comment at `discord-gateway.ts:468-477` is the whole reason, and it
 * is a platform constraint rather than a preference: `state.acceptWebSocket()`
 * takes an *incoming* `WebSocketPair`, and rejects a socket that came back
 * from an outbound `fetch()` with "pair has already been accepted or used in a
 * Response". A gateway connection is by definition outbound, so the
 * hibernation API cannot be used for it at all. The socket is `accept()`ed
 * manually, listeners are attached in `openGateway`, and the DO stays resident
 * while connected.
 *
 * The cost argument for hibernating does not survive contact with the
 * heartbeat anyway: Discord's `heartbeat_interval` is about 41 seconds, so an
 * alarm fires roughly every 41 seconds forever and the DO would be woken
 * continuously regardless.
 *
 * The failure mode this avoids is the important part. If the socket were
 * `accept()`ed and the DO were then allowed to be evicted, the in-memory
 * `liveWs` reference would vanish while Discord still believed the connection
 * was up. The bot would look healthy, answer nothing, and only the heartbeat
 * ack check would eventually notice. That is the "works for hours, then goes
 * quiet" failure, and it is guarded in two places here: `alarm()` treats a
 * null `liveWs` as "reopen" whatever the stored `wsState` says, unless that
 * state is `failed`, and the `/health-tick` watchdog on the five minute cron
 * reopens anything that is not live. `failed` is checked first in both,
 * because it is the one state a human has to clear.
 *
 * ## Intents
 *
 * `GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT` and nothing else. The Oracle
 * application also has Presence and Server Members granted (flags `565248`),
 * and both are deliberately left unrequested: nothing in scope reads them, and
 * requesting them means a larger READY payload and a stream of events the DO
 * would spend CPU discarding.
 *
 * ## The idle clock
 *
 * `MESSAGE_CREATE` is also where the Worker learns the guild is awake. Every
 * non-bot message in `#general` is written through to `FeedStateDO`, and the
 * hourly nudge cron reads it back (`src/channels/idle.ts`). It is written to
 * storage rather than kept on this DO because this DO does not survive a
 * deploy, and a nudge that fires or fails to fire because of a redeploy would
 * be invisible either way.
 */

import { createGlyphBotsClient } from "../api/glyphbots";
import { createOpenSeaClient } from "../api/opensea";
import { isHumanActivity } from "../channels/idle";
import { DISCORD_API } from "../config";
import { createChannelPoster } from "../discord/channel-poster";
import { handleLookupMessage, type LookupMessage } from "../lookups/handle";
import { createRateLimiter, type RateLimiter } from "../lookups/rate-limit";
import type { WorkerEnv } from "../types";
import { createLogger, getErrorMessage } from "../utils/logger";
import { createIdleStateStore } from "./feed-stores";

const log = createLogger("gateway-do");

const GATEWAY_QUERY = "?v=10&encoding=json";

const WSS_PREFIX_RE = /^wss:\/\//i;
const WS_PREFIX_RE = /^ws:\/\//i;

/**
 * Gateway intents bitmask.
 * `GUILDS = 1 << 0`, `GUILD_MESSAGES = 1 << 9`, `MESSAGE_CONTENT = 1 << 15`.
 * = 33_281. `MESSAGE_CONTENT` is privileged and is enabled on Oracle; if it
 * were ever revoked the gateway closes 4014, which is fatal here and does not
 * loop.
 */
export const GATEWAY_INTENTS = 33_281;

/** Reconnect backoff (ms). Resets on READY and on RESUMED. */
export const BACKOFF_MS = [1000, 2000, 5000, 15_000, 60_000] as const;

/**
 * Close codes that mean "stop". Reconnecting on any of these is an infinite
 * loop against a condition only a human can fix, so the DO parks in `failed`
 * and the watchdog leaves it there.
 * https://discord.com/developers/docs/topics/opcodes-and-status-codes
 */
const FATAL_CLOSE_CODES = new Set([
  4004, // authentication failed, the token is wrong
  4010, // invalid shard
  4011, // sharding required
  4012, // invalid API version
  4013, // invalid intents
  4014, // disallowed intents, ie MESSAGE_CONTENT was turned off
]);

/**
 * Close codes that invalidate the session. Reconnect, but IDENTIFY fresh: a
 * RESUME with a dead session id just earns an INVALID_SESSION and another
 * round trip.
 */
const REIDENTIFY_CLOSE_CODES = new Set([
  4007, // invalid sequence
  4009, // session timed out
]);

export type CloseDisposition = "fatal" | "reidentify" | "resume";

/**
 * How a close code is handled. Pure, and exported so the tests can assert the
 * table without a socket.
 *
 * Note the treatment of 1000 and 1001. Discord uses them to end a session for
 * good, but they are also what this DO sends itself on a forced reconnect,
 * a missing heartbeat ack and an admin `/reconnect`, where resuming is exactly
 * what should happen. Since the two cases are indistinguishable at this layer,
 * the optimistic branch is taken and the RESUME is attempted. If the session
 * really is gone, the gateway answers `op=9 INVALID_SESSION`, and the op 9
 * handler drops the session and re-IDENTIFYs. So the pessimistic case costs
 * one extra round trip and self-corrects, while the common case (our own
 * reconnect) keeps its session.
 */
export const classifyClose = (code: number): CloseDisposition => {
  if (FATAL_CLOSE_CODES.has(code)) {
    return "fatal";
  }
  if (REIDENTIFY_CLOSE_CODES.has(code)) {
    return "reidentify";
  }
  return "resume";
};

type WsState =
  | "idle"
  | "connecting"
  | "identifying"
  | "live"
  | "reconnecting"
  | "failed";

export type GatewayState = {
  consecutiveResumeFailures: number;
  failureReason: string | null;
  heartbeatAckPending: boolean;
  heartbeatIntervalMs: number | null;
  lastEventAt: number | null;
  lastHeartbeatAt: number | null;
  lastSeq: number | null;
  reconnectAttempt: number;
  resumeUrl: string | null;
  selfUserId: string | null;
  sessionId: string | null;
  wsState: WsState;
};

const INITIAL_STATE: GatewayState = {
  consecutiveResumeFailures: 0,
  failureReason: null,
  heartbeatAckPending: false,
  heartbeatIntervalMs: null,
  lastEventAt: null,
  lastHeartbeatAt: null,
  lastSeq: null,
  reconnectAttempt: 0,
  resumeUrl: null,
  selfUserId: null,
  sessionId: null,
  wsState: "idle",
};

const STATE_KEY = "gatewayState";

/** Watchdog threshold: live, but nothing heard and a heartbeat unacked. */
const STALE_MS = 90_000;

/** Resume failures in a row before the log goes loud. */
const RESUME_FAILURE_ALARM = 3;

/**
 * How long a connect already under way is trusted before another caller is
 * allowed to start its own.
 *
 * A connect settles in well under a second, so this is only ever reached by an
 * `await fetch` that never came back. Without the escape hatch, one of those
 * would sit in front of every reconnect path forever, which is the "looks
 * healthy, answers nothing" failure the watchdog exists to break.
 */
const CONNECT_WEDGE_MS = 60_000;

/** Minimal frame envelope. Anything else on the frame is ignored. */
type GatewayFrame = {
  op: number;
  s?: number | null;
  t?: string | null;
  d?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Parse a wire frame, or null when it is not one. */
export const parseFrame = (raw: string): GatewayFrame | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.op !== "number") {
    return null;
  }
  return {
    op: parsed.op,
    s: typeof parsed.s === "number" ? parsed.s : null,
    t: typeof parsed.t === "string" ? parsed.t : null,
    d: parsed.d,
  };
};

/** Narrow a MESSAGE_CREATE payload to the fields the lookup path reads. */
export const parseMessageCreate = (raw: unknown): LookupMessage | null => {
  if (!isRecord(raw)) {
    return null;
  }
  const { id, channel_id, guild_id, content, author } = raw;
  if (
    typeof id !== "string" ||
    typeof channel_id !== "string" ||
    typeof content !== "string" ||
    !isRecord(author) ||
    typeof author.id !== "string"
  ) {
    return null;
  }
  return {
    id,
    channel_id,
    content,
    ...(typeof guild_id === "string" ? { guild_id } : {}),
    author: {
      id: author.id,
      ...(typeof author.bot === "boolean" ? { bot: author.bot } : {}),
      ...(typeof author.username === "string"
        ? { username: author.username }
        : {}),
    },
  };
};

export class GatewayDO implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: WorkerEnv;
  /**
   * The live outbound socket. In memory only, which is why the DO must stay
   * resident: see the hibernation note at the top of this file.
   */
  private liveWs: WebSocket | null = null;
  /**
   * The connect currently in flight, if there is one. Callers join it rather
   * than starting a second.
   *
   * `liveWs` cannot do this job. It is only assigned once the upgrade `fetch`
   * has resolved, so through the whole connect it is null, and a Durable
   * Object's input gate closes around storage operations, not around an
   * `await fetch`. An alarm firing while `handleHealthTick` was mid-connect
   * therefore sailed past the `liveWs` check and opened a second socket. Both
   * sockets keep their listeners, so every MESSAGE_CREATE was handled twice
   * and every inline lookup answered twice.
   */
  private connectInFlight: Promise<void> | null = null;
  private connectStartedAt = 0;
  private readonly limiter: RateLimiter = createRateLimiter();

  constructor(state: DurableObjectState, env: WorkerEnv) {
    this.state = state;
    this.env = env;
  }

  // ── Admin surface ────────────────────────────────────────────────────────
  // Reached only through `/_admin/gateway/*` on the Worker, which checks
  // ADMIN_TOKEN first. The DO namespace is not routable from outside.

  fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    switch (pathname) {
      case "/connect":
        return this.handleConnect();
      case "/status":
        return this.handleStatus();
      case "/reconnect":
        return this.handleForceReconnect();
      case "/health-tick":
        return this.handleHealthTick();
      default:
        return Promise.resolve(new Response("not found", { status: 404 }));
    }
  }

  private async handleConnect(): Promise<Response> {
    const current = await this.readState();
    if (
      current.wsState === "live" ||
      current.wsState === "connecting" ||
      current.wsState === "identifying"
    ) {
      return Response.json({
        ok: true,
        wsState: current.wsState,
        note: "already-connecting-or-live",
      });
    }
    await this.openGateway();
    const after = await this.readState();
    return Response.json({ ok: true, wsState: after.wsState });
  }

  private async handleStatus(): Promise<Response> {
    const s = await this.readState();
    return Response.json({
      wsState: s.wsState,
      // The session id is a credential-equivalent, so only its presence is
      // reported.
      hasSession: Boolean(s.sessionId),
      hasLiveSocket: this.liveWs !== null,
      selfUserId: s.selfUserId,
      lastEventAt: s.lastEventAt,
      lastHeartbeatAt: s.lastHeartbeatAt,
      heartbeatAckPending: s.heartbeatAckPending,
      heartbeatIntervalMs: s.heartbeatIntervalMs,
      lastSeq: s.lastSeq,
      reconnectAttempt: s.reconnectAttempt,
      consecutiveResumeFailures: s.consecutiveResumeFailures,
      failureReason: s.failureReason,
      intents: GATEWAY_INTENTS,
    });
  }

  private async handleForceReconnect(): Promise<Response> {
    log.info("admin: force reconnect");
    this.closeSocket(1000, "admin-reconnect");
    await this.patchState({
      wsState: "reconnecting",
      heartbeatIntervalMs: null,
      heartbeatAckPending: false,
      failureReason: "admin-reconnect",
    });
    await this.openGateway();
    return Response.json({ ok: true });
  }

  /**
   * Watchdog, poked by the five minute mint cron. Opens the socket when it is
   * not up, and forces a reconnect when the DO believes it is live but has
   * heard nothing for 90 seconds with a heartbeat outstanding. `failed` is
   * left alone on purpose: those are the fatal close codes, and looping on
   * them would just hammer Discord.
   */
  private async handleHealthTick(): Promise<Response> {
    const s = await this.readState();

    if (s.wsState === "failed") {
      log.error(`watchdog: gateway is failed (${s.failureReason})`);
      return Response.json({
        ok: false,
        wsState: s.wsState,
        note: "failed-no-auto-recover",
        failureReason: s.failureReason,
      });
    }

    const now = Date.now();
    const stale =
      s.wsState === "live" &&
      s.lastEventAt !== null &&
      now - s.lastEventAt > STALE_MS &&
      s.heartbeatAckPending;

    const lostSocket = s.wsState === "live" && this.liveWs === null;

    if (
      s.wsState === "idle" ||
      s.wsState === "reconnecting" ||
      stale ||
      lostSocket
    ) {
      if (stale || lostSocket) {
        log.warn(
          `watchdog: forcing reconnect stale=${stale} lostSocket=${lostSocket}`
        );
        this.closeSocket(1000, "watchdog");
      }
      await this.openGateway();
    }

    const after = await this.readState();
    return Response.json({ ok: true, wsState: after.wsState });
  }

  // ── Socket lifecycle ─────────────────────────────────────────────────────

  /**
   * Public, and named after Coral's handlers, so a test can drive a frame
   * through the DO with a stub socket and no network. This is not the
   * hibernation API's `webSocketMessage`; nothing calls it but the listener
   * attached in `openGateway` and the tests.
   */
  async handleSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const text =
      typeof data === "string" ? data : new TextDecoder().decode(data);
    const frame = parseFrame(text);
    if (!frame) {
      log.warn("dropped a frame that did not parse");
      return;
    }
    await this.handleFrame(ws, frame);
  }

  /** Public for the same reason as `webSocketMessage`. */
  async handleSocketClose(code: number, reason: string): Promise<void> {
    const disposition = classifyClose(code);
    log.info(`ws close code=${code} reason=${reason} -> ${disposition}`);
    this.liveWs = null;

    if (disposition === "fatal") {
      log.error(
        `fatal gateway close ${code} (${reason}), halting reconnects. This needs a human.`
      );
      await this.patchState({
        wsState: "failed",
        failureReason: `fatal-close-${code}:${reason}`,
        heartbeatAckPending: false,
        heartbeatIntervalMs: null,
      });
      await this.clearAlarm();
      return;
    }

    const s = await this.readState();
    // `reconnectAttempt` counts closes already handled, so it indexes the step
    // this close should wait, and the first close after a READY takes
    // `BACKOFF_MS[0]`. Incrementing before indexing skipped that first step,
    // making the first reconnect wait 2s and leaving `BACKOFF_MS[0]`
    // unreachable from this path, against a README that documents 1s.
    const step = Math.min(s.reconnectAttempt, BACKOFF_MS.length - 1);
    const delay = BACKOFF_MS[step] ?? 60_000;
    const attempt = Math.min(s.reconnectAttempt + 1, BACKOFF_MS.length - 1);

    await this.patchState({
      wsState: "reconnecting",
      reconnectAttempt: attempt,
      heartbeatAckPending: false,
      heartbeatIntervalMs: null,
      failureReason: `close-${code}`,
      // A re-identify disposition drops the session so `openGateway`
      // rediscovers the gateway URL and IDENTIFYs instead of RESUMEing into a
      // session the gateway has already thrown away.
      ...(disposition === "reidentify"
        ? { sessionId: null, resumeUrl: null, lastSeq: null }
        : {}),
    });

    log.info(
      `reconnect scheduled in ${delay}ms (consecutive close ${step + 1})`
    );
    await this.state.storage.setAlarm(Date.now() + delay);
  }

  /**
   * Two duties: heartbeat while live, reconnect while not. A null `liveWs`
   * always means reconnect, whatever the stored state claims, because the
   * stored state can outlive the isolate that held the socket.
   *
   * `failed` is tested before that rule, and the order is load-bearing.
   * `handleSocketClose` nulls `liveWs` before it writes `failed`, so the two
   * conditions always arrive together; with the null-socket branch first, the
   * `failed` branch could never be reached and a 4014 reconnected in a loop
   * against a permission only a human can restore. `clearAlarm` in
   * `handleSocketClose` was the only thing holding that back, and it loses the
   * race against the alarm `onHello` schedules moments before the IDENTIFY
   * that earns the 4014.
   */
  async alarm(): Promise<void> {
    const s = await this.readState();

    if (s.wsState === "failed") {
      log.warn(
        `alarm while parked in failed (${s.failureReason}), staying parked. Only /_admin/gateway/connect restarts this.`
      );
      await this.clearAlarm();
      return;
    }

    if (
      s.wsState === "reconnecting" ||
      s.wsState === "idle" ||
      this.liveWs === null
    ) {
      log.info(`alarm: reopening (wsState=${s.wsState})`);
      await this.openGateway();
      return;
    }

    if (s.heartbeatIntervalMs === null) {
      log.warn("alarm without a heartbeat interval, reopening");
      this.closeSocket(1000, "no-heartbeat-interval");
      await this.openGateway();
      return;
    }

    if (s.heartbeatAckPending) {
      // The previous heartbeat was never acked, so the socket is a zombie:
      // still open locally, dead at the other end. This is the check that
      // catches a silently dropped connection.
      log.warn("heartbeat ack missing, forcing reconnect");
      this.closeSocket(1000, "heartbeat-ack-missing");
      await this.patchState({
        wsState: "reconnecting",
        heartbeatAckPending: false,
        heartbeatIntervalMs: null,
      });
      await this.state.storage.setAlarm(Date.now() + BACKOFF_MS[0]);
      return;
    }

    const ws = this.liveWs;
    try {
      ws.send(JSON.stringify({ op: 1, d: s.lastSeq }));
      await this.patchState({
        lastHeartbeatAt: Date.now(),
        heartbeatAckPending: true,
      });
      await this.state.storage.setAlarm(Date.now() + s.heartbeatIntervalMs);
    } catch (error) {
      log.warn(`heartbeat send failed: ${getErrorMessage(error)}`);
      this.closeSocket(1000, "heartbeat-send-failed");
      await this.openGateway();
    }
  }

  // ── Frames ───────────────────────────────────────────────────────────────

  private async handleFrame(ws: WebSocket, frame: GatewayFrame): Promise<void> {
    const s = await this.readState();
    const now = Date.now();
    const patch: Partial<GatewayState> = { lastEventAt: now };
    if (typeof frame.s === "number") {
      patch.lastSeq = frame.s;
    }

    switch (frame.op) {
      case 10:
        await this.onHello(ws, frame, s, patch);
        return;
      case 11:
        await this.patchState({ ...patch, heartbeatAckPending: false });
        return;
      case 1:
        // The gateway asked for a heartbeat now. Send it and leave the alarm
        // where it is.
        try {
          ws.send(JSON.stringify({ op: 1, d: s.lastSeq }));
          patch.lastHeartbeatAt = now;
          patch.heartbeatAckPending = true;
        } catch (error) {
          log.warn(`requested heartbeat failed: ${getErrorMessage(error)}`);
        }
        await this.patchState(patch);
        return;
      case 7:
        log.info("op=7, gateway asked us to reconnect");
        await this.patchState(patch);
        this.closeSocket(1000, "gateway-op7");
        await this.state.storage.setAlarm(Date.now() + BACKOFF_MS[0]);
        return;
      case 9:
        await this.onInvalidSession(ws, frame, s, patch);
        return;
      case 0:
        await this.onDispatch(frame, s, patch);
        return;
      default:
        await this.patchState(patch);
    }
  }

  private async onHello(
    ws: WebSocket,
    frame: GatewayFrame,
    s: GatewayState,
    patch: Partial<GatewayState>
  ): Promise<void> {
    const data = isRecord(frame.d) ? frame.d : {};
    const interval = data.heartbeat_interval;
    if (typeof interval !== "number" || interval <= 0) {
      log.warn("HELLO without a usable heartbeat_interval");
      return;
    }

    await this.patchState({
      ...patch,
      heartbeatIntervalMs: interval,
      heartbeatAckPending: false,
      wsState: "identifying",
    });

    // Discord asks for the first heartbeat at `interval * jitter` where jitter
    // is in [0,1), so a fleet of shards does not heartbeat in lockstep. This
    // is a single connection and could send at the full interval, but the
    // jitter is one line and it is what the documented protocol asks for.
    const jittered = Math.floor(interval * Math.random());
    await this.state.storage.setAlarm(Date.now() + jittered);
    log.info(`HELLO interval=${interval}ms first heartbeat in ${jittered}ms`);

    if (s.sessionId && s.lastSeq !== null) {
      this.sendResume(ws, s.sessionId, s.lastSeq);
    } else {
      this.sendIdentify(ws);
    }
  }

  private async onInvalidSession(
    ws: WebSocket,
    frame: GatewayFrame,
    s: GatewayState,
    patch: Partial<GatewayState>
  ): Promise<void> {
    const resumable = frame.d === true;
    const failures = s.consecutiveResumeFailures + 1;
    log.warn(`INVALID_SESSION resumable=${resumable} failures=${failures}`);

    if (failures >= RESUME_FAILURE_ALARM) {
      log.error(
        `${failures} resume failures in a row, session is not sticking`
      );
    }

    await this.patchState({
      ...patch,
      consecutiveResumeFailures: failures,
      ...(resumable ? {} : { sessionId: null, resumeUrl: null, lastSeq: null }),
    });

    // Discord asks for a 1 to 5 second wait before re-identifying.
    const delay = 1000 + Math.floor(Math.random() * 4000);
    setTimeout(() => {
      try {
        this.sendIdentify(ws);
      } catch (error) {
        log.warn(`re-IDENTIFY failed: ${getErrorMessage(error)}`);
      }
    }, delay);
  }

  private async onDispatch(
    frame: GatewayFrame,
    s: GatewayState,
    patch: Partial<GatewayState>
  ): Promise<void> {
    if (frame.t === "READY") {
      const data = isRecord(frame.d) ? frame.d : {};
      const user = isRecord(data.user) ? data.user : {};
      await this.patchState({
        ...patch,
        sessionId: typeof data.session_id === "string" ? data.session_id : null,
        resumeUrl:
          typeof data.resume_gateway_url === "string"
            ? data.resume_gateway_url
            : null,
        selfUserId: typeof user.id === "string" ? user.id : null,
        wsState: "live",
        reconnectAttempt: 0,
        consecutiveResumeFailures: 0,
        failureReason: null,
      });
      log.info(`READY as ${String(user.id)}`);
      return;
    }

    if (frame.t === "RESUMED") {
      await this.patchState({
        ...patch,
        wsState: "live",
        reconnectAttempt: 0,
        failureReason: null,
      });
      log.info("RESUMED");
      return;
    }

    if (frame.t === "MESSAGE_CREATE") {
      // The sequence is written down first, before any of the lookup work, and
      // on every message rather than only answered ones.
      //
      // `sendResume` replays from `lastSeq`. A sequence that only advanced on
      // answered lookups asked Discord to replay from the last *answer*,
      // possibly hours of chatter earlier: the answered lookup comes back down
      // the wire and is answered a second time (nothing dedupes by message id),
      // and a sequence far enough behind earns `op=9 INVALID_SESSION` and the
      // full re-IDENTIFY the resume path exists to avoid.
      //
      // Writing before the answer rather than after also picks the safer side
      // of a crash: a message whose sequence landed but whose reply did not is
      // silently missed, where the other order would post the same embeds
      // twice after the RESUME.
      //
      // The write this skips is one state write per message. The expensive
      // work is still gated inside `onMessageCreate`: the cross-DO idle clock
      // write only happens for human messages in `#general`, and the lookup's
      // upstream calls only for a parsed match in a served channel.
      await this.patchState(patch);
      await this.onMessageCreate(frame.d, s);
      return;
    }

    await this.patchState(patch);
  }

  /**
   * The idle clock and the lookup path for one message. The caller has already
   * recorded the sequence number, so nothing here decides whether it is worth
   * writing state; the gates below only decide how much work to do.
   */
  private async onMessageCreate(raw: unknown, s: GatewayState): Promise<void> {
    const message = parseMessageCreate(raw);
    if (!message) {
      return;
    }

    // Before the lookup gates, and independent of them: any human line in
    // `#general` counts as the room being alive whether or not it happens to
    // parse as `b#123`.
    if (isHumanActivity(message, s.selfUserId)) {
      await this.recordHumanActivity();
    }

    // The outcome is dropped on purpose: it no longer gates a state write, and
    // `handleLookupMessage` already logs the cases worth hearing about (an
    // answer, a rate limit, a failed send).
    await handleLookupMessage(message, {
      clients: {
        glyphbots: createGlyphBotsClient(this.env),
        opensea: createOpenSeaClient(this.env),
      },
      limiter: this.limiter,
      selfUserId: s.selfUserId,
      send: async (channelId, body) => {
        if (!this.env.DISCORD_TOKEN) {
          throw new Error("DISCORD_TOKEN is not set");
        }
        await createChannelPoster(
          { DISCORD_TOKEN: this.env.DISCORD_TOKEN },
          channelId
        ).send(body);
      },
    });
  }

  /**
   * Write the idle clock forward, best effort.
   *
   * Deliberately swallowed on failure. The cost of a lost write is one nudge
   * arriving up to a day early against a guild that had in fact spoken, which
   * is a cosmetic problem; the cost of letting it throw is a lookup going
   * unanswered because a storage write failed, which is a real one. The DO
   * merges by maximum, so a lost write is also recovered by the next message.
   */
  private async recordHumanActivity(): Promise<void> {
    try {
      await createIdleStateStore(this.env).apply({
        op: "human-message",
        atMs: Date.now(),
      });
    } catch (error) {
      log.warn(`Idle clock write failed: ${getErrorMessage(error)}`);
    }
  }

  // ── Outbound ─────────────────────────────────────────────────────────────

  private sendIdentify(ws: WebSocket): void {
    const token = this.env.DISCORD_TOKEN;
    if (!token) {
      log.error("DISCORD_TOKEN is not set, cannot IDENTIFY");
      return;
    }
    try {
      ws.send(
        JSON.stringify({
          op: 2,
          d: {
            token,
            intents: GATEWAY_INTENTS,
            properties: {
              os: "linux",
              browser: "glyphbots-worker",
              device: "glyphbots-worker",
            },
          },
        })
      );
      log.info(`IDENTIFY sent intents=${GATEWAY_INTENTS}`);
    } catch (error) {
      log.warn(`IDENTIFY send failed: ${getErrorMessage(error)}`);
    }
  }

  private sendResume(ws: WebSocket, sessionId: string, seq: number): void {
    const token = this.env.DISCORD_TOKEN;
    if (!token) {
      log.error("DISCORD_TOKEN is not set, cannot RESUME");
      return;
    }
    try {
      ws.send(
        JSON.stringify({ op: 6, d: { token, session_id: sessionId, seq } })
      );
      log.info(`RESUME sent seq=${seq}`);
    } catch (error) {
      log.warn(`RESUME send failed: ${getErrorMessage(error)}`);
    }
  }

  // ── Connect ──────────────────────────────────────────────────────────────

  /**
   * The only way to open a socket. Everything funnels through here so the
   * in-flight guard cannot be skipped: `handleConnect` checks `wsState`, but
   * `alarm` and `handleHealthTick` do not, and `wsState` is a poor guard
   * anyway because it is not written until the connect is already under way.
   *
   * The guard is set synchronously, before `connectOnce` reaches its first
   * `await`, which is what makes it cover the `await fetch` that `liveWs`
   * cannot. A second caller joins the connect already running and observes the
   * same outcome.
   */
  private openGateway(): Promise<void> {
    const inFlight = this.connectInFlight;
    if (inFlight) {
      if (Date.now() - this.connectStartedAt < CONNECT_WEDGE_MS) {
        log.info("connect already in flight, joining it");
        return inFlight;
      }
      // Past a minute the reference is abandoned rather than joined. That is
      // the behaviour from before the guard existed, and it is only reachable
      // in a case that is already broken.
      log.warn(
        "connect has been in flight for over a minute, starting another"
      );
    }

    const attempt = this.connectOnce().finally(() => {
      if (this.connectInFlight === attempt) {
        this.connectInFlight = null;
      }
    });
    this.connectInFlight = attempt;
    this.connectStartedAt = Date.now();
    return attempt;
  }

  private async connectOnce(): Promise<void> {
    if (this.liveWs) {
      // A lingering reference means a caller skipped `closeSocket`. Drop it
      // before attaching listeners to a new socket, or the old listeners keep
      // the dead socket alive and both write to the same state.
      this.closeSocket(1000, "stale-pre-open");
    }

    const token = this.env.DISCORD_TOKEN;
    if (!token) {
      log.error("DISCORD_TOKEN is not set, cannot connect");
      await this.patchState({
        wsState: "failed",
        failureReason: "missing-bot-token",
      });
      return;
    }

    // Written before discovery rather than just before the upgrade, so that
    // `wsState` is honest for the whole connect. `handleConnect`'s guard and
    // the watchdog's `lostSocket` check both read it, and both were wrong
    // while the `/gateway/bot` call was outstanding.
    await this.patchState({ wsState: "connecting" });

    const stored = await this.readState();
    let url: string;
    if (stored.sessionId && stored.resumeUrl) {
      url = stored.resumeUrl;
    } else {
      const discovered = await this.discoverGatewayUrl(token);
      if (!discovered) {
        await this.patchState({
          wsState: "reconnecting",
          failureReason: "discover-failed",
        });
        await this.state.storage.setAlarm(Date.now() + BACKOFF_MS[0]);
        return;
      }
      url = discovered;
    }

    // Workers' `fetch` will not take a `wss://` URL. The upgrade is negotiated
    // over HTTPS through the `Upgrade` header and the response carries the
    // socket, so the scheme is rewritten rather than the protocol changed.
    const httpUrl = url
      .replace(WSS_PREFIX_RE, "https://")
      .replace(WS_PREFIX_RE, "http://");
    const wsUrl = `${httpUrl.replace(/\/$/, "")}${GATEWAY_QUERY}`;

    try {
      const response = await fetch(wsUrl, {
        headers: { Upgrade: "websocket" },
      });

      if (response.status !== 101 || !response.webSocket) {
        log.error(`gateway upgrade failed, status ${response.status}`);
        await this.patchState({
          wsState: "reconnecting",
          failureReason: `upgrade-${response.status}`,
          // A resume URL that will not upgrade is worse than none: it would be
          // retried forever. Drop back to discovery on the next attempt.
          ...(stored.resumeUrl ? { resumeUrl: null } : {}),
        });
        await this.state.storage.setAlarm(Date.now() + BACKOFF_MS[0]);
        return;
      }

      const ws = response.webSocket;
      // Not `state.acceptWebSocket`: see the hibernation note at the top.
      ws.accept();
      ws.addEventListener("message", (event: MessageEvent) => {
        this.handleSocketMessage(ws, event.data as string | ArrayBuffer).catch(
          (error: unknown) => {
            log.warn(`frame handler threw: ${getErrorMessage(error)}`);
          }
        );
      });
      ws.addEventListener("close", (event: CloseEvent) => {
        this.handleSocketClose(event.code, event.reason).catch(
          (error: unknown) => {
            log.warn(`close handler threw: ${getErrorMessage(error)}`);
          }
        );
      });
      ws.addEventListener("error", (event: Event) => {
        log.warn(`gateway socket error: ${String(event)}`);
      });
      this.liveWs = ws;
      log.info("gateway socket open, waiting for HELLO");
    } catch (error) {
      log.error(`gateway connect threw: ${getErrorMessage(error)}`);
      await this.patchState({
        wsState: "reconnecting",
        failureReason: `connect-threw:${getErrorMessage(error)}`,
      });
      await this.state.storage.setAlarm(Date.now() + BACKOFF_MS[0]);
    }
  }

  private async discoverGatewayUrl(token: string): Promise<string | null> {
    try {
      const response = await fetch(`${DISCORD_API}/gateway/bot`, {
        headers: { Authorization: `Bot ${token}` },
      });
      if (!response.ok) {
        log.warn(`/gateway/bot failed ${response.status}`);
        return null;
      }
      const body = (await response.json()) as { url?: unknown };
      return typeof body.url === "string" ? body.url : null;
    } catch (error) {
      log.warn(`/gateway/bot threw: ${getErrorMessage(error)}`);
      return null;
    }
  }

  // ── State ────────────────────────────────────────────────────────────────

  private async readState(): Promise<GatewayState> {
    const stored =
      await this.state.storage.get<Partial<GatewayState>>(STATE_KEY);
    return { ...INITIAL_STATE, ...(stored ?? {}) };
  }

  private async patchState(patch: Partial<GatewayState>): Promise<void> {
    const current = await this.readState();
    await this.state.storage.put(STATE_KEY, { ...current, ...patch });
  }

  private async clearAlarm(): Promise<void> {
    if ((await this.state.storage.getAlarm()) !== null) {
      await this.state.storage.deleteAlarm();
    }
  }

  private closeSocket(code: number, reason: string): void {
    const ws = this.liveWs;
    this.liveWs = null;
    if (!ws) {
      return;
    }
    try {
      ws.close(code, reason);
    } catch {
      // A socket that is already gone is the outcome being asked for.
    }
  }
}

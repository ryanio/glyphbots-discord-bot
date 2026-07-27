/**
 * The interactions endpoint and the defer inversion.
 *
 * The signature cases generate a real Ed25519 keypair through WebCrypto and
 * sign real bodies, rather than stubbing `verifySignature`. Discord rejects the
 * Interactions Endpoint URL outright if this path is wrong, and a stub would
 * prove nothing about it.
 */

import { InteractionResponseType } from "discord-api-types/v10";
import { describe, expect, it, vi } from "vitest";
import { getHandler, handlers } from "../src/commands";
import { readOptions, readUserId } from "../src/commands/context";
import { commandDefinitions } from "../src/commands/definitions";
import {
  deferAndFollowUp,
  errorFollowUp,
  type FollowUp,
} from "../src/discord/interactions";
import { verifySignature } from "../src/discord/verify";
import worker from "../src/index";
import type { WorkerEnv } from "../src/types";
import {
  boolOption,
  collectingWaitUntil,
  commandInteraction,
  intOption,
  recordingEditOriginal,
  stringOption,
} from "./interaction-fixtures";

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** A real keypair plus a signer, for the verification cases. */
const keypair = async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;

  const publicKey = toHex(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer
  );

  const sign = async (message: string): Promise<string> =>
    toHex(
      await crypto.subtle.sign(
        "Ed25519",
        pair.privateKey,
        new TextEncoder().encode(message)
      )
    );

  return { publicKey, sign };
};

describe("Ed25519 verification", () => {
  it("accepts a signature over the exact timestamp and body", async () => {
    const { publicKey, sign } = await keypair();
    const timestamp = "1700000000";
    const body = JSON.stringify({ type: 1 });

    const signature = await sign(timestamp + body);

    await expect(
      verifySignature(publicKey, signature, timestamp, body)
    ).resolves.toBe(true);
  });

  it("rejects a tampered body", async () => {
    const { publicKey, sign } = await keypair();
    const timestamp = "1700000000";
    const body = JSON.stringify({ type: 1 });
    const signature = await sign(timestamp + body);

    await expect(
      verifySignature(publicKey, signature, timestamp, `${body} `)
    ).resolves.toBe(false);
  });

  it("rejects a tampered timestamp", async () => {
    const { publicKey, sign } = await keypair();
    const body = JSON.stringify({ type: 1 });
    const signature = await sign(`1700000000${body}`);

    await expect(
      verifySignature(publicKey, signature, "1700000001", body)
    ).resolves.toBe(false);
  });

  it("rejects a signature from a different key", async () => {
    const a = await keypair();
    const b = await keypair();
    const timestamp = "1700000000";
    const body = JSON.stringify({ type: 1 });

    const signature = await b.sign(timestamp + body);

    await expect(
      verifySignature(a.publicKey, signature, timestamp, body)
    ).resolves.toBe(false);
  });

  it("rejects missing, malformed and wrong-length inputs", async () => {
    const { publicKey, sign } = await keypair();
    const timestamp = "1700000000";
    const body = "{}";
    const signature = await sign(timestamp + body);

    await expect(verifySignature("", signature, timestamp, body)).resolves.toBe(
      false
    );
    await expect(verifySignature(publicKey, "", timestamp, body)).resolves.toBe(
      false
    );
    await expect(verifySignature(publicKey, signature, "", body)).resolves.toBe(
      false
    );
    // Not hex.
    await expect(
      verifySignature(publicKey, "z".repeat(128), timestamp, body)
    ).resolves.toBe(false);
    // Right alphabet, wrong length.
    await expect(
      verifySignature(publicKey, "ab".repeat(10), timestamp, body)
    ).resolves.toBe(false);
    await expect(
      verifySignature("ab".repeat(10), signature, timestamp, body)
    ).resolves.toBe(false);
  });
});

// ── The endpoint ───────────────────────────────────────────────────────

const testEnv = (publicKey: string): WorkerEnv =>
  ({
    DISCORD_PUBLIC_KEY: publicKey,
    DISCORD_APP_ID: "111111111111111111",
    DISCORD_TOKEN: "bot-token",
  }) as unknown as WorkerEnv;

const post = (
  body: string,
  headers: Record<string, string>,
  env: WorkerEnv,
  waitUntil: (p: Promise<unknown>) => void = () => undefined
) =>
  worker.fetch(
    new Request("https://worker.test/discord/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    }),
    env,
    { waitUntil, passThroughOnException: () => undefined } as ExecutionContext
  );

describe("POST /discord/interactions", () => {
  it("answers PING with PONG", async () => {
    const { publicKey, sign } = await keypair();
    const timestamp = "1700000000";
    const body = JSON.stringify({ type: 1, id: "1", application_id: "1" });

    const response = await post(
      body,
      {
        "x-signature-ed25519": await sign(timestamp + body),
        "x-signature-timestamp": timestamp,
      },
      testEnv(publicKey)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: InteractionResponseType.Pong,
    });
  });

  it("rejects a tampered body with 401 and never reaches the router", async () => {
    const { publicKey, sign } = await keypair();
    const timestamp = "1700000000";
    const body = JSON.stringify({ type: 1 });
    const signature = await sign(timestamp + body);

    const response = await post(
      JSON.stringify({ type: 2, data: { name: "floor" } }),
      {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      testEnv(publicKey)
    );

    expect(response.status).toBe(401);
  });

  it("rejects a missing signature header with 401", async () => {
    const { publicKey } = await keypair();

    const response = await post(
      JSON.stringify({ type: 1 }),
      { "x-signature-timestamp": "1700000000" },
      testEnv(publicKey)
    );

    expect(response.status).toBe(401);
  });

  it("refuses to serve at all without a configured public key", async () => {
    const response = await post(
      JSON.stringify({ type: 1 }),
      {},
      {} as WorkerEnv
    );

    expect(response.status).toBe(503);
  });

  it("defers a verified slash command and schedules the follow-up", async () => {
    // The deferred work runs for real here, so nothing may reach the network.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 500 }));

    const { publicKey, sign } = await keypair();
    const timestamp = "1700000000";
    const body = JSON.stringify(commandInteraction("floor"));
    const scheduled = collectingWaitUntil();

    const response = await post(
      body,
      {
        "x-signature-ed25519": await sign(timestamp + body),
        "x-signature-timestamp": timestamp,
      },
      testEnv(publicKey),
      scheduled.waitUntil
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
    expect(scheduled.promises).toHaveLength(1);

    // And the deferred half still answers, rather than hanging.
    await scheduled.settle();
    const patched = fetchSpy.mock.calls.find(
      ([input, init]) =>
        String(input).includes("/messages/@original") &&
        (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patched).toBeDefined();
    fetchSpy.mockRestore();
  });

  it("rejects an unknown command name", async () => {
    const { publicKey, sign } = await keypair();
    const timestamp = "1700000000";
    const body = JSON.stringify(commandInteraction("arena"));

    const response = await post(
      body,
      {
        "x-signature-ed25519": await sign(timestamp + body),
        "x-signature-timestamp": timestamp,
      },
      testEnv(publicKey)
    );

    expect(response.status).toBe(400);
  });
});

// ── The defer inversion itself ─────────────────────────────────────────

describe("deferAndFollowUp", () => {
  const args = (build: () => Promise<FollowUp>) => {
    const scheduled = collectingWaitUntil();
    const recorder = recordingEditOriginal();
    return {
      scheduled,
      recorder,
      call: () =>
        deferAndFollowUp({
          appId: "app",
          interactionToken: "token",
          commandName: "floor",
          waitUntil: scheduled.waitUntil,
          build,
          editOriginal: recorder.editOriginal,
        }),
    };
  };

  it("returns type 5 synchronously, before the work runs", () => {
    let started = false;
    const harness = args(() => {
      started = true;
      return Promise.resolve({ content: "done" });
    });

    const response = harness.call();

    expect(response).toEqual({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
    });
    // The build has been scheduled but its result was not awaited.
    expect(harness.recorder.calls).toHaveLength(0);
    expect(started).toBe(true);
  });

  it("PATCHes the built follow-up once the work settles", async () => {
    const harness = args(() => Promise.resolve({ content: "the answer" }));

    harness.call();
    await harness.scheduled.settle();

    expect(harness.recorder.calls).toEqual([{ content: "the answer" }]);
  });

  it("PATCHes an error message when the handler throws, never a silent spinner", async () => {
    const harness = args(() => Promise.reject(new Error("upstream exploded")));

    harness.call();
    await harness.scheduled.settle();

    expect(harness.recorder.calls).toHaveLength(1);
    expect(harness.recorder.calls[0]).toEqual(errorFollowUp("floor"));
  });

  it("does not throw out of waitUntil when the PATCH itself fails", async () => {
    const scheduled = collectingWaitUntil();

    deferAndFollowUp({
      appId: "app",
      interactionToken: "token",
      commandName: "floor",
      waitUntil: scheduled.waitUntil,
      build: () => Promise.reject(new Error("boom")),
      editOriginal: vi.fn(() => Promise.resolve(false)),
    });

    await expect(scheduled.settle()).resolves.toBeDefined();
  });
});

// ── Wiring ─────────────────────────────────────────────────────────────

describe("command registry", () => {
  it("registers exactly the eight in-scope commands", () => {
    expect(commandDefinitions.map((c) => c.name).sort()).toEqual([
      "activity",
      "artifact",
      "bot",
      "floor",
      "listings",
      "owner",
      "rarity",
      "sales",
    ]);
  });

  it("has a handler for every definition and no orphans", () => {
    expect(Object.keys(handlers).sort()).toEqual(
      commandDefinitions.map((c) => c.name).sort()
    );
    for (const definition of commandDefinitions) {
      expect(getHandler(definition.name)).toBeTypeOf("function");
    }
  });

  it("drops the nine pruned commands", () => {
    const names = new Set(commandDefinitions.map((c) => c.name));
    for (const pruned of [
      "arena",
      "help",
      "info",
      "mybots",
      "random",
      "spotlight",
      "stats",
      "tips",
      "wallet",
    ]) {
      expect(names.has(pruned)).toBe(false);
      expect(getHandler(pruned)).toBeUndefined();
    }
  });

  it("no longer advertises wallet-backed randomness on /bot", () => {
    const botCommand = commandDefinitions.find((c) => c.name === "bot");
    const randomOption = botCommand?.options?.find((o) => o.name === "random");
    expect(randomOption?.description).not.toMatch(/wallet/i);
  });
});

describe("option reading", () => {
  it("reads integers, booleans and strings by name", () => {
    const options = readOptions([
      intOption("id", 7),
      boolOption("random", true),
      stringOption("user", "someone"),
    ]);

    expect(options.getInteger("id")).toBe(7);
    expect(options.getBoolean("random")).toBe(true);
    expect(options.getString("user")).toBe("someone");
  });

  it("returns null for absent options and for the wrong type", () => {
    const options = readOptions([intOption("id", 7)]);

    expect(options.getInteger("missing")).toBeNull();
    expect(options.getString("id")).toBeNull();
    expect(options.getBoolean("id")).toBeNull();
    expect(readOptions().getInteger("id")).toBeNull();
  });

  it("reads the user id out of member.user", () => {
    expect(readUserId(commandInteraction("bot"))).toBe("user-1");
  });
});

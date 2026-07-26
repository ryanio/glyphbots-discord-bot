/**
 * Discord Ed25519 request verification, modelled on Coral's
 * `/Users/rg/dev/coral/packages/worker/src/routes/discord-auth.ts`.
 *
 * Workers exposes Ed25519 through WebCrypto, so there is no dependency and no
 * Node crypto shim. Discord signs `timestamp + rawBody` with the application's
 * private key; we verify against the public key from the developer portal.
 *
 * This runs before anything else parses the body, and the body must be the
 * exact bytes Discord sent. Reading it as text and re-serializing would change
 * key order or whitespace and break every signature.
 */

import { createLogger } from "../utils/logger";

const log = createLogger("DiscordVerify");

const HEX_RADIX = 16;
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
const HEX_REGEX = /^[0-9a-fA-F]*$/;

/** Decode hex, or null if the input is not clean hex. */
const hexToBytes = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0 || !HEX_REGEX.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), HEX_RADIX);
  }
  return bytes;
};

/**
 * Verify one interaction request. Returns false rather than throwing, so the
 * caller's only job is to turn false into a 401.
 */
export const verifySignature = async (
  publicKey: string,
  signature: string,
  timestamp: string,
  body: string
): Promise<boolean> => {
  try {
    if (!(publicKey && signature && timestamp)) {
      return false;
    }

    const keyData = hexToBytes(publicKey);
    if (!keyData || keyData.length !== ED25519_PUBLIC_KEY_BYTES) {
      return false;
    }

    const sig = hexToBytes(signature);
    if (!sig || sig.length !== ED25519_SIGNATURE_BYTES) {
      return false;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      keyData.buffer as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    const message = new TextEncoder().encode(timestamp + body);

    return await crypto.subtle.verify(
      "Ed25519",
      key,
      sig.buffer as ArrayBuffer,
      message
    );
  } catch (error) {
    log.warn(`Signature verification failed: ${String(error)}`);
    return false;
  }
};

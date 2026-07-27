/**
 * Scoped console logger.
 *
 * The Node bot wrote through `process.stdout.write`, which does not exist
 * here. Workers observability picks console output up on its own, so there is
 * nothing else to wire.
 */

export type Logger = {
  debug: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
};

export const createLogger = (prefix: string): Logger => ({
  debug: (message) => console.log(`[${prefix}] ${message}`),
  error: (message) => console.error(`[${prefix}] ${message}`),
  info: (message) => console.log(`[${prefix}] ${message}`),
  warn: (message) => console.warn(`[${prefix}] ${message}`),
});

/** Pull a printable message off an unknown thrown value. */
export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

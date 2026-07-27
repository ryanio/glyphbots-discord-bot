/**
 * Jest Test Setup
 *
 * Silences logger output during tests to keep test output clean.
 */

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Silence all logger output (which goes through process.stdout/stderr.write)
// The logger prefixes all output with "[GDB]" so we can filter it
beforeAll(() => {
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean => {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    if (str.includes("[GDB]")) {
      return true;
    }
    return originalStdoutWrite(
      chunk,
      encodingOrCallback as BufferEncoding,
      callback
    );
  }) as typeof process.stdout.write;

  process.stderr.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean => {
    const str = typeof chunk === "string" ? chunk : chunk.toString();
    if (str.includes("[GDB]")) {
      return true;
    }
    return originalStderrWrite(
      chunk,
      encodingOrCallback as BufferEncoding,
      callback
    );
  }) as typeof process.stderr.write;
});

afterAll(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});

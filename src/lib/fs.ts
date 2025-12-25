import type { MakeDirectoryOptions } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Read a file as UTF-8 text
 *
 * @param path - File path to read
 * @returns File contents as string
 * @throws Error if file cannot be read
 */
export async function readFileText(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

/**
 * Write text to a file
 *
 * @param path - File path to write
 * @param content - Content to write
 * @param encoding - File encoding (default: 'utf8')
 * @throws Error if file cannot be written
 */
export async function writeFileText(
  path: string,
  content: string,
  encoding: BufferEncoding = "utf8"
): Promise<void> {
  return await writeFile(path, content, encoding);
}

/**
 * Create a directory recursively
 *
 * @param path - Directory path to create
 * @param options - mkdir options (default: { recursive: true })
 * @throws Error if directory cannot be created
 */
export async function ensureDirectory(
  path: string,
  options: MakeDirectoryOptions = { recursive: true }
): Promise<string | undefined> {
  return await mkdir(path, options);
}

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { stripAnsi } from "./strip-ansi.js";

/** Error with a process exit code attached (see SPEC.md exit codes). */
export class InputError extends Error {
  readonly code: number;
  constructor(message: string, code = 2) {
    super(message);
    this.name = "InputError";
    this.code = code;
  }
}

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 500_000;

/**
 * Truncate to at most `maxLines` lines, keeping head and tail with a
 * `[... N lines truncated ...]` marker between them.
 */
export function truncateLines(text: string, maxLines: number): string {
  if (maxLines <= 0) return text;
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;

  const headCount = Math.ceil(maxLines / 2);
  const tailCount = maxLines - headCount;
  const removed = lines.length - headCount - tailCount;
  const head = lines.slice(0, headCount);
  const tail = tailCount > 0 ? lines.slice(lines.length - tailCount) : [];
  return [...head, `[... ${removed} lines truncated ...]`, ...tail].join("\n");
}

/** Hard byte cap on the text sent to the model (UTF-8 aware). */
export function enforceByteCap(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return text;
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  const marker = `\n[... input truncated at ${maxBytes} bytes ...]`;
  const keep = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  // Slice on a safe boundary: back off if we split a multi-byte char.
  let end = keep;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8") + marker;
}

/** Read all of stdin (assumes stdin is piped, not a TTY). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Read files, concatenating them with `--- <path> ---` headers.
 * Missing/unreadable files throw InputError (exit code 2).
 */
export async function readFiles(paths: string[]): Promise<string> {
  const parts: string[] = [];
  for (const p of paths) {
    let content: string;
    try {
      content = await readFile(p, "utf8");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new InputError(`Cannot read ${p}: ${reason}`, 2);
    }
    parts.push(`--- ${p} ---\n${content}`);
  }
  return parts.join("\n\n");
}

/**
 * Run a shell command and capture stdout+stderr combined.
 * Windows uses cmd.exe /c; POSIX uses /bin/sh -c.
 * A non-zero exit is NOT an error — the output (e.g. a failing test log)
 * is exactly what we want to analyze.
 */
export async function runCommand(command: string): Promise<string> {
  const isWin = process.platform === "win32";
  const child = spawn(isWin ? "cmd.exe" : "/bin/sh", isWin ? ["/c", command] : ["-c", command], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const chunks: Buffer[] = [];
  child.stdout.on("data", (d: Buffer) => chunks.push(d));
  child.stderr.on("data", (d: Buffer) => chunks.push(d));

  return new Promise<string>((resolve, reject) => {
    child.on("error", (err) =>
      reject(new InputError(`Failed to run command: ${err.message}`, 2))
    );
    child.on("close", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

export interface PrepareOptions {
  noColor?: boolean;
  maxLines?: number;
  maxBytes?: number;
}

/** Apply ANSI stripping, line truncation, then the byte cap. */
export function prepareInput(text: string, opts: PrepareOptions = {}): string {
  let out = text;
  if (opts.noColor) out = stripAnsi(out);
  out = truncateLines(out, opts.maxLines ?? DEFAULT_MAX_LINES);
  out = enforceByteCap(out, opts.maxBytes ?? DEFAULT_MAX_BYTES);
  return out;
}

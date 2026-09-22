#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  InputError,
  prepareInput,
  readFiles,
  readStdin,
  runCommand,
} from "./input.js";
import { buildPrompt, isModeName, MODE_NAMES, type ModeName } from "./modes.js";
import { runClaude } from "./runner.js";

export interface ParsedArgs {
  mode: ModeName;
  model?: string;
  question?: string;
  maxLines?: number;
  maxBytes?: number;
  raw: boolean;
  context: string[];
  noColor: boolean;
  verbose: boolean;
  help: boolean;
  version: boolean;
  cmd?: string;
  files: string[];
}

export class UsageError extends Error {}

const NUMERIC_FLAGS = new Set(["--max-lines", "--max-bytes"]);

/** Hand-rolled arg parser — no dependencies. */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    mode: "analyze",
    raw: false,
    context: [],
    noColor: false,
    verbose: false,
    help: false,
    version: false,
    files: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`Missing value for ${arg}`);
      return v;
    };

    switch (arg) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-V":
      case "--version":
        out.version = true;
        break;
      case "-m":
      case "--mode": {
        const v = next();
        if (!isModeName(v)) {
          throw new UsageError(
            `Unknown mode "${v}". Valid modes: ${MODE_NAMES.join(", ")}`
          );
        }
        out.mode = v;
        break;
      }
      case "--model":
        out.model = next();
        break;
      case "-q":
      case "--question":
        out.question = next();
        break;
      case "--max-lines":
      case "--max-bytes": {
        const v = next();
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          throw new UsageError(`${arg} expects a non-negative integer, got "${v}"`);
        }
        if (arg === "--max-lines") out.maxLines = n;
        else out.maxBytes = n;
        break;
      }
      case "--raw":
        out.raw = true;
        break;
      case "--context":
        out.context.push(next());
        break;
      case "--no-color":
        out.noColor = true;
        break;
      case "-v":
      case "--verbose":
        out.verbose = true;
        break;
      case "--cmd":
        out.cmd = next();
        break;
      default:
        if (arg.startsWith("-") && arg !== "-") {
          if (NUMERIC_FLAGS.has(arg.split("=")[0]!)) {
            const [flag, value] = arg.split("=");
            const v = value ?? next();
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
              throw new UsageError(`${flag} expects a non-negative integer, got "${v}"`);
            }
            if (flag === "--max-lines") out.maxLines = n;
            else out.maxBytes = n;
          } else {
            throw new UsageError(`Unknown option: ${arg}`);
          }
        } else {
          out.files.push(arg);
        }
    }
  }
  return out;
}

const HELP = `claude-code-shell — pipe terminal output or files into Claude Code

Usage:
  <command> | claude-analyze [options]
  claude-analyze <file...> [options]
  claude-analyze --cmd "<command>" [options]

Modes (-m): analyze (default), explain, fix, summarize, review, test

Options:
  -m, --mode <mode>       Prompt mode (see above)
      --model <name>      Model passed to claude --model
  -q, --question <text>   Extra question appended to the prompt
      --max-lines <n>     Truncate input keeping head+tail (default 2000)
      --max-bytes <n>     Hard byte cap on input (default 500000)
      --raw               Send input verbatim (no mode wrapper)
      --context <path>    Attach extra file as context (repeatable)
      --no-color          Strip ANSI escape codes from input
  -v, --verbose           Print the claude invocation and timing to stderr
  -h, --help              Show this help
  -V, --version           Show version

Examples:
  cat error.log | claude-analyze
  npm test 2>&1 | claude-analyze -m fix
  claude-analyze --cmd "docker compose up" -m summarize
  claude-analyze src/app.ts -m review
  git diff | claude-analyze -m test -q "focus on the auth module"

Exit codes:
  0 success · 1 usage error · 2 input read error · 127 claude CLI not found
  130 interrupted · other: claude's exit code forwarded
`;

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function main(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`claude-analyze: ${err.message}\n\n${HELP}`);
      return 1;
    }
    throw err;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    process.stdout.write(getVersion() + "\n");
    return 0;
  }

  // Input resolution precedence: --cmd > files > piped stdin > help.
  let rawInput: string;
  try {
    if (args.cmd !== undefined) {
      rawInput = await runCommand(args.cmd);
    } else if (args.files.length > 0) {
      rawInput = await readFiles(args.files);
    } else if (!process.stdin.isTTY) {
      rawInput = await readStdin();
    } else {
      process.stderr.write(HELP);
      return 1;
    }
  } catch (err) {
    if (err instanceof InputError) {
      process.stderr.write(`claude-analyze: ${err.message}\n`);
      return err.code;
    }
    throw err;
  }

  if (rawInput.trim().length === 0 && args.question === undefined) {
    process.stderr.write("claude-analyze: input is empty — nothing to analyze.\n");
    return 1;
  }

  const input = prepareInput(rawInput, {
    noColor: args.noColor,
    maxLines: args.maxLines,
    maxBytes: args.maxBytes,
  });

  let context: Array<{ path: string; content: string }> | undefined;
  if (args.context.length > 0) {
    try {
      context = [];
      for (const p of args.context) {
        const content = await readFiles([p]);
        context.push({ path: p, content: content.replace(`--- ${p} ---\n`, "") });
      }
    } catch (err) {
      if (err instanceof InputError) {
        process.stderr.write(`claude-analyze: ${err.message}\n`);
        return err.code;
      }
      throw err;
    }
  }

  const prompt = buildPrompt({
    mode: args.mode,
    input,
    question: args.question,
    context,
    raw: args.raw,
  });

  return runClaude({ prompt, model: args.model, verbose: args.verbose });
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(`claude-analyze: unexpected error: ${String(err)}\n`);
      process.exitCode = 1;
    });
}

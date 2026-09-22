import { spawn, spawnSync } from "node:child_process";

export const CLAUDE_NOT_FOUND_CODE = 127;
export const INTERRUPTED_CODE = 130;

export interface RunClaudeOptions {
  prompt: string;
  model?: string;
  verbose?: boolean;
  /** Command to spawn (overridable for tests). Default: "claude". */
  command?: string;
  /** Environment override (for tests). */
  env?: NodeJS.ProcessEnv;
}

/**
 * Preflight: can `command` be resolved on PATH? Deterministic not-found
 * detection — cmd.exe's exit code for a missing command varies (1 or 9009),
 * so we resolve before spawning instead of guessing afterwards.
 */
function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  const isWin = process.platform === "win32";
  const res = isWin
    ? spawnSync("where", [command], { env, stdio: "ignore" })
    : spawnSync("/bin/sh", ["-c", `command -v -- '${command}'`], { env, stdio: "ignore" });
  return res.status === 0;
}

/**
 * Spawn `claude -p --output-format text` with the prompt on stdin,
 * stream its stdout/stderr through, and resolve with its exit code.
 * Resolves with 127 when the claude CLI is not installed.
 */
export function runClaude(opts: RunClaudeOptions): Promise<number> {
  const command = opts.command ?? "claude";
  const args = ["-p", "--output-format", "text"];
  if (opts.model) args.push("--model", opts.model);

  if (opts.verbose) {
    process.stderr.write(`[ccs] exec: ${command} ${args.join(" ")}\n`);
    process.stderr.write(`[ccs] prompt bytes: ${Buffer.byteLength(opts.prompt, "utf8")}\n`);
  }

  const started = Date.now();
  const isWin = process.platform === "win32";
  const childEnv = opts.env ?? process.env;

  if (!commandExists(command, childEnv)) {
    printNotFound();
    return Promise.resolve(CLAUDE_NOT_FOUND_CODE);
  }

  return new Promise<number>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      if (isWin) {
        // Invoke through cmd.exe explicitly (not shell:true) to avoid DEP0190
        // warnings and Node's arg-requoting; quote tokens containing spaces.
        const comspec = childEnv.ComSpec ?? "cmd.exe";
        const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
        const line = [q(command), ...args.map(q)].join(" ");
        child = spawn(comspec, ["/d", "/s", "/c", line], {
          stdio: ["pipe", "inherit", "inherit"],
          env: childEnv,
          windowsVerbatimArguments: true,
        });
      } else {
        child = spawn(command, args, {
          stdio: ["pipe", "inherit", "inherit"],
          env: childEnv,
        });
      }
    } catch {
      printNotFound();
      resolve(CLAUDE_NOT_FOUND_CODE);
      return;
    }

    let notFound = false;
    child.on("error", () => {
      notFound = true;
    });

    const onSigint = () => {
      child.kill("SIGINT");
    };
    process.on("SIGINT", onSigint);

    child.on("close", (code, signal) => {
      process.removeListener("SIGINT", onSigint);
      if (opts.verbose) {
        process.stderr.write(`[ccs] claude exited in ${Date.now() - started}ms\n`);
      }
      if (notFound || (isWin && code === 9009)) {
        // 9009 = cmd.exe "program not recognized" — claude missing from PATH
        // when spawned through a shell on Windows.
        printNotFound();
        resolve(CLAUDE_NOT_FOUND_CODE);
        return;
      }
      if (signal === "SIGINT") {
        resolve(INTERRUPTED_CODE);
        return;
      }
      resolve(code ?? 1);
    });

    if (child.stdin) {
      child.stdin.on("error", () => {
        // Child may exit before we finish writing (e.g. not-found wrapper); ignore EPIPE.
      });
      child.stdin.end(opts.prompt);
    }
  });
}

function printNotFound(): void {
  process.stderr.write(
    "Claude Code CLI not found — install: npm i -g @anthropic-ai/claude-code\n"
  );
}

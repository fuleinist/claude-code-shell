# claude-code-shell — SPEC

A CLI shim that pipes any terminal output or file into Claude Code for analysis —
`cat error.log | claude-analyze` without leaving your terminal.

## Problem

Developers constantly context-switch between their terminal and Claude Code. Error
logs, stack traces, command output, and config files need to be copied/pasted into
a chat UI. This tool makes Claude Code a native pipe citizen.

## Goals

- Zero-friction: `some-command | claude-analyze` just works.
- Works on macOS, Linux, and Windows (Node.js >= 18).
- Delegates all LLM work to the locally installed Claude Code CLI (`claude -p`).
  No API keys managed by this tool.
- Small dependency footprint (TypeScript, no heavy frameworks).

## Non-goals

- Not a REPL/chat interface (use `claude` directly for that).
- No streaming TUI; output is printed when complete.
- No direct Anthropic API calls — always shell out to Claude Code CLI.

## CLI surface

Binary names: `claude-analyze` (primary), `ccs` (alias).

### Input sources (exactly one; precedence in this order)

1. `--cmd "<command>"` — run the command via shell, capture stdout+stderr, analyze it.
2. File arguments — `claude-analyze error.log config.json` — read and concatenate
   files (each prefixed with a `--- <path> ---` header).
3. Stdin — when stdin is piped (not a TTY), read it fully.
4. If none of the above and stdin is a TTY: print help and exit 1.

### Options

| Flag | Type | Default | Meaning |
|---|---|---|---|
| `-m, --mode <mode>` | enum | `analyze` | Prompt mode (see below) |
| `--model <name>` | string | (claude default) | Passed to `claude --model` |
| `-q, --question <text>` | string | — | Extra user question appended to the prompt |
| `--max-lines <n>` | number | `2000` | Truncate input; keep head+tail with `[... N lines truncated ...]` marker |
| `--max-bytes <n>` | number | `500000` | Hard byte cap on input sent to the model |
| `--raw` | bool | false | Send input verbatim as the prompt (no mode wrapper) |
| `--context <path...>` | string[] | — | Additional files attached as context after the main input |
| `--no-color` | bool | false | Strip ANSI escape codes from input before sending |
| `-v, --verbose` | bool | false | Print the exact `claude` invocation and timing to stderr |
| `-h, --help` | — | — | Usage help |
| `-V, --version` | — | — | Version from package.json |

### Modes

Each mode is a system-ish instruction wrapper prepended to the input:

- `analyze` (default): explain what happened, root-cause errors, suggest next steps.
- `explain`: explain what this code/output does, for a newcomer.
- `fix`: propose a concrete fix; output a unified diff or corrected file when possible.
- `summarize`: terse bullet summary, <= 15 bullets.
- `review`: code review — bugs, risks, style; prioritized findings.
- `test`: generate unit tests for the given code.

Modes are plain prompt templates in `src/modes.ts` — easy to extend.

## Behavior

1. Resolve input source per precedence above.
2. Apply `--no-color` stripping, then line/byte truncation.
3. Build prompt: mode template + input (+ `--question` + `--context` file contents).
4. Spawn `claude -p --output-format text` (add `--model` when given) with the prompt
   on stdin (avoid argv length limits).
5. Stream the child's stdout straight through to our stdout (progressive output);
   stderr forwarded to our stderr.
6. Exit with the child's exit code; if `claude` is not installed, print an actionable
   error ("Claude Code CLI not found — install: npm i -g @anthropic-ai/claude-code")
   and exit 127.
7. SIGINT: forward to child, then exit 130.

## Project layout

```
claude-code-shell/
├── package.json          # bins: claude-analyze, ccs; type: module
├── tsconfig.json         # strict, NodeNext, outDir dist
├── src/
│   ├── cli.ts            # arg parsing (hand-rolled, no dep), dispatch
│   ├── input.ts          # stdin/file/--cmd resolution, truncation
│   ├── modes.ts          # mode prompt templates
│   ├── runner.ts         # spawn claude, stream output, exit codes
│   └── strip-ansi.ts     # tiny ANSI stripper (no dep)
├── test/                 # node:test unit tests
└── README.md
```

## Acceptance criteria

- [ ] `npm run build` compiles cleanly under `tsc --strict`.
- [ ] `npm test` passes (unit tests for input resolution, truncation, ANSI strip,
      prompt assembly, arg parsing — runner tested with a fake `claude` on PATH).
- [ ] `echo "TypeError: x is not a function" | node dist/cli.js` invokes claude and
      prints a response (manual check where claude is installed).
- [ ] `node dist/cli.js --cmd "node -e \"throw new Error('boom')\""` analyzes the
      captured stderr.
- [ ] `--max-lines` truncation keeps head and tail with the marker line.
- [ ] No input + TTY → help text, exit 1.
- [ ] Missing `claude` binary → actionable error, exit 127.
- [ ] Works on Windows (`--cmd` uses `cmd.exe /c`; POSIX uses `/bin/sh -c`).
- [ ] README documents install, usage examples for every mode, and exit codes.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Usage error / no input |
| 2 | Input read error (file not found etc.) |
| 127 | `claude` CLI not found |
| 130 | Interrupted |
| other | Child `claude` exit code forwarded |

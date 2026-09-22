# claude-code-shell

Pipe any terminal output or file into [Claude Code](https://docs.anthropic.com/en/docs/claude-code) for analysis — without leaving your terminal.

```bash
cat error.log | claude-analyze
npm test 2>&1 | claude-analyze -m fix
claude-analyze --cmd "docker compose up" -m summarize
```

It's a thin shim: input goes in, a mode-specific prompt is assembled, and the
locally installed Claude Code CLI (`claude -p`) does the thinking. No API keys,
no accounts, no new infrastructure — just the `claude` you already have.

## Install

Requires Node.js >= 18 and the Claude Code CLI (`npm i -g @anthropic-ai/claude-code`).

```bash
npm install -g claude-code-shell
```

Or from source:

```bash
git clone https://github.com/fuleinist/claude-code-shell
cd claude-code-shell
npm install && npm run build
npm link   # provides `claude-analyze` and `ccs`
```

## Input sources

Exactly one, resolved in this order of precedence:

1. `--cmd "<command>"` — run a command, capture stdout+stderr, analyze the result.
2. File arguments — `claude-analyze app.log config.json` (files are concatenated
   with `--- <path> ---` headers).
3. Piped stdin — `kubectl logs pod | claude-analyze`.

With no input and an interactive terminal, it prints help and exits 1.

## Modes

| Mode | What it does |
|---|---|
| `analyze` (default) | Explain what happened, root-cause errors, suggest next steps |
| `explain` | Explain what the code/output does, for a newcomer |
| `fix` | Propose a concrete fix — unified diff or corrected file |
| `summarize` | Terse bullet summary (<= 15 bullets) |
| `review` | Prioritized code review: bugs, risks, style |
| `test` | Generate unit tests for the given code |

## Options

```
-m, --mode <mode>       Prompt mode (see above)
    --model <name>      Model passed to claude --model
-q, --question <text>   Extra question appended to the prompt
    --max-lines <n>     Truncate input keeping head+tail (default 2000)
    --max-bytes <n>     Hard byte cap on input (default 500000)
    --raw               Send input verbatim (no mode wrapper)
    --context <path>    Attach extra file as context (repeatable)
    --no-color          Strip ANSI escape codes from input
-v, --verbose           Print the claude invocation and timing to stderr
-h, --help              Show help
-V, --version           Show version
```

## Examples

```bash
# Root-cause a stack trace
cat crash.log | claude-analyze

# Fix a failing test suite
npm test 2>&1 | claude-analyze -m fix

# Review a file before committing
claude-analyze src/auth.ts -m review

# Summarize a long deploy log
claude-analyze --cmd "kubectl rollout status deploy/api" -m summarize

# Generate tests for a module, with the interface as context
claude-analyze src/parser.ts -m test --context src/types.ts

# Ask a specific question about piped output
git diff HEAD~1 | claude-analyze -q "does this change any public API?"

# Verbatim prompt, no wrapper
cat notes.txt | claude-analyze --raw
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Usage error / no input |
| 2 | Input read error (file not found, etc.) |
| 127 | `claude` CLI not found |
| 130 | Interrupted (SIGINT) |
| other | Claude Code's exit code, forwarded |

## How it works

1. Resolves input (`--cmd` > files > stdin), optionally strips ANSI codes,
   truncates to `--max-lines` (head + tail with a marker) and `--max-bytes`.
2. Assembles a prompt from the mode template + input + `--context` files +
   `--question`.
3. Spawns `claude -p --output-format text` with the prompt on **stdin**
   (no argv length limits), streaming its output straight through.
4. Forwards Claude Code's exit code.

## Development

```bash
npm install
npm run build   # tsc --strict -> dist/
npm test        # node --test (runner tests use a fake `claude` on PATH)
```

See [SPEC.md](SPEC.md) for the full specification and acceptance criteria.

## License

MIT

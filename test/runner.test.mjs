import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = join(repoRoot, "dist", "cli.js");

/** Create a temp dir holding a fake `claude` that echoes a canned response. */
async function makeFakeClaude(script) {
  const dir = await mkdtemp(join(tmpdir(), "ccs-fake-"));
  if (process.platform === "win32") {
    await writeFile(join(dir, "claude.cmd"), script.cmd);
  } else {
    const p = join(dir, "claude");
    await writeFile(p, script.sh);
    const { chmod } = await import("node:fs/promises");
    await chmod(p, 0o755);
  }
  return dir;
}

test("runner streams fake claude output and exits 0", async () => {
  const dir = await makeFakeClaude({
    cmd: "@echo off\r\necho FAKE_RESPONSE\r\nexit /b 0\r\n",
    sh: "#!/bin/sh\necho FAKE_RESPONSE\nexit 0\n",
  });
  const work = await mkdtemp(join(tmpdir(), "ccs-hi-"));
  try {
    // Script file avoids cmd.exe quoting issues with `node -e "..."`.
    const hi = join(work, "hi.js");
    await writeFile(hi, "console.log('hi');");
    const env = { ...process.env, PATH: dir + delimiter + process.env.PATH };
    const { stdout } = await execFileAsync(
      process.execPath,
      [cliPath, "--cmd", `node ${hi}`],
      { env }
    );
    assert.match(stdout, /FAKE_RESPONSE/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
});

test("missing claude binary exits 127 with actionable error", async () => {
  const empty = await mkdtemp(join(tmpdir(), "ccs-empty-"));
  try {
    // PATH: empty dir + System32 only. System32 provides cmd.exe/where.exe;
    // `echo` is a cmd builtin so no node needed. Crucially the nodejs dir is
    // EXCLUDED — a real global claude.cmd lives there and would be found.
    const sysDir =
      process.platform === "win32"
        ? join(process.env.SystemRoot ?? "C:\\Windows", "System32")
        : "/usr/bin";
    const env = { ...process.env, PATH: [empty, sysDir].join(delimiter) };
    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [cliPath, "--cmd", "echo hi"], {
          env,
          timeout: 30000,
        }),
      (err) => {
        assert.equal(err.code, 127, `stderr was: ${err.stderr}`);
        assert.match(err.stderr, /Claude Code CLI not found/);
        assert.match(err.stderr, /npm i -g @anthropic-ai\/claude-code/);
        return true;
      }
    );
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
});

test("no input on TTY-less empty stdin exits non-zero", async () => {
  // Empty piped stdin -> "input is empty" -> exit 1.
  // Must close the child's stdin or it waits forever.
  const pending = execFileAsync(process.execPath, [cliPath], { env: process.env });
  pending.child.stdin?.end();
  await assert.rejects(() => pending, (err) => err.code === 1);
});

test("--help exits 0 and prints usage", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--help"]);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /claude-analyze/);
});

test("--version exits 0 and prints package version", async () => {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "--version"]);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("file input path sends file content to claude", async () => {
  // Fake claude echoes its stdin back, proving the file made it into the prompt.
  const dir = await makeFakeClaude({
    cmd: "@echo off\r\nfindstr /C:\"SENTINEL_CONTENT\" >nul && echo PROMPT_OK\r\nexit /b 0\r\n",
    sh: "#!/bin/sh\ncat | grep -q SENTINEL_CONTENT && echo PROMPT_OK\nexit 0\n",
  });
  const work = await mkdtemp(join(tmpdir(), "ccs-work-"));
  try {
    const f = join(work, "log.txt");
    await writeFile(f, "SENTINEL_CONTENT here");
    const env = { ...process.env, PATH: dir + delimiter + process.env.PATH };
    const { stdout } = await execFileAsync(process.execPath, [cliPath, f], { env });
    assert.match(stdout, /PROMPT_OK/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
});

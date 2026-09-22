import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  truncateLines,
  enforceByteCap,
  readFiles,
  runCommand,
  prepareInput,
  InputError,
} from "../dist/input.js";

test("truncateLines keeps head and tail with marker", () => {
  const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
  const out = truncateLines(lines.join("\n"), 10);
  const parts = out.split("\n");
  assert.equal(parts.length, 11); // 10 kept + 1 marker
  assert.equal(parts[0], "line 1");
  assert.match(parts[5], /^\[\.\.\. 90 lines truncated \.\.\.\]$/);
  assert.equal(parts[parts.length - 1], "line 100");
});

test("truncateLines is a no-op under the limit", () => {
  const text = "a\nb\nc";
  assert.equal(truncateLines(text, 10), text);
});

test("enforceByteCap truncates oversized input", () => {
  const text = "x".repeat(1000);
  const out = enforceByteCap(text, 100);
  assert.ok(out.length < text.length);
  assert.match(out, /truncated at 100 bytes/);
});

test("enforceByteCap is a no-op under the cap", () => {
  assert.equal(enforceByteCap("small", 1000), "small");
});

test("readFiles prefixes each file with a header", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ccs-test-"));
  try {
    await writeFile(join(dir, "a.txt"), "AAA");
    await writeFile(join(dir, "b.txt"), "BBB");
    const out = await readFiles([join(dir, "a.txt"), join(dir, "b.txt")]);
    assert.match(out, /--- .*a\.txt ---\nAAA/);
    assert.match(out, /--- .*b\.txt ---\nBBB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFiles throws InputError code 2 for missing file", async () => {
  await assert.rejects(
    () => readFiles(["Z:\\definitely\\missing\\file.txt"]),
    (err) => err instanceof InputError && err.code === 2
  );
});

test("runCommand captures stdout and stderr", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ccs-run-"));
  try {
    // Script file avoids cmd.exe -e quoting hell on Windows.
    const script = join(dir, "emit.js");
    await writeFile(script, "console.log('OUT'); console.error('ERR');");
    const out = await runCommand(`node ${script}`);
    assert.match(out, /OUT/);
    assert.match(out, /ERR/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runCommand resolves (does not throw) on non-zero exit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ccs-run-"));
  try {
    const script = join(dir, "fail.js");
    await writeFile(script, "process.exit(3);");
    const out = await runCommand(`node ${script}`);
    assert.equal(typeof out, "string");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prepareInput applies noColor + truncation pipeline", () => {
  const lines = Array.from({ length: 50 }, (_, i) => `\u001b[31mline ${i}\u001b[0m`);
  const out = prepareInput(lines.join("\n"), { noColor: true, maxLines: 10 });
  assert.ok(!out.includes("\u001b"));
  assert.match(out, /lines truncated/);
});

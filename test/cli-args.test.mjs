import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, UsageError } from "../dist/cli.js";

test("defaults", () => {
  const a = parseArgs([]);
  assert.equal(a.mode, "analyze");
  assert.equal(a.raw, false);
  assert.deepEqual(a.files, []);
});

test("mode short and long flags", () => {
  assert.equal(parseArgs(["-m", "fix"]).mode, "fix");
  assert.equal(parseArgs(["--mode", "review"]).mode, "review");
});

test("invalid mode throws UsageError", () => {
  assert.throws(() => parseArgs(["-m", "bogus"]), UsageError);
});

test("positional files collected", () => {
  const a = parseArgs(["a.log", "b.json", "-m", "explain"]);
  assert.deepEqual(a.files, ["a.log", "b.json"]);
  assert.equal(a.mode, "explain");
});

test("--cmd captured separately from files", () => {
  const a = parseArgs(["--cmd", "npm test", "extra.log"]);
  assert.equal(a.cmd, "npm test");
  assert.deepEqual(a.files, ["extra.log"]);
});

test("numeric flags validate", () => {
  assert.equal(parseArgs(["--max-lines", "50"]).maxLines, 50);
  assert.equal(parseArgs(["--max-bytes=1024"]).maxBytes, 1024);
  assert.throws(() => parseArgs(["--max-lines", "abc"]), UsageError);
  assert.throws(() => parseArgs(["--max-lines", "-5"]), UsageError);
});

test("repeatable --context", () => {
  const a = parseArgs(["--context", "x.ts", "--context", "y.ts"]);
  assert.deepEqual(a.context, ["x.ts", "y.ts"]);
});

test("boolean flags", () => {
  const a = parseArgs(["--raw", "--no-color", "-v", "-h", "-V"]);
  assert.ok(a.raw && a.noColor && a.verbose && a.help && a.version);
});

test("unknown option throws UsageError", () => {
  assert.throws(() => parseArgs(["--nope"]), UsageError);
});

test("missing flag value throws UsageError", () => {
  assert.throws(() => parseArgs(["--model"]), UsageError);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, isModeName, MODE_NAMES } from "../dist/modes.js";

test("every mode produces a distinct wrapper", () => {
  const prompts = MODE_NAMES.map((m) => buildPrompt({ mode: m, input: "INPUT" }));
  assert.equal(new Set(prompts).size, MODE_NAMES.length);
  for (const p of prompts) {
    assert.match(p, /INPUT/);
    assert.match(p, /BEGIN INPUT/);
  }
});

test("raw mode sends input verbatim", () => {
  const p = buildPrompt({ mode: "analyze", input: "just this", raw: true });
  assert.equal(p, "just this");
});

test("question is appended", () => {
  const p = buildPrompt({ mode: "fix", input: "code", question: "why does it crash?" });
  assert.match(p, /Additional question from the user: why does it crash\?/);
});

test("context files are appended with headers", () => {
  const p = buildPrompt({
    mode: "review",
    input: "main",
    context: [{ path: "extra.ts", content: "CTX" }],
  });
  assert.match(p, /--- context: extra\.ts ---\nCTX/);
});

test("isModeName validates", () => {
  assert.equal(isModeName("analyze"), true);
  assert.equal(isModeName("bogus"), false);
});

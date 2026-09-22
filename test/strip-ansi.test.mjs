import test from "node:test";
import assert from "node:assert/strict";
import { stripAnsi } from "../dist/strip-ansi.js";

test("strips color codes", () => {
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m text"), "red text");
});

test("strips cursor movement sequences", () => {
  assert.equal(stripAnsi("a\u001b[2Kb\u001b[1Ac"), "abc");
});

test("leaves plain text untouched", () => {
  assert.equal(stripAnsi("no escapes here"), "no escapes here");
});

test("handles empty string", () => {
  assert.equal(stripAnsi(""), "");
});

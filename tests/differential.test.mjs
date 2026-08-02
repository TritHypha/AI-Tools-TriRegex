// Deterministic language-membership differential against JavaScript's Unicode
// RegExp for the intersection TriRegex intentionally supports. Span policy is
// not compared: TriRegex is leftmost-longest, while JavaScript is leftmost-first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../dist/index.js";

function inputs(alphabet, maxLength) {
  const out = [""];
  let frontier = [""];
  for (let n = 1; n <= maxLength; n++) {
    const next = [];
    for (const prefix of frontier) {
      for (const ch of alphabet) next.push(prefix + ch);
    }
    out.push(...next);
    frontier = next;
  }
  return out;
}

test("supported regular-language membership agrees with native RegExp", () => {
  const atoms = ["a", "b", ".", "[ab]", "[^b]", "\\d", "\\w", "😀"];
  const patterns = new Set([
    "",
    "^$",
    "^a$",
    "a|b",
    "(?:ab|b)",
    "(a+)+$",
    "(a|aa)+$",
  ]);
  for (const atom of atoms) {
    for (const suffix of ["", "?", "*", "+", "{0,2}", "{1,2}"]) {
      patterns.add(atom + suffix);
      patterns.add(`^${atom}${suffix}$`);
    }
  }
  for (const left of ["a", "[ab]", "\\d", "😀"]) {
    for (const right of ["b", ".", "\\w", "😀"]) {
      patterns.add(`${left}${right}`);
      patterns.add(`(${left}|${right})+`);
    }
  }

  const corpus = inputs(["a", "b", "1", "_", "\n", "😀"], 3);
  for (const pattern of patterns) {
    const tri = compile(pattern);
    assert.equal(tri.ok, true, `TriRegex must compile generated pattern ${pattern}`);
    if (!tri.ok) continue;
    const native = new RegExp(pattern, "u");
    for (const input of corpus) {
      assert.equal(
        tri.matcher.test(input).verdict === 1,
        native.test(input),
        `membership mismatch: /${pattern}/u on ${JSON.stringify(input)}`,
      );
    }
  }
});

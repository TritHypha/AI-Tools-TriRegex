// Fail-closed compile: everything outside the certified subset is a SECURITY_VETO
// value (ok:false, verdict:-1, named code) — never an exception, never a slow run,
// never a silently-guessed literal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../dist/index.js";

const veto = (pattern, code) => {
  const r = compile(pattern);
  assert.equal(r.ok, false, `${JSON.stringify(pattern)} must be refused`);
  assert.equal(r.verdict, -1);
  if (code) assert.equal(r.code, code, `${JSON.stringify(pattern)} → ${r.code}: ${r.reason}`);
  return r;
};

test("backreferences are refused by design (non-regular)", () => {
  veto("(a)\\1", "TPRX-UNSUPPORTED");
  veto("\\k<name>", "TPRX-UNSUPPORTED");
});

test("lookaround is refused by design", () => {
  veto("a(?=b)", "TPRX-UNSUPPORTED");
  veto("a(?!b)", "TPRX-UNSUPPORTED");
  veto("(?<=a)b", "TPRX-UNSUPPORTED");
  veto("(?<!a)b", "TPRX-UNSUPPORTED");
  veto("(?<name>a)", "TPRX-UNSUPPORTED");
});

test("word boundaries are refused in v0.1 (declared)", () => {
  veto("\\bword\\b", "TPRX-UNSUPPORTED");
  veto("a\\B", "TPRX-UNSUPPORTED");
});

test("unknown alpha escapes are refused — no silent literal", () => {
  veto("\\q", "TPRX-UNSUPPORTED");
  veto("\\A", "TPRX-UNSUPPORTED");
});

test("malformed patterns are parse refusals", () => {
  veto("(ab", "TPRX-PARSE");
  veto("ab)", "TPRX-PARSE");
  veto("[abc", "TPRX-PARSE");
  veto("a\\", "TPRX-PARSE");
  veto("a{2,1}", "TPRX-PARSE");
  veto("*a", "TPRX-PARSE");
  veto("^*", "TPRX-PARSE");
  veto("a{x}", "TPRX-PARSE");
  veto("[z-a]", "TPRX-PARSE");
  veto("\\x0g", "TPRX-PARSE");
});

test("budget bounds veto, never run slow", () => {
  veto("a{1001}", "TPRX-BUDGET");                       // repetition cap
  veto("(a{900}){900}", "TPRX-BUDGET");                 // expansion beyond maxInstructions
  veto("x".repeat(5000), "TPRX-BUDGET");                // pattern length
  const tight = compile("abc", { budget: { maxInstructions: 2 } });
  assert.equal(tight.ok, false);
  assert.equal(tight.code, "TPRX-BUDGET");
});

test("compile never throws on hostile pattern content", () => {
  const hostile = ["(((((", ")))))", "[^]", "[]", "\\u{110000}", "a{999999999}", "(?", "(?<", "|||", "{,}", "\\u12", "\\x"];
  for (const p of hostile) {
    const r = compile(p); // must return a value, any value
    assert.ok(typeof r.ok === "boolean", `compile(${JSON.stringify(p)}) returned`);
  }
});

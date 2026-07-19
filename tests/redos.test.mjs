// The point of the package: the classic ReDoS killers run in CERTIFIED LINEAR
// work here — no veto needed, no blowup possible. Steps are counted in the
// engine's own unit (bitset word-ops) and asserted against the certificate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../dist/index.js";

// expected verdicts on "a"×2000 + "!" — note `(a|a)*$` and `([a-zA-Z]+)*$`
// legitimately MATCH (the star matches empty at end-of-input, then $); native
// RegExp agrees — never "corrected" here to -1.
const KILLERS = [
  ["(a+)+$", -1],
  ["(a|a)*$", 1],
  ["(a|aa)+$", -1],
  ["([a-zA-Z]+)*$", 1],
  ["(a+)+b", -1],
];

test("classic ReDoS patterns run linear and within the certificate bound", () => {
  const n = 2000;
  const evil = "a".repeat(n) + "!"; // the mismatch tail that detonates backtrackers
  for (const [p, expected] of KILLERS) {
    const r = compile(p);
    assert.equal(r.ok, true, `${p} compiles (safe here, no veto needed)`);
    const out = r.matcher.test(evil);
    assert.equal(out.verdict, expected, `${p} verdict on the evil input`);
    const bound = (out.stats.chars + 2) * r.certificate.perCharWorkBound;
    assert.ok(out.stats.steps <= bound,
      `${p}: steps ${out.stats.steps} must be ≤ certified ${bound}`);
    assert.ok(out.stats.maxActive <= r.certificate.restingStates,
      `${p}: active set ${out.stats.maxActive} ≤ resting states ${r.certificate.restingStates}`);
  }
});

test("work grows linearly with input (double input ≲ double steps)", () => {
  const r = compile("(a+)+$");
  assert.equal(r.ok, true);
  const s1 = r.matcher.test("a".repeat(1000) + "!").stats.steps;
  const s2 = r.matcher.test("a".repeat(2000) + "!").stats.steps;
  assert.ok(s2 <= s1 * 2.5, `linear growth: steps(2n)=${s2} ≤ 2.5×steps(n)=${s1 * 2.5}`);
});

test("the certificate is available BEFORE any input is run", () => {
  const r = compile("(a|aa)+$");
  assert.equal(r.ok, true);
  const c = r.certificate;
  assert.ok(c.instructions > 0 && c.restingStates > 0 && c.restingStates <= c.instructions);
  assert.ok(c.perCharWorkBound > 0 && c.memoryBoundBytes > 0);
  assert.equal(c.anchoredStart, false);
  const anchored = compile("^abc");
  assert.equal(anchored.ok, true);
  assert.equal(anchored.certificate.anchoredStart, true);
});

test("oversized automata are refused at compile — cost is bounded up front", () => {
  const r = compile("(x{999}){999}");
  assert.equal(r.ok, false);
  assert.equal(r.code, "TPRX-BUDGET");
});

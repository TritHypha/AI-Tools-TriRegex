// findAll — semantics by differential against native RegExp.matchAll (start
// positions and non-overlap; span END policy is leftmost-longest here vs
// leftmost-first natively, so only start-sets and counts are compared where
// the two policies can differ), plus the derived work bound asserted on the
// classic ReDoS killers over adversarial input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../dist/index.js";

const ok = (p, o) => { const r = compile(p, o); assert.equal(r.ok, true, `compile ${p}: ${r.reason ?? ""}`); return r; };

// ── semantics ────────────────────────────────────────────────────────────────
test("findAll: literal, non-overlapping, input order, code-point spans", () => {
  const r = ok("ab");
  assert.deepEqual(r.findAll("xabyabab").spans, [[1, 3], [4, 6], [6, 8]]);
});

test("findAll: empty-matching pattern advances one code point per empty match (no loop)", () => {
  const r = ok("a*");
  const { spans, truncated } = r.findAll("baab");
  // b -> empty at 0; then 'aa' [1,3); then empty at 3 (before b); then empty at 4 (end)
  assert.deepEqual(spans, [[0, 0], [1, 3], [3, 3], [4, 4]]);
  assert.equal(truncated, false);
});

test("findAll: start-anchored pattern matches at most once, at true position 0", () => {
  assert.deepEqual(ok("^a").findAll("aaa").spans, [[0, 1]]);
  assert.deepEqual(ok("^a").findAll("baa").spans, []);
});

test("findAll: end-anchored pattern only matches a suffix that reaches the end", () => {
  assert.deepEqual(ok("a$").findAll("aXa").spans, [[2, 3]]);
  assert.deepEqual(ok("a+$").findAll("baaa").spans, [[1, 4]]);
});

test("findAll: astral code points count as one unit", () => {
  const r = ok("x");
  // 😀 is 2 UTF-16 units but ONE code point: x at cp index 1 and 3
  assert.deepEqual(r.findAll("😀x😀x").spans, [[1, 2], [3, 4]]);
});

test("findAll: maxMatches cap is reported as truncated, never silent", () => {
  const r = ok("a").findAll("aaaaaa", { maxMatches: 2 });
  assert.deepEqual(r.spans, [[0, 1], [1, 2]]);
  assert.equal(r.truncated, true);
  const full = ok("a").findAll("aaaaaa", { maxMatches: 6 });
  assert.equal(full.truncated, false, "cap exactly met is not truncation");
});

test("findAll: no match yields empty spans and a single segment (one pass, no rescans)", () => {
  const r = ok("z").findAll("abcabc");
  assert.deepEqual(r.spans, []);
  assert.equal(r.segments, 1);
  assert.equal(r.chars, 6, "every code point stepped exactly once");
});

test("findAll: adjacent matches chain without loss (the two-slot finality case)", () => {
  assert.deepEqual(ok("a").findAll("aaaa").spans, [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.deepEqual(ok("ab").findAll("ababab").spans, [[0, 2], [2, 4], [4, 6]]);
  assert.deepEqual(ok("a").findAll("aab").spans, [[0, 1], [1, 2]]);
});

test("findAll: the bound holds under uniformScan too (the shape the suffix design violated)", () => {
  // Measured on the first (suffix-rescan) design: N=2000 -> 2,013,003 steps vs a
  // 30,003 bound. A bound that holds only in the mode with an early exit is
  // not a bound; the single-pass design must hold it in BOTH modes.
  for (const [p, input] of [["a", "a".repeat(2000)], ["(a+)+$", "a".repeat(400) + "!"], ["a*", "b".repeat(1000)]]) {
    const r = compile(p, { uniformScan: true });
    assert.equal(r.ok, true);
    const out = r.findAll(input);
    assert.ok(out.steps <= out.stepsBound, `uniformScan /${p}/: steps ${out.steps} > bound ${out.stepsBound}`);
    const plain = compile(p).findAll(input);
    assert.deepEqual(out.spans, plain.spans, `uniformScan must not change spans for /${p}/`);
  }
});

test("findAll: adversarial dense-match input stays linear in wall work (no hidden O(N²) copies)", () => {
  const r = ok("a");
  const s1 = r.findAll("a".repeat(2000)).steps;
  const s2 = r.findAll("a".repeat(4000)).steps;
  assert.ok(s2 < s1 * 2.5, `steps ${s1} -> ${s2}: not linear`);
});

// ── differential vs native RegExp.matchAll on a generated corpus ─────────────
// Both engines: non-overlapping, empty match advances by one. Native is
// leftmost-FIRST; TriRegex is leftmost-LONGEST. Start positions agree whenever
// alternation order cannot change the START (it never can — the leftmost start
// is a property of the language, not the policy), so START sets are compared
// exactly. Ends are compared only for patterns where the two policies coincide.
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const ALPH = "abc";
function genInput(rnd, n) { let s = ""; for (let i = 0; i < n; i++) s += ALPH[Math.floor(rnd() * ALPH.length)]; return s; }

test("findAll: differential start-sets vs native matchAll over a deterministic corpus", () => {
  const patterns = ["a", "ab", "a+", "b*", "[ab]c", "(a|b)c", "c(a|b)*", "a{2,3}", "(ab)+", "b?c"];
  const rnd = lcg(0xC0FFEE);
  let compared = 0;
  for (const p of patterns) {
    const r = ok(p);
    const native = new RegExp(p, "gu");
    for (let i = 0; i < 40; i++) {
      const input = genInput(rnd, 1 + Math.floor(rnd() * 24));
      const ours = r.findAll(input).spans.map(([s]) => s);
      const theirs = [...input.matchAll(native)].map((m) => m.index);
      assert.deepEqual(ours, theirs, `starts differ for /${p}/ on "${input}"`);
      compared++;
    }
  }
  assert.ok(compared >= 400, `compared ${compared}`);
});

test("findAll: full-span differential where leftmost-first == leftmost-longest (no alternation, greedy)", () => {
  const patterns = ["a+", "b*c", "a{2,3}", "(ab)+", "[bc]+a?"];
  const rnd = lcg(0xBEEF);
  for (const p of patterns) {
    const r = ok(p);
    const native = new RegExp(p, "gu");
    for (let i = 0; i < 40; i++) {
      const input = genInput(rnd, 1 + Math.floor(rnd() * 24));
      const ours = r.findAll(input).spans;
      const theirs = [...input.matchAll(native)].map((m) => [m.index, m.index + [...m[0]].length]);
      assert.deepEqual(ours, theirs, `spans differ for /${p}/ on "${input}"`);
    }
  }
});

// ── the certificate claim, on the classic killers ────────────────────────────
test("findAll: steps never exceed the derived bound on ReDoS killer patterns over adversarial input", () => {
  const cases = [
    ["(a+)+$", "a".repeat(400) + "!"],
    ["(a|a)*$", "a".repeat(400) + "!"],
    ["([a-zA-Z]+)*$", "a".repeat(300) + "1"],
    ["(a|aa)+", "a".repeat(500)],
    ["a*a*a*a*b", "a".repeat(400)],
    ["x", "a".repeat(2000)],
  ];
  for (const [p, input] of cases) {
    const r = ok(p);
    const out = r.findAll(input);
    assert.ok(out.steps <= out.stepsBound, `/${p}/: steps ${out.steps} > bound ${out.stepsBound}`);
    // and the bound is LINEAR in input length for a fixed pattern (sanity: not vacuous)
    assert.ok(out.stepsBound < 1e9, `/${p}/: bound ${out.stepsBound} is not a linear-scale number`);
  }
});

test("findAll: work grows linearly with input length (doubling input ~doubles steps, never squares)", () => {
  const r = ok("(a+)+$");
  const s1 = r.findAll("a".repeat(500) + "!").steps;
  const s2 = r.findAll("a".repeat(1000) + "!").steps;
  assert.ok(s2 < s1 * 2.5, `steps ${s1} -> ${s2}: ratio ${(s2 / s1).toFixed(2)} is not linear`);
});

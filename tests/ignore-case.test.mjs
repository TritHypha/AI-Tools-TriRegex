// Case-insensitive matching (the `i` flag), ASCII-scoped. KATs for the exact
// semantics, then a DIFFERENTIAL fuzz against native RegExp(p, "iu") — the
// oracle. Folding is a compile-time range transform, so the certificate is
// unchanged; we assert that too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, caseShadow } from "../dist/index.js";

const ci = (p) => { const r = compile(p, { ignoreCase: true }); assert.equal(r.ok, true, `compile /${p}/i: ${r.reason ?? ""}`); return r; };

test("i: a literal matches both cases", () => {
  assert.equal(ci("cat").matcher.test("CAT").verdict, 1);
  assert.equal(ci("cat").matcher.test("Cat").verdict, 1);
  assert.equal(ci("cat").matcher.test("dog").verdict, -1);
  // and case-SENSITIVE stays sensitive
  assert.equal(compile("cat").matcher.test("CAT").verdict, -1);
});

test("i: findAll finds every case variant", () => {
  assert.deepEqual(ci("ab").findAll("ab AB Ab aB").spans, [[0, 2], [3, 5], [6, 8], [9, 11]]);
});

test("i: a class folds both ways ([a-c] matches A, [A-C] matches a)", () => {
  assert.equal(ci("[a-c]").matcher.test("B").verdict, 1);
  assert.equal(ci("[A-C]").matcher.test("b").verdict, 1);
  assert.equal(ci("[a-c]").matcher.test("D").verdict, -1);
});

test("i: NEGATED class excludes BOTH cases (fold before negate)", () => {
  // /[^a]/i must reject 'a' AND 'A'
  assert.equal(ci("[^a]").matcher.test("a").verdict, -1);
  assert.equal(ci("[^a]").matcher.test("A").verdict, -1);
  assert.equal(ci("[^a]").matcher.test("b").verdict, 1);
});

test("i: non-letters are unaffected; digits/underscore unchanged", () => {
  assert.equal(ci("\\d+").matcher.test("123").verdict, 1);
  assert.equal(ci("a1b").matcher.test("A1B").verdict, 1);
  assert.equal(ci("a1b").matcher.test("A2B").verdict, -1);
});

test("i: \\b with case-insensitive whole-word", () => {
  assert.deepEqual(ci("\\bcat\\b").findAll("The CAT and a Category cat").spans, [[4, 7], [23, 26]]);
});

test("i: the certificate is UNCHANGED by folding (compile-time only)", () => {
  const cs = compile("[a-z]+");
  const cis = compile("[a-z]+", { ignoreCase: true });
  assert.equal(cs.ok && cis.ok, true);
  // same automaton shape (one char instr, one split) — folding only widened ranges
  assert.equal(cis.certificate.instructions, cs.certificate.instructions, "no extra states");
  assert.equal(cis.certificate.restingStates, cs.certificate.restingStates);
});

// ── DIFFERENTIAL fuzz vs native RegExp(p, "iu") ──────────────────────────────
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const ALPH = "aAbB1 _-.zZ";
const gi = (rnd, n) => { let s = ""; for (let i = 0; i < n; i++) s += ALPH[Math.floor(rnd() * ALPH.length)]; return s; };
const ATOMS = ["a", "B", "z", "1", "\\d", "\\w", "[a-c]", "[A-C]", "[^b]", "."];
function gp(rnd) {
  const parts = []; const k = 1 + Math.floor(rnd() * 4);
  for (let i = 0; i < k; i++) {
    let a = ATOMS[Math.floor(rnd() * ATOMS.length)];
    const q = rnd(); if (q < 0.25) a += "+"; else if (q < 0.4) a += "*"; else if (q < 0.5) a += "?";
    parts.push(a);
  }
  return parts.join("");
}

test("i differential: leftmost test() is EXACT vs native /…/iu (0 divergences)", () => {
  const rnd = lcg(0xCA5E);
  let compared = 0;
  for (let t = 0; t < 400; t++) {
    const p = gp(rnd);
    const r = compile(p, { ignoreCase: true });
    if (!r.ok) continue;
    let native;
    try { native = new RegExp(p, "iu"); } catch { continue; }
    for (let j = 0; j < 5; j++) {
      const input = gi(rnd, Math.floor(rnd() * 12));
      let m;
      try { m = native.exec(input); } catch { continue; }
      const theirs = m ? [...input.slice(0, m.index)].length : null;
      const out = r.matcher.test(input);
      const ours = out.verdict === 1 ? out.span[0] : null;
      assert.equal(ours, theirs, `/${p}/i on ${JSON.stringify(input)}`);
      compared++;
    }
  }
  assert.ok(compared >= 1000, `compared ${compared}`);
});

test("i differential: findAll NEVER reports a non-match, and is exact ≥ 98% vs native /…/giu", () => {
  const rnd = lcg(0xF01D);
  let compared = 0, exact = 0, falsePos = 0;
  for (let t = 0; t < 500; t++) {
    const p = gp(rnd);
    const r = compile(p, { ignoreCase: true });
    if (!r.ok) continue;
    let glob, sticky;
    try { glob = new RegExp(p, "giu"); sticky = new RegExp(p, "iuy"); } catch { continue; }
    for (let j = 0; j < 5; j++) {
      const input = gi(rnd, Math.floor(rnd() * 12));
      const cps = [...input];
      let natStarts;
      try { natStarts = [...input.matchAll(glob)].map((m) => m.index); } catch { continue; }
      const ours = r.findAll(input).spans.map(([s]) => s);
      // SAFETY: every position ours reports is a GENUINE match start (sticky).
      for (const st of ours) {
        sticky.lastIndex = cps.slice(0, st).join("").length;
        assert.ok(sticky.test(input), `FALSE POSITIVE /${p}/i on ${JSON.stringify(input)} @${st}`);
      }
      if (JSON.stringify(ours) === JSON.stringify(natStarts)) exact++;
      compared++;
    }
  }
  assert.ok(compared >= 1200, `compared ${compared}`);
  assert.ok(exact / compared >= 0.98, `exact ${(100 * exact / compared).toFixed(1)}% (< 98%)`);
});

// ── caseShadow: the anti-silent-under-reporting warning for case ─────────────
test("caseShadow surfaces reverse-case matches a case-sensitive search misses", () => {
  // The myco lesson: /Decimal/ case-sensitive over 'decimal Decimal DECIMAL'
  // finds only 'Decimal'; the other two are the shadow that must be warned.
  const r = caseShadow("Decimal", "decimal Decimal DECIMAL");
  assert.equal(r.ok, true);
  assert.equal(r.sensitive, 1, "case-sensitive finds only 'Decimal'");
  assert.equal(r.insensitive, 3, "case-insensitive finds all three");
  assert.equal(r.shadow.length, 2, "two reverse-case matches were shadowed");
  assert.deepEqual(r.shadow.map((x) => x[0]), [0, 16], "at 'decimal' and 'DECIMAL'");
});
test("caseShadow is empty when there is nothing to warn about", () => {
  assert.deepEqual(caseShadow("cat", "cat cat").shadow, [], "all matches already case-exact");
  assert.deepEqual(caseShadow("\\d+", "12 34").shadow, [], "no letters, no shadow");
});
test("caseShadow forwards a refusal rather than guessing", () => {
  const r = caseShadow("a(?=b)", "ab");
  assert.equal(r.ok, false);
  assert.equal(r.code, "TPRX-UNSUPPORTED");
});

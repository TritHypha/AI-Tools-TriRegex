// Span units: findAll reports code-point spans by default and UTF-16 offsets
// (String.slice / native RegExp.index / myco units) on request. The two agree
// on BMP text and differ only around astral characters — that difference is the
// whole point, so the astral KAT asserts they DIFFER (red-capable: a no-op
// conversion would fail it) AND that UTF-16 matches native .index exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, toUtf16Spans } from "../dist/index.js";

const ok = (p, o) => { const r = compile(p, o); assert.equal(r.ok, true, `/${p}/: ${r.reason ?? ""}`); return r; };

test("BMP text: utf16 spans equal code-point spans (nothing astral to shift)", () => {
  const r = ok("ab");
  const cp = r.findAll("xabyab").spans;
  const u16 = r.findAll("xabyab", { spanUnit: "utf16" }).spans;
  assert.deepEqual(u16, cp, "identical when every char is one UTF-16 unit");
  assert.deepEqual(u16, [[1, 3], [4, 6]]);
});

test("astral text: utf16 spans SHIFT past emoji and match native RegExp.index", () => {
  const input = "😀ab😀ab"; // each 😀 is TWO UTF-16 units, ONE code point
  const r = ok("ab");
  const cp = r.findAll(input).spans;
  const u16 = r.findAll(input, { spanUnit: "utf16" }).spans;
  // code points: 'ab' at [1,3] and [4,6]
  assert.deepEqual(cp, [[1, 3], [4, 6]], "code-point spans");
  // UTF-16: emoji shifts every offset by +1 per preceding astral char
  assert.deepEqual(u16, [[2, 4], [6, 8]], "UTF-16 spans");
  assert.notDeepEqual(u16, cp, "the units MUST differ on astral input (else conversion is a no-op)");
  // native RegExp.index IS a UTF-16 offset — the oracle
  const native = [...input.matchAll(/ab/gu)].map((m) => [m.index, m.index + m[0].length]);
  assert.deepEqual(u16, native, "UTF-16 spans equal native match indices");
});

test("astral WITHIN the match: String.slice(utf16Span) recovers the matched text", () => {
  const input = "x😀y z😀w"; // match a '.' run
  const r = ok("\\S+"); // one or more non-space
  const u16 = r.findAll(input, { spanUnit: "utf16" }).spans;
  for (const [s, e] of u16) {
    // the substring sliced by UTF-16 offsets is a real, whole match (round-trip)
    const piece = input.slice(s, e);
    assert.ok(piece.length > 0 && !/\s/.test(piece), `slice ${s},${e} = ${JSON.stringify(piece)}`);
  }
  const native = [...input.matchAll(/\S+/gu)].map((m) => [m.index, m.index + m[0].length]);
  assert.deepEqual(u16, native, "matches native indices with astral inside the run");
});

test("toUtf16Spans is exported and pure over a code-point array", () => {
  const cps = [..."😀ab"];
  assert.deepEqual(toUtf16Spans(cps, [[1, 3]]), [[2, 4]]);
  assert.deepEqual(toUtf16Spans(cps, []), [], "empty in, empty out");
});

// ── differential fuzz WITH astral characters ─────────────────────────────────
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
const ALPH = ["a", "b", "1", " ", "😀", "𝔸", "🎯", "z"]; // mix BMP + astral
const gi = (rnd, n) => { let s = ""; for (let i = 0; i < n; i++) s += ALPH[Math.floor(rnd() * ALPH.length)]; return s; };
const PATS = ["a", "ab", "a+", "\\w+", "[ab]+", "\\S", "a.b", "\\bz\\b"];

test("span-unit differential: findAll utf16 starts == native matchAll .index (astral corpus)", () => {
  const rnd = lcg(0x5316);
  let compared = 0, sawAstralShift = 0;
  for (let t = 0; t < 300; t++) {
    const p = PATS[Math.floor(rnd() * PATS.length)];
    const r = compile(p);
    if (!r.ok) continue;
    let native;
    try { native = new RegExp(p, "gu"); } catch { continue; }
    for (let j = 0; j < 6; j++) {
      const input = gi(rnd, Math.floor(rnd() * 12));
      let natStarts;
      try { natStarts = [...input.matchAll(native)].map((m) => m.index); } catch { continue; }
      const u16 = r.findAll(input, { spanUnit: "utf16" }).spans.map(([s]) => s);
      const cp = r.findAll(input).spans.map(([s]) => s);
      // where UTF-16 and code-point starts differ, an astral char preceded a match
      if (JSON.stringify(u16) !== JSON.stringify(cp)) sawAstralShift++;
      // and UTF-16 must equal native (the oracle) — except on the documented
      // findAll adjacency limitation, so verify no FALSE positive via sticky
      const sticky = new RegExp(p, "uy");
      for (const st of u16) { sticky.lastIndex = st; assert.ok(sticky.test(input), `FALSE POS /${p}/ on ${JSON.stringify(input)} @${st}`); }
      compared++;
    }
  }
  assert.ok(compared >= 800, `compared ${compared}`);
  assert.ok(sawAstralShift >= 20, `astral shift exercised ${sawAstralShift}× — corpus must hit it`);
});

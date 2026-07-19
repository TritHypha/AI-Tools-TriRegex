// Streaming: no-rewind, chunk-split invariance, ternary verdicts mid-stream,
// and the K3 fail-closed collapse (indeterminate → refuse) at end-of-stream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../dist/index.js";

const CASES = [
  ["abc", "xxabcy"],
  ["a+b", "aaab"],
  ["^ab$", "ab"],
  ["^ab$", "abx"],
  ["(cat|dog)+", "catdogcat"],
  ["[a-c]{2,4}$", "zabc"],
  ["a$", "za"],
  ["a*", "bbb"],
  ["\u{1F600}.", "x\u{1F600}y"],
];

test("chunk-split invariance: every 2-way split equals the whole-input verdict+span", () => {
  for (const [p, input] of CASES) {
    const c = compile(p);
    assert.equal(c.ok, true, p);
    const whole = c.matcher.test(input);
    const cps = [...input];
    for (let k = 0; k <= cps.length; k++) {
      const s = c.matcher.stream();
      s.feed(cps.slice(0, k).join(""));
      s.feed(cps.slice(k).join(""));
      const out = s.end();
      assert.equal(out.verdict, whole.verdict, `${p} @split ${k}`);
      assert.deepEqual(out.span, whole.span, `${p} span @split ${k}`);
    }
    // one 3-way split for good measure (deterministic)
    const a = Math.floor(cps.length / 3);
    const b = Math.floor((2 * cps.length) / 3);
    const s3 = c.matcher.stream();
    s3.feed(cps.slice(0, a).join(""));
    s3.feed(cps.slice(a, b).join(""));
    s3.feed(cps.slice(b).join(""));
    assert.equal(s3.end().verdict, whole.verdict, `${p} 3-way`);
  }
});

test("mid-stream ternary verdicts + the latch", () => {
  const c = compile("abc");
  assert.equal(c.ok, true);
  const s = c.matcher.stream();
  assert.equal(s.feed("a"), 0, "indeterminate");
  assert.equal(s.feed("b"), 0, "still indeterminate");
  assert.equal(s.feed("c"), 1, "proven — latched");
  assert.equal(s.feed("zzz"), 1, "stays latched");
  assert.deepEqual([...s.end().span], [0, 3]);
});

test("K3 collapse at the boundary: indeterminate ends as refuse", () => {
  const c = compile("abc");
  const s = c.matcher.stream();
  assert.equal(s.feed("ab"), 0);
  assert.equal(s.end().verdict, -1, "0 collapses to -1 at end — never acted on as success");
});

test("anchored impossibility is proven MID-stream (-1 before end)", () => {
  const c = compile("^abc");
  const s = c.matcher.stream();
  assert.equal(s.feed("x"), -1, "no thread survives and no fresh starts exist");
});

test("eol patterns stay indeterminate until the boundary", () => {
  const c = compile("ab$");
  const s = c.matcher.stream();
  assert.equal(s.feed("ab"), 0, "cannot know end-of-input yet");
  assert.equal(s.end().verdict, 1);
  const s2 = c.matcher.stream();
  s2.feed("abc");
  assert.equal(s2.end().verdict, -1);
});

test("uniformScan mode: identical verdicts and spans", () => {
  for (const [p, input] of CASES) {
    const a = compile(p);
    const b = compile(p, { uniformScan: true });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    const ra = a.matcher.test(input);
    const rb = b.matcher.test(input);
    assert.equal(rb.verdict, ra.verdict, p);
    assert.deepEqual(rb.span, ra.span, p);
  }
});

test("long stream in many small chunks: bounded state, no rewind needed", () => {
  const c = compile("needle$");
  assert.equal(c.ok, true);
  const s = c.matcher.stream();
  for (let i = 0; i < 500; i++) s.feed("hay");
  s.feed("needle");
  const out = s.end();
  assert.equal(out.verdict, 1);
  assert.deepEqual([...out.span], [1500, 1506]);
  assert.ok(s.stats().maxActive <= c.certificate.restingStates);
});

# TriRegex

**Ternary streaming pattern matching — ReDoS-immune by construction.**

A non-backtracking pattern-matching engine with three-valued verdicts and a
compile-time **cost certificate**. Instead of hoping a pattern is safe, the
compiler either **certifies** its worst-case per-character work bound up front,
or **refuses** it (`SECURITY_VETO`) — an unsafe or unsupported pattern is never
run slowly; it is not run at all.

Provenance: the defensive publication *"Provisional trit streaming automata —
no-rewind pattern matching"* (dp-rd-0459). Zero runtime dependencies.

## The three verdicts (Kleene K3 discipline)

| Verdict | Meaning |
|---|---|
| `+1` **MATCH** | a match is proven (latched; span reported) |
| `0` **INDETERMINATE** | streaming only — not yet decidable with the input seen so far |
| `-1` **SECURITY_VETO / NO-MATCH** | refused at compile, or proven absent at run time |

`end()` **collapses** `0` fail-closed: a stream that ends undecided is `-1`,
never treated as success. Anchored impossibility is proven *mid*-stream (`-1`
before end when no thread can ever match).

## Why it cannot ReDoS

The classic killers — `(a+)+$`, `(a|a)*$`, `([a-zA-Z]+)*$` — are *linear* here:

- Thompson NFA, **no backtracking, no rewind**: each code point is examined once.
- All quantifiers expand **bounded** at compile (`{n,m}` capped; over-budget →
  veto). Automaton size is fixed before any input runs.
- Epsilon reachability and end-boundary resolution are precomputed. Runtime work
  consists of bounded active-slot tests, range comparisons, bitset unions and
  leftmost-start propagation.
- The certificate's `perCharWorkBound` and `boundaryWorkBound` cover those
  operations and are asserted against the engine's counters on adversarial input.

```js
import { compile } from "triregex";

const r = compile("(a+)+$");            // a certified compile, or a veto value
if (!r.ok) throw new Error(r.reason);   // never throws on pattern content itself
r.certificate;                          // { instructions, restingStates, perCharWorkBound, … }

r.matcher.test("aaaa!").verdict;        // -1 — instantly, linearly

const s = r.matcher.stream();           // no-rewind streaming
s.feed("chunk1");                       // 0 (indeterminate) | 1 | -1
s.end();                                // { verdict: 1 | -1, span? } — 0 has collapsed

const all = r.findAll("aa aa aa!");     // every non-overlapping leftmost-longest match
all.spans;                              // [[0,2],[3,5],[6,8]] in code points, one forward pass
all.steps <= all.stepsBound;            // always true — the derived bound, in every mode
all.truncated;                          // maxMatches reached before end-of-input (never silent)

const ci = compile("cat", { ignoreCase: true }); // ASCII case-insensitive (the `i` flag)
ci.matcher.test("CAT").verdict;         // 1

import { caseShadow } from "triregex";
caseShadow("Decimal", "decimal Decimal DECIMAL").shadow;
                                        // [[0,7],[16,23]] — the reverse-case matches a
                                        // case-SENSITIVE search misses. Warn on these.

r.findAll("😀ab", { spanUnit: "utf16" }).spans; // [[2,4]] — UTF-16 offsets for
                                        // String.slice / RegExp.index / myco (default: code points)
```

### `findAll` — certified, single pass

`findAll` is not "run `test()` on each suffix": that design was measured and rejected
(uncounted O(N) suffix copies per round, and under `uniformScan` every round rescanned
its whole suffix — O(N²), the linear bound violated). It is one forward scan of the
engine's own certified step that **resumes** at each match end, holding at most two
candidates (the leftmost-longest match, and the best candidate that already clears its
end — whose existence proves the first final). Bound, derived not asserted:

```
steps ≤ N · perCharWorkBound + (segments + 1) · boundaryWorkBound
```

Semantics: non-overlapping, leftmost-longest, input order; an empty match advances one
code point (the `matchAll` / RE2 rule); `^`-anchored patterns match at most once, at
true position 0; `maxMatches` fail-closes via `truncated: true`. Start positions are
differentially tested against native `RegExp.matchAll` on a generated corpus (span *ends*
differ by policy where alternation order matters — native is leftmost-first).

### Word boundaries and the one honest limitation

`\b`/`\B` are supported everywhere the engine matches. **Leftmost `test()` is exact** —
0 divergences from native over 10,000 fuzz cases. `findAll` **never invents a match**:
its results are always a *subsequence* of native's (verified: 0 subsequence violations over
12,000 fuzz cases). The single documented limitation: when a quantifier sits directly
adjacent to a boundary (e.g. `.*\B`, `\d?.\B1+`), `findAll` may *omit* an overlapping
adjacent match native emits (~1.3% of adversarial cases) — an artefact of the
single-start-per-slot certified design, never a wrong or spurious match. Whole-word
patterns (`\bword\b`, `foo\b`) are exact.

## Supported subset (v0.1)

Literals · concatenation · alternation `|` · groups `( )` `(?: )` · classes
`[a-z]` `[^…]` with ranges and class escapes · `.` (not `\n`) · anchors `^ $` ·
**word boundaries `\b` `\B`** (ASCII `\w`; resolved per-position, still no-rewind) ·
quantifiers `* + ? {n} {n,} {n,m}` (bounded) · escapes `\d \D \w \W \s \S \n \r
\t \f \v \0 \xHH \uHHHH \u{…}` and punctuation escapes · Unicode by **code
point** (astral-safe; spans count code points). Inside a class, `[\b]` is
backspace (U+0008), matching JS.

**Refused by design** (compile-time `SECURITY_VETO`, named reason — never a
silent literal, never a slow path): backreferences (`\1`, `\k<…>`) ·
lookaround (`(?=` `(?!` `(?<=` `(?<!`) · named groups · inline flags ·
lazy/possessive/stacked quantifier suffixes (`a+?`, `a++`, `a**`) · a quantifier
on an anchor (`\b*`, `^*`) · unknown alpha escapes · any pattern whose expanded
automaton exceeds the budget.

## Honest bounds

- **Spans** are leftmost-longest (earliest start; longest end at that start).
  `test()` reports the first; `findAll` reports every non-overlapping one. No
  capture groups yet.
- **Shorthand classes** (`\d \w \s`) are ASCII-scoped in v0.1.
- **`uniformScan`** disables the early exit only — it *reduces* data-dependent
  control flow; it is **not** a constant-time guarantee (JS/JIT gives none), and
  a dense fixed-shape scan is a declared v0.2 item.
- Class membership comparisons and leftmost-start propagation are included in
  the certified work-unit bound.
- Budget overrides are runtime-validated as finite safe integers; `NaN`,
  infinity, fractions and invalid negative values cannot disable a limit.
- `end()` is idempotent. `feed()` after `end()` throws the named
  `TPRX-STREAM` lifecycle error rather than silently accepting unchecked suffix
  data.
- The engine matches; it does not replace a parser. Balanced/nested syntax
  (`Array<Array<Int>>`) is not a regular language — pair TriRegex with a
  depth-tracking scanner for that (the same discipline this package's own
  pattern parser uses).

## Licence & contact

Apache-2.0 · TritHypha · hello@trithypha.dev

`LICENSE` carries the full Apache-2.0 text (drift-gated by
`tests/license.test.mjs`). Registry publication itself remains owner-gated.

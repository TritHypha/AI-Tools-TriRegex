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
```

## Supported subset (v0.1)

Literals · concatenation · alternation `|` · groups `( )` `(?: )` · classes
`[a-z]` `[^…]` with ranges and class escapes · `.` (not `\n`) · anchors `^ $` ·
quantifiers `* + ? {n} {n,} {n,m}` (bounded) · escapes `\d \D \w \W \s \S \n \r
\t \f \v \0 \xHH \uHHHH \u{…}` and punctuation escapes · Unicode by **code
point** (astral-safe; spans count code points).

**Refused by design** (compile-time `SECURITY_VETO`, named reason — never a
silent literal, never a slow path): backreferences (`\1`, `\k<…>`) ·
lookaround (`(?=` `(?!` `(?<=` `(?<!`) · named groups · inline flags ·
`\b \B` (declared v0.2 candidate) · lazy/possessive/stacked quantifier suffixes
(`a+?`, `a++`, `a**`) · unknown alpha escapes · any pattern whose expanded
automaton exceeds the budget.

## Honest bounds

- **Spans** are leftmost-longest (earliest start; longest end at that start) —
  first match only; no capture groups in v0.1.
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

The current `LICENSE` file is still marked with a pre-publication requirement
to inline the full Apache-2.0 text. Registry publication remains BLOCKED until
that packaging item is closed.

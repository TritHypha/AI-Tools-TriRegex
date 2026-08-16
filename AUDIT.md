# TriRegex v0.1.1 — build audit

Audit updated 2026-07-28. Scope: supply chain, fail-closed
surfaces, bound enforcement, test evidence, declared gaps.

## Supply chain
- **Zero runtime dependencies.** devDependencies only: `typescript`, `@types/node`.
- No network, filesystem, process, or environment access anywhere in `src/`
  (pure computation; the only `node:` imports are in tests).
- No `Date.now` / `Math.random` / locale-dependent calls — fully deterministic;
  identical inputs give identical verdicts, spans, and step counts.

## Fail-closed surfaces (verified by tests)
- `compile()` **never throws on pattern content** — every refusal is a value
  `{ok:false, verdict:-1, code, reason}` (`test/refusals.test.mjs`, incl. a
  hostile-pattern corpus).
- Refusal completeness: backreferences, lookaround, named groups, `\b/\B`,
  unknown alpha escapes, malformed syntax, and **all budget bounds**
  (pattern length, repetition cap, expanded-instruction cap) each have a
  named test. Unknown constructs are refused, never guessed at.
- Streaming `end()` collapses INDETERMINATE to `-1` (K3 collapse-at-boundary,
  `test/streaming.test.mjs`).
- Runtime budget overrides are validated as finite safe integers. `NaN`,
  infinity, fractions and invalid negative values cannot bypass a limit.
- Lazy, possessive and stacked quantifier spellings are refused. They were
  previously reinterpreted as nested repetition (`a+?` could match empty).
- The terminal MATCH instruction now counts toward `maxInstructions`.

## Bound enforcement (the ReDoS claim, evidenced)
- The certificate (`instructions`, `restingStates`, `perCharWorkBound`,
  `boundaryWorkBound`, `maxRangeComparisons`) is
  produced **before** any input runs; the engine counts its own work in the
  same unit and the suite asserts
  `steps ≤ chars × perCharWorkBound + boundaryWorkBound` on classic killer
  patterns over adversarial input (`tests/redos.test.mjs`). The bound now
  includes active-slot tests, range comparisons, bitset unions, start
  propagation and stream-boundary scans.
- EOL resolution and fresh end matches are precomputed, rather than performing
  uncounted epsilon walks during `end()`.
- Quantifier expansion is budget-checked **during** emission — an over-budget
  pattern aborts as a veto mid-compile; it cannot escape into a big automaton.

## Correctness evidence
- 34/34 tests green: semantics (literals/alt/classes/anchors/quantifiers/
  epsilon-loop termination/astral Unicode/escapes), leftmost-longest spans,
  chunk-split invariance at **every** split point per case, mid-stream verdict
  transitions, anchored mid-stream impossibility, eol-until-boundary, uniform
  mode equivalence, version-drift (VERSION === package.json).
- A deterministic generated corpus compares the supported language-membership
  intersection against native Unicode `RegExp`; span policy is deliberately not
  compared because TriRegex is leftmost-longest.
- Stream lifecycle tests establish idempotent `end()` and refusal of
  `feed()` after the boundary.
- `test()` is literally `stream(feed all) + end()` — whole-vs-chunked
  equivalence holds **by construction**, not by luck.

## findAll (v0.2 — the myco-backend gap, closed for enumeration)
- Single forward pass, resume-at-match-end, two-slot finality (held match +
  next-segment candidate). Bound `steps ≤ N·perChar + (segments+1)·boundary`
  asserted in BOTH scan modes on the classic killers over adversarial input.
- The rejected first design (test() per suffix) is recorded in
  `src/find-all.ts`'s header with the measured violation (N=2000 uniformScan:
  2,013,003 steps vs a 30,003 bound) so nobody rebuilds it.
- 400-case start-position differential vs native `RegExp.matchAll` on a
  deterministic corpus; full-span differential where the two policies coincide.
- Remaining before myco can switch backends: smart-case, `\b`, span-unit
  alignment (myco spans are UTF-16 offsets; TriRegex spans are code points).

## Word boundaries (v0.3 — the myco-backend gap, closed)
- `\b`/`\B` (ASCII `\w`) parked as resting assertion states, resolved per-position
  from one register of lookbehind (`isWord(prev) XOR isWord(next)`). Non-backtracking,
  no rewind; the certificate gains a bounded `assertResolveBound` (a fixpoint over
  assertion slots with a resolved-this-step cycle guard) — ReDoS immunity preserved
  and asserted on `\b(a+)+\b`-style killers.
- Leftmost `test()`: EXACT vs native over 10k fuzz cases (0 divergences).
- `findAll`: ours ⊆ native always (0 subsequence violations / 12k cases) — never a
  wrong or spurious match. **Known limitation**: a quantifier directly adjacent to a
  boundary (`.*\B`, `\d?.\B1+`) may omit an overlapping adjacent match native emits
  (~1.3% of adversarial cases); the single-start-per-slot artefact of the certified
  linear design (multi-start tracking would break the O(N) bound). Whole-word patterns
  are exact. Pinned by `tests/word-boundary.test.mjs` (KATs + two differential fuzzers).
- **Span-unit alignment DONE (v0.5):** `findAll(input, { spanUnit: "utf16" })`
  reports UTF-16 offsets (myco / native `RegExp.index` units); default stays code
  points. Verified vs native `.index` over an astral-mixed corpus. All named
  myco-backend gaps are now closed — an actual backend swap is a myco-side
  change (its call sites), not a TriRegex gap.

## Case-insensitive + caseShadow (v0.4)
- `ignoreCase` folds ranges at compile time (A-Z ↔ a-z), BEFORE class negation so
  `/[^a]/i` excludes both cases. No match-time cost, certificate unchanged.
- `test()` EXACT vs native `/…/iu` (0 divergences / 10k). `findAll` 0 false
  positives / 15k, exact ≥ 99.8%.
- `caseShadow(pattern, input)` reports reverse-case matches a case-sensitive search
  misses — the anti-silent-under-reporting warning (the myco case false-negative).

## Declared gaps (honest, not hidden)
- No capture groups; `test()` span is the first leftmost-longest match only.
- `\b/\B` refused (v0.2 candidate: needs one code point of lookbehind state —
  compatible with the no-rewind design).
- ASCII shorthand classes; no case-insensitive mode; no multiline `^$` mode.
- `uniformScan` is early-exit-off only; a dense constant-shape scan (true
  data-oblivious stepping) is design-stage v0.2. No constant-time claim is
  made for JS.
- One engine path (sparse bitset). Performance is untuned and **no performance
  numbers are claimed** (house rule: measured on a named machine or not at all).
- `memoryBoundBytes` is a portable accounting estimate, not a JavaScript heap
  ceiling; runtime object overhead is engine-specific.
- ~~Publication is BLOCKED until `LICENSE` contains the full Apache-2.0 text.~~
  Closed 2026-08-14: full text inlined (byte-copied from the house canonical, copyright
  line re-attributed to TriRegex, pure ASCII) and drift-gated by `tests/license.test.mjs`.
  Publication itself stays owner-gated.

## Distribution rule (owner directive, 2026-07-19)
The Galerina main session must **not** consume this working copy. Galerina
receives its **own vendored copy** in the Galerina package library
(`packages-galerina/`), copied at a pinned commit and re-tested there. This
directory remains the R&D-editable original (the myco pattern).

Contact hello@trithypha.dev · Apache-2.0.

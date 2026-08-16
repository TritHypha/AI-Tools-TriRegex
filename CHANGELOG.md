# Changelog

## 0.3.0 — 2026-08-16

### Added

- **Word boundaries `\b` and `\B`** (ASCII `\w`), the declared myco-backend gap.
  Zero-width assertions parked as resting states and resolved per-position from
  one register of lookbehind — still non-backtracking, no rewind, and the ReDoS
  cost certificate is preserved (a bounded fixpoint over assertion slots, with a
  cycle guard for `(a|\b)*`-style zero-width loops). `[\b]` is backspace inside a
  class, matching JS. A quantifier on a bare boundary (`\b*`) is refused, like `^*`.

### Assurance

- Leftmost `test()` is EXACT vs native `RegExp` — 0 divergences over 10,000 fuzz
  cases mixing `\b`/`\B` with quantified atoms.
- `findAll` never invents a match: ours is always a SUBSEQUENCE of native's
  (0 violations over 12,000 fuzz cases). One documented limitation: a quantifier
  directly adjacent to a boundary may omit an overlapping adjacent match (~1.3%
  of adversarial cases) — the single-start-per-slot artefact, never a wrong match.
- Suite 52 → 64.

## 0.2.0 — 2026-08-14

### Added

- `findAll(input, { maxMatches })` on every successful compile: all
  non-overlapping leftmost-longest matches in ONE certified forward pass, with
  a derived work bound `steps ≤ N·perCharWorkBound + (segments+1)·boundaryWorkBound`
  that holds in both scan modes (asserted on the classic ReDoS killers). Empty
  matches advance one code point; `^` matches at most once; `maxMatches`
  fail-closes via `truncated: true`. Start positions differentially tested
  against native `RegExp.matchAll` on a 400-case deterministic corpus.

### Assurance

- The first `findAll` design (`test()` per suffix) was measured and rejected
  before commit: uncounted O(N) suffix copies per round, and under
  `uniformScan` an O(N²) rescan that violated its own bound (N=2000:
  2,013,003 steps vs 30,003). Recorded in the source header.
- `LICENSE` now carries the full Apache-2.0 text, drift-gated by
  `tests/license.test.mjs` (stub / lost APPENDIX / foreign copyright line /
  non-ASCII byte all fail).
- Suite 34 → 52 tests.

## 0.1.1 — 2026-07-28

### Security

- Runtime-validates every budget field so `NaN`, infinity, fractions,
  `undefined`, and invalid negative values cannot disable compiler bounds.
- Counts the terminal MATCH instruction against `maxInstructions`.
- Refuses stacked, lazy and possessive quantifier spellings instead of silently
  changing their language.
- Refuses `feed()` after `end()` so unchecked suffix data cannot cross a closed
  stream boundary; repeated `end()` is stable.

### Assurance

- Extended the cost certificate to include class-range comparisons,
  leftmost-start propagation and one-off boundary work.
- Precomputes EOL and fresh-end reachability; `end()` performs no hidden epsilon
  graph walk.
- Added deterministic supported-subset membership differential tests against
  native Unicode `RegExp`.
- Expanded the suite from 28 to 34 tests.

### Integration

- Recorded that certified `findAll`, smart-case, word boundaries and span-unit
  alignment remain required before TriRegex can replace Myco's regex backend.

## 0.1.0 — 2026-07-19

- Initial non-backtracking streaming matcher and compile-time cost certificate.

# TriRegex v0.1.0 — build audit

Audit of the initial build (2026-07-19). Scope: supply chain, fail-closed
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

## Bound enforcement (the ReDoS claim, evidenced)
- The certificate (`instructions`, `restingStates`, `perCharWorkBound`) is
  produced **before** any input runs; the engine counts its own work in the
  same unit (bitset word-ops) and the suite asserts `steps ≤ (chars+2) ×
  perCharWorkBound` on classic killer patterns over adversarial input
  (`test/redos.test.mjs`), plus a linear-growth check (double input ≤ 2.5×
  steps) and `maxActive ≤ restingStates`.
- Quantifier expansion is budget-checked **during** emission — an over-budget
  pattern aborts as a veto mid-compile; it cannot escape into a big automaton.

## Correctness evidence
- 28/28 tests green: semantics (literals/alt/classes/anchors/quantifiers/
  epsilon-loop termination/astral Unicode/escapes), leftmost-longest spans,
  chunk-split invariance at **every** split point per case, mid-stream verdict
  transitions, anchored mid-stream impossibility, eol-until-boundary, uniform
  mode equivalence, version-drift (VERSION === package.json).
- `test()` is literally `stream(feed all) + end()` — whole-vs-chunked
  equivalence holds **by construction**, not by luck.

## Declared gaps (v0.1 — honest, not hidden)
- No capture groups; span is the first leftmost-longest match only.
- `\b/\B` refused (v0.2 candidate: needs one code point of lookbehind state —
  compatible with the no-rewind design).
- ASCII shorthand classes; no case-insensitive mode; no multiline `^$` mode.
- `uniformScan` is early-exit-off only; a dense constant-shape scan (true
  data-oblivious stepping) is design-stage v0.2. No constant-time claim is
  made for JS.
- One engine path (sparse bitset). Performance is untuned and **no performance
  numbers are claimed** (house rule: measured on a named machine or not at all).

## Distribution rule (owner directive, 2026-07-19)
The Galerina main session must **not** consume this working copy. Galerina
receives its **own vendored copy** in the Galerina package library
(`packages-galerina/`), copied at a pinned commit and re-tested there. This
directory remains the R&D-editable original (the myco pattern).

Contact hello@trithypha.dev · Apache-2.0.

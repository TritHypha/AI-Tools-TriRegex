# TriRegex v0.5.0 audit

Updated 2026-08-26. This is a release-readiness summary, not a security
guarantee or a publication record. It separates confirmed repository evidence
from the limits a consumer must keep in view.

## Confirmed current evidence

### Public API and supply chain

- `compile`, `TriMatcher`, `findAll`, `caseShadow`, the ternary verdict
  constants, types, `DEFAULT_BUDGET`, and `toUtf16Spans` are exported from the
  package entry point.
- The package declares version 0.5.0 and requires Node.js 18 or later.
- The runtime dependency set is empty; the package uses development tooling
  only for build and test work.

### Compilation, bounds, and matching

- `compile()` returns a value refusal for unsupported pattern content,
  malformed input, and exceeded limits; callers can branch on `ok`.
- Budget overrides are checked as finite safe integers before compilation.
- Successful compilation produces a certificate before input is matched. The
  test suite exercises the counted work against its derived bound on
  adversarial inputs.
- The matcher supports whole-input tests and no-rewind streams. A stream's
  `end()` collapses an unresolved verdict to refusal/no-match, is idempotent,
  and a later `feed()` is rejected as a lifecycle error.

### Enumeration and units

- `findAll` reports non-overlapping, leftmost-longest spans in a single forward
  scan, plus measured work, its derived bound, and `truncated`.
- `truncated: true` records that `maxMatches` stopped enumeration. It must not
  be interpreted as an exhaustive no-match result.
- Span offsets default to Unicode code points. `spanUnit: "utf16"` supplies
  offsets intended for APIs such as `String.slice` and `RegExp.index`.

### Case and boundaries

- `ignoreCase` is ASCII-scoped and implemented at compile time. `caseShadow`
  identifies reverse-case matches a case-sensitive search would omit.
- `\b` and `\B` use ASCII word-character semantics. For `findAll`, a quantified
  atom next to a boundary can omit an overlapping adjacent native-style match;
  it does not produce a spurious match. Whole-input leftmost matching is tested
  separately from this enumeration limit.

## Design limits and consumer responsibilities

- The project makes no constant-time claim. `uniformScan` removes a particular
  early exit but does not make JavaScript or its JIT data-oblivious.
- TriRegex is a documented regular-expression subset, not a complete JavaScript
  `RegExp` replacement and not a parser for nested syntax.
- Capture groups, lookaround, backreferences, named groups, inline flags, and
  other unsupported syntax are refused. A caller must choose its own explicit
  policy for that refusal; it must not silently fall back to native `RegExp`.
- The memory figure in a certificate is an accounting bound, not a JavaScript
  heap ceiling.
- Publication, tags, registry access, and GitHub release actions remain
  owner-gated. Passing a local test suite does not publish a package.

## Verification route

Run `npm ci` followed by `npm test` in a clean checkout. The release-specific
document checks live in `tests/public-release.test.mjs`. Consult
[SECURITY.md](SECURITY.md) for coordinated private vulnerability reporting.

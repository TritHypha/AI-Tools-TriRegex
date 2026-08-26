# TriRegex

TriRegex is a small, streaming regular-expression matcher for a documented
subset of JavaScript-style regular-expression syntax. It is Apache-2.0
licensed and currently at version 0.5.0.

## Concept

TriRegex compiles a supported pattern into a Thompson-NFA matcher with a
compile-time work certificate. Matching is no-rewind and reports a ternary
verdict: match (`1`), indeterminate while a stream is open (`0`), or refusal / no
match (`-1`). Unsupported syntax and over-budget patterns return a refusal
value instead of interpreting a different pattern.

## What TriRegex does

- Compiles supported patterns into a matcher and an inspectable cost
  certificate.
- Matches complete strings or chunks from a no-rewind stream.
- Enumerates non-overlapping, leftmost-longest matches with `findAll`.
- Supports optional ASCII-scoped case-insensitive matching and `caseShadow`
  warnings for reverse-case matches a sensitive search misses.
- Validates compile-budget overrides before use.

## Who it is for

Use TriRegex when an application needs a bounded, explicitly supported subset
of regular expressions; needs to process chunks as a stream; or must handle a
refusal as a normal, fail-closed result.

## Why use it

TriRegex has no runtime dependencies. A successful compile supplies its work
certificate before input is processed, and the tests assert the engine's counted
work stays within that certificate on supported patterns. The API makes
unsupported syntax, budget limits, incomplete streams, and capped enumeration
observable rather than quietly changing semantics.

## Install

```sh
npm install triregex
```

TriRegex requires Node.js 18 or later.

## How to use it

Compile first, then branch on `ok`. Pattern content is not thrown as an
exception: a refusal carries a code and reason.

```js
import { compile } from "triregex";

const compiled = compile("cat+");
if (!compiled.ok) {
  throw new Error(`${compiled.code}: ${compiled.reason}`);
}

const outcome = compiled.matcher.test("a cattt naps");
console.log(outcome.verdict, outcome.span); // 1, [2, 6]
console.log(compiled.certificate.perCharWorkBound);
```

Use a stream when the input arrives in pieces. `end()` turns an unresolved `0`
into `-1`; `feed()` after `end()` raises the documented stream-lifecycle error.

```js
const compiled = compile("^order-[0-9]+$");
if (!compiled.ok) throw new Error(compiled.reason);

const stream = compiled.matcher.stream();
stream.feed("order-"); // 0: more input may complete the match
stream.feed("42");
console.log(stream.end()); // { verdict: 1, span: [0, 8] }
```

`findAll` scans once and returns spans, counters, and whether its configured
match cap stopped enumeration. Its default spans are code-point offsets; select
UTF-16 offsets when interoperating with `String.slice` or `RegExp.index`.

```js
const compiled = compile("[a-z]+");
if (!compiled.ok) throw new Error(compiled.reason);

const result = compiled.findAll("go now", { maxMatches: 1, spanUnit: "utf16" });
console.log(result.spans);     // [[0, 2]]
console.log(result.truncated); // true
```

To detect case-sensitive searches that would omit reverse-case occurrences,
use `caseShadow`.

```js
import { caseShadow } from "triregex";

const result = caseShadow("Decimal", "decimal Decimal DECIMAL");
if (result.ok && result.shadow.length > 0) {
  console.warn(`${result.shadow.length} reverse-case matches were omitted`);
}
```

## When to use it

TriRegex is suitable when its supported subset expresses the matching rule and
the caller can make an explicit policy decision for a compile refusal or an
incomplete stream. `findAll(...).truncated === true` means the configured match
cap stopped enumeration; it is not a complete absence result.

## What it is not

TriRegex is not a full JavaScript `RegExp` replacement and does not replace a
parser for nested or balanced syntax. It makes no constant-time guarantee: the
`uniformScan` option only disables the early exit after a latched match. It is
also not a way to accept unsupported syntax through another engine: TriRegex
does not silently retry a refused pattern with native `RegExp`, and callers
must not silently fall back to native `RegExp` after a refusal.

## Supported subset

The v0.5.0 subset includes literals; concatenation; alternation; capturing and
non-capturing groups; character classes and ranges; `.` (except newline);
anchors; ASCII word boundaries; greedy quantifiers; and the documented escape
forms. Unicode input is processed by code point. `ignoreCase: true` folds ASCII
letter ranges at compile time; shorthand classes and word boundaries remain
ASCII-scoped.

The compiler refuses backreferences, lookaround, named groups, inline flags,
lazy, possessive, and stacked quantifier suffixes, quantifiers on anchors,
unknown alphabetic escapes, malformed syntax, and patterns exceeding a configured
budget. Refusal is an API result, not an invitation to use another matcher.

The `findAll` guarantee is deliberately narrower around one edge case:
Boundary-adjacency patterns involving a quantified atom beside `\b` or `\B` may
omit an overlapping adjacent match; they do not create a spurious match.

## Security

Please report suspected vulnerabilities privately; see [SECURITY.md](SECURITY.md).
Do not include credentials, tokens, or production-only data in a report.

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## Release status

Publication is owner-controlled. The release process and local checks are
described in [docs/RELEASING.md](docs/RELEASING.md); this document does not
represent a publication announcement.

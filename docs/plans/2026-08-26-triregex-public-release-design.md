# TriRegex public release design

**Status:** Approved by the owner on 2026-08-26

## Outcome

Prepare TriRegex as a factual, independently reviewable Apache-2.0 release
candidate for JavaScript and TypeScript consumers. The work improves the public
contract, package metadata, security and contribution guidance, continuous
verification, and release evidence without changing the matching language or
publishing the package.

## Product position

TriRegex is a zero-runtime-dependency, non-backtracking pattern matcher for a
documented regular-expression subset. A pattern is compiled into a bounded
automaton and a cost certificate before input is matched. Unsupported,
malformed, or over-budget patterns return a typed refusal value rather than
entering a slower fallback engine.

The package is intended for JavaScript and TypeScript applications, command-line
tools, services, and AI-agent tooling that process untrusted or operationally
sensitive patterns or inputs and can accept an explicit supported subset.

It is useful when callers need one or more of:

- bounded non-backtracking execution;
- incremental no-rewind streaming;
- explicit compile-time refusal;
- leftmost-longest single-match or non-overlapping enumeration;
- code-point or UTF-16 span units;
- a visible incomplete-result marker when `maxMatches` truncates enumeration.

## Public boundaries

The release material must state that TriRegex is not:

- a complete JavaScript `RegExp` replacement;
- a parser for recursive or balanced syntax;
- a capture, replacement, or substitution engine;
- a constant-time implementation;
- a full-Unicode case-folding engine;
- a guarantee against denial-of-service mechanisms outside the documented
  matcher and resource model;
- permission to retry a refused pattern with native `RegExp` silently.

`findAll` has a documented boundary-adjacency limitation: for some patterns
where a quantifier directly touches `\\b` or `\\B`, it may omit an overlapping
adjacent match. It must not invent a match. Callers must distinguish complete,
truncated, refused, and unsupported results rather than treating all of them as
absence.

## Public documentation

The README will use a task-oriented structure:

1. concept;
2. what the package does;
3. intended users and systems;
4. reasons to use it;
5. installation and first use;
6. streaming, enumeration, case and span examples;
7. when it is appropriate;
8. supported syntax and refusals;
9. limitations and non-goals;
10. security, licence, support and release status.

Claims must be traceable to current source or tests. Absolute phrases such as
"ReDoS-immune" will be replaced with the narrower statement that the supported
execution path avoids backtracking and is checked against its reported work
bounds. Fuzz counts and version-specific audit counts must either be current and
mechanically checked or clearly dated evidence.

`AUDIT.md` will be rewritten for version 0.5.0 so that it no longer contradicts
the current support for `findAll`, word boundaries, ASCII case-insensitive
matching, and UTF-16 spans. `SECURITY.md`, `CONTRIBUTING.md`, and
`docs/RELEASING.md` will describe reporting, contribution, and owner-gated
release procedures.

## Package and repository contract

The npm package remains named `triregex` at version `0.5.0` unless a behavioral
change becomes necessary. Metadata will identify the actual canonical
repository, issues page, homepage, declaration entry point, ESM entry point,
Apache-2.0 licence, Node.js floor, and public files.

The canonical repository is:

`https://github.com/TritHypha/AI-Tools-TriRegex`

The security contact is `hello@trithypha.dev`.

Generated `.myco` indexes are discovery artifacts rather than source. The
tracked test index will be removed and `.myco/` directories ignored after a
release test proves the package and test suite do not depend on it.

No new runtime dependency is allowed. Development dependencies remain
lockfile-bound.

## Verification design

A deterministic release checker will verify:

- required public files and headings;
- package identity, licence, repository, support and declaration metadata;
- absence of generated `.myco` content and absolute local path leaks from the
  Git tree and packed artifact;
- build and full test success;
- package dry-run contents and size bounds;
- installation of the produced tarball into a disposable consumer;
- JavaScript import and TypeScript declaration consumption;
- clean repository state when invoked as the final release gate.

The checker will use bounded child processes, bounded captured output, an owned
temporary directory, and cleanup in `finally`. Its tests must demonstrate a
controlled red condition before the implementation is accepted.

CI will run on supported Node.js release lines and execute the same repository
checks. CI is corroborating evidence; local exact-revision verification remains
required before a release claim.

## Custody and publication boundary

Implementation occurs on `codex/triregex-public-release` in an isolated
worktree. Commits are local. This design does not authorize pushing, tagging,
npm publication, GitHub release creation, deployment, or deletion of unrelated
branches or worktrees.

Completion requires:

1. focused controlled-red and green evidence for new release checks;
2. the complete existing test suite;
3. reproducible package and consumer smoke checks;
4. licence, security, path, generated-artifact, and clean-tree checks;
5. a fresh exact-HEAD graph with zero relevant exclusions;
6. a fresh independent review of the committed revision;
7. a clean worktree and an explicit owner integration decision.

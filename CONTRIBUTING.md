# Contributing to TriRegex

## Local setup

TriRegex requires Node.js 18 or later. Install the locked development
dependencies and run the suite before proposing a change:

```sh
npm ci
npm test
```

## Change expectations

- Add or update tests for every behavior change.
- Update public documentation when a public contract changes.
- Do not add a runtime dependency without explicit justification in the change
  discussion and review.
- Preserve explicit refusal behavior. A refused pattern must not silently fall
  back to another regular-expression engine.
- Keep unrelated formatting and generated output out of the change.

## Reporting security issues

Use the private process in [SECURITY.md](SECURITY.md), not a public issue.

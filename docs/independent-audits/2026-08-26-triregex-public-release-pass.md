# TriRegex public-release independent PASS receipt

Date: 2026-08-26

## Exact audited revision

- Repository: TriRegex
- Branch: `codex/triregex-public-release`
- Audited implementation target: `fa14d292649f3a34de115bf0bad0612ea4120d3b`
- Target tree: `02a1517ee962db17993a587fea6024d29eda165d`
- Target parent: `7c99ebf5b765d282fb21e877479d238db220d6ce`
- Review base: `53d214849ba33a0c4e7a0d3939b25fc0a1ef5c50`
- Review report: independent model-diverse exact-revision review of the approved
  public-release design and implementation plan, including source, package,
  controlled-red, LF/CRLF, release-check, and custody evidence.

The cumulative changed set from the review base through the audited target is
exactly:

```text
A .github/workflows/ci.yml
M .gitignore
M AUDIT.md
M CHANGELOG.md
A CONTRIBUTING.md
M LICENSE
M README.md
A SECURITY.md
A docs/RELEASING.md
A docs/plans/2026-08-26-triregex-public-release-design.md
A docs/superpowers/plans/2026-08-26-triregex-public-release.md
M package.json
D tests/.myco/index.json
A tests/public-release.test.mjs
A tests/release-check.test.mjs
A tools/release-check.mjs
```

## Independent review outcome

The initial exact-revision review returned `HOLD` with finding counts
Critical 0 / Important 1 / Minor 0. The repair commit was
`fa14d292649f3a34de115bf0bad0612ea4120d3b`. Its scoped re-review returned
`PASS` with Critical 0 / Important 0 / Minor 0. The prior Important finding was
the public-package `ReDoS-immune by construction` overclaim; the repair removed
that claim from the package metadata, source banner, emitted entry, and packed
bytes, and the repaired test turns red against the parent revision.

## Exact evidence retained by the review

- True-LF materialization: changed-path physical CRLF counts were
  `package.json` 0, `src/index.ts` 0, and `tests/public-release.test.mjs` 0;
  public-release tests 5/5 passed; full tests 151/151 passed; release checker
  `PASS`, 13/13 checks; `npm audit --omit=dev` reported 0 vulnerabilities.
- Physical-CRLF materialization: changed-path physical CRLF counts were
  `package.json` 57, `src/index.ts` 133, and `tests/public-release.test.mjs`
  128; public-release tests 5/5 passed; full tests 151/151 passed; release
  checker `PASS`, 13/13 checks; `npm audit --omit=dev` reported 0
  vulnerabilities.
- Both pack runs contained 18 files. The packed-byte claim scan found 0
  ReDoS/immunity-claim hits and 0 disallowed packed names. The packed claim
  absence was checked independently from source/tree checks.
- Pre-repair graph evidence was retained at project
  `C-Users-phill-Documents-GitHub-subprojects-TriRegex-.worktrees-triregex-public-release`:
  branch head `7c99ebf5b765d282fb21e877479d238db220d6ce`, 306 nodes, and 849
  edges, with targeted resolution of `runReleaseChecks`, `validatePackFiles`,
  and `runBounded`. Graph refresh for this receipt and closure belongs to the
  post-commit closure step; these counts are not asserted as closure-commit
  graph counts.

## Review-report integrity and custody

The ignored reviewer report
`.superpowers/sdd/2026-08-26-triregex-public-release/final-review-report.md`
is 19,250 bytes with SHA-256
`54a32da188abc673bda5a9a4425f72ded7ebf42e81ca002375011516de11e7da`.
Its final scoped section records the PASS and C0/I0/M0 counts above.

At the audited implementation target the branch and worktree were clean.
The independent reviewer edited no target source, tracked file, index, HEAD,
ref, branch, graph, or publication state. This receipt is a separate local
commit and is itself not publication authority.

## Limitations and publication boundary

- Hosted Node 18/20/22 CI was not run or inferred.
- No push, tag, PR, merge, npm publication, GitHub release, deployment, or
  public-registry state check was performed.
- The graph was not refreshed for the repair review; closure requires a fresh
  exact-head graph receipt where the repository process requires one.
- This receipt records evidence for the exact audited revision. It does not
  authorize publication, tagging, merging, pushing, or any other owner action.

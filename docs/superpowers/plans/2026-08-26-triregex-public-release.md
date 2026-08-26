# TriRegex Public Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a factual, locally verified TriRegex 0.5.0 release candidate without publishing it.

**Architecture:** Treat public documentation, npm metadata, generated-artifact hygiene, and the release checker as one fail-closed release contract. Preserve the current matcher API and runtime behavior; add test-backed repository and package gates around the existing implementation.

**Tech Stack:** TypeScript 5.8, ESM Node.js 18+, `node:test`, npm packaging, GitHub Actions.

**Spec:** `docs/plans/2026-08-26-triregex-public-release-design.md`

## Global Constraints

- Keep package name `triregex`, version `0.5.0`, ESM format, and Node.js floor `>=18`.
- Add no runtime dependency and preserve the lockfile-bound development dependencies.
- Use `https://github.com/TritHypha/AI-Tools-TriRegex` as the canonical repository.
- Use `hello@trithypha.dev` as the security contact.
- Keep Apache-2.0 and correct the repository locator in its project notice.
- Do not alter matching syntax, verdicts, certificates, spans, or streaming behavior.
- Do not silently fall back to native `RegExp` after a TriRegex refusal.
- Treat complete, truncated, refused, unsupported, and indeterminate states distinctly.
- Keep generated `.myco` indexes out of the Git tree and npm package.
- Do not push, tag, publish to npm, create a GitHub release, or deploy.

---

### Task 1: Public release contract and documentation

**Files:**
- Create: `tests/public-release.test.mjs`
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`
- Create: `docs/RELEASING.md`
- Modify: `README.md`
- Modify: `AUDIT.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: current `compile`, `matcher`, `findAll`, `caseShadow`, package version, and the approved design.
- Produces: a mechanically checked public narrative and contribution/security/release contract for Tasks 2–4.

- [ ] **Step 1: Write the public-document RED contract**

Create `tests/public-release.test.mjs` with `node:test` cases that read repository files from the test directory's parent and assert:

```js
const REQUIRED_README_HEADINGS = [
  "## Concept",
  "## What TriRegex does",
  "## Who it is for",
  "## Why use it",
  "## Install",
  "## How to use it",
  "## When to use it",
  "## What it is not",
  "## Supported subset",
  "## Security",
];

for (const heading of REQUIRED_README_HEADINGS) {
  assert.ok(readme.includes(heading), `README missing ${heading}`);
}
assert.doesNotMatch(readme, /ReDoS-immune/i);
assert.match(readme, /must not silently fall back to native `RegExp`/i);
assert.match(readme, /truncated/);
assert.match(readme, /boundary-adjacency/i);
```

Also assert that `SECURITY.md`, `CONTRIBUTING.md`, and `docs/RELEASING.md` exist; that security reporting uses `hello@trithypha.dev`; that `AUDIT.md` says version 0.5.0 and does not contain the obsolete claims `34/34`, ``\b/\B` refused`, `no case-insensitive mode`, or `Remaining before myco`; and that none of these public files contains a drive-rooted Windows path.

- [ ] **Step 2: Run the focused contract and verify RED**

Run:

```powershell
node --test tests/public-release.test.mjs
```

Expected: failure because the required files/headings are absent and the audit still contains obsolete statements.

- [ ] **Step 3: Rewrite the README around the approved public contract**

Write concise sections for concept, behavior, audience, reasons, install, compile/test/stream/findAll/caseShadow examples, appropriate use, supported subset, refusals, non-goals, security, licence, and release status. Preserve only claims supported by current source/tests. Include these exact semantic boundaries:

```markdown
- TriRegex does not silently retry a refused pattern with native `RegExp`.
- `findAll(...).truncated === true` means the configured match cap stopped enumeration; it is not a complete absence result.
- Boundary-adjacency patterns involving a quantified atom beside `\b` or `\B` may omit an overlapping adjacent match; they do not create a spurious match.
```

Do not describe the package as universally ReDoS-immune, constant-time, a full JavaScript `RegExp` replacement, or a parser.

- [ ] **Step 4: Add security, contribution, and release guidance**

`SECURITY.md` must provide private reporting to `hello@trithypha.dev`, request affected version/input/impact/reproduction details without secrets, define supported version as the latest released minor line, and forbid public disclosure before coordination.

`CONTRIBUTING.md` must require Node.js 18+, `npm ci`, `npm test`, tests for behavior changes, documentation for public-contract changes, no new runtime dependency without explicit justification, and no silent fallback after refusal.

`docs/RELEASING.md` must describe the local gate, clean-tree requirement, version/changelog check, owner-controlled tag/npm/GitHub publication, and post-publication verification without claiming that publication has happened.

- [ ] **Step 5: Replace the stale audit and update the changelog**

Rewrite `AUDIT.md` for 0.5.0. Separate confirmed current evidence from design limits. Record the current public API, zero runtime dependencies, budget validation, work-bound tests, streaming lifecycle, `findAll` truncation, ASCII-scoped case behavior, span units, known boundary-adjacency limitation, no constant-time claim, and owner-gated publication.

Add an `Unreleased` changelog section containing only release-readiness documentation, metadata, CI, and verification work; do not imply a matcher behavior change.

- [ ] **Step 6: Run focused and full tests and verify GREEN**

Run:

```powershell
node --test tests/public-release.test.mjs
npm test
```

Expected: the focused public contract and all existing tests pass.

- [ ] **Step 7: Inspect and commit Task 1**

Run `git diff --check`, inspect only the seven owned paths above, then commit:

```powershell
git add README.md AUDIT.md CHANGELOG.md SECURITY.md CONTRIBUTING.md docs/RELEASING.md tests/public-release.test.mjs
git commit -m "docs: define the TriRegex public release contract"
```

---

### Task 2: npm metadata and generated-artifact hygiene

**Files:**
- Modify: `tests/public-release.test.mjs`
- Modify: `package.json`
- Modify: `LICENSE`
- Modify: `.gitignore`
- Delete: `tests/.myco/index.json`

**Interfaces:**
- Consumes: Task 1's public contract and current compiled declarations in `dist/index.d.ts`.
- Produces: canonical npm metadata and a Git tree free of generated `.myco` indexes.

- [ ] **Step 1: Extend the contract with package and Git-tree assertions**

Add tests requiring:

```js
assert.equal(pkg.name, "triregex");
assert.equal(pkg.version, "0.5.0");
assert.equal(pkg.type, "module");
assert.equal(pkg.main, "./dist/index.js");
assert.equal(pkg.types, "./dist/index.d.ts");
assert.deepEqual(pkg.repository, {
  type: "git",
  url: "git+https://github.com/TritHypha/AI-Tools-TriRegex.git",
});
assert.equal(pkg.homepage, "https://github.com/TritHypha/AI-Tools-TriRegex#readme");
assert.equal(pkg.bugs.url, "https://github.com/TritHypha/AI-Tools-TriRegex/issues");
assert.deepEqual(pkg.exports["."], {
  types: "./dist/index.d.ts",
  import: "./dist/index.js",
  default: "./dist/index.js",
});
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
```

Use `git ls-files -z` through a bounded synchronous child process and assert no tracked path contains `/.myco/` or starts with `.myco/`. Assert `.gitignore` contains `.myco/`. Assert `LICENSE` contains the canonical repository URL and not `github.com/TritHypha/TriRegex`.

- [ ] **Step 2: Run the focused test and verify RED**

Run `node --test tests/public-release.test.mjs`.

Expected: failure on missing package metadata, the stale licence locator, and the tracked `.myco` index.

- [ ] **Step 3: Apply the minimal metadata and hygiene change**

Add `main`, `types`, structured `exports`, `repository`, `homepage`, and `bugs` to `package.json`. Keep the existing `files`, engines, scripts, dependencies, author, keywords, licence, name, and version unless this plan explicitly changes them.

Replace the licence's repository locator with the canonical repository URL. Add `.myco/` to `.gitignore`. Remove only `tests/.myco/index.json` from Git.

- [ ] **Step 4: Verify GREEN and package contents**

Run:

```powershell
node --test tests/public-release.test.mjs
npm test
npm pack --dry-run --json
```

Expected: tests pass; the dry-run lists `dist/index.js`, `dist/index.d.ts`, public documentation, package metadata and licence; it lists no test, `.myco`, local path, or source file.

- [ ] **Step 5: Inspect and commit Task 2**

Run `git diff --check`, inspect exactly the five Task 2 paths, then commit:

```powershell
git add package.json LICENSE .gitignore tests/public-release.test.mjs
git rm tests/.myco/index.json
git commit -m "chore: harden TriRegex package metadata"
```

---

### Task 3: Bounded release checker and consumer smoke test

**Files:**
- Create: `tools/release-check.mjs`
- Create: `tests/release-check.test.mjs`
- Modify: `package.json`
- Modify: `docs/RELEASING.md`

**Interfaces:**
- Consumes: npm metadata and public files from Tasks 1–2, the existing build and test scripts, local Git, npm, Node.js, and TypeScript.
- Produces: `runReleaseChecks(options)` plus the CLI `npm run check:release`.

- [ ] **Step 1: Read the good-test rules before changing tests**

Read the complete `superpowers:test-driven-development/writing-good-tests.md`. Name the production behavior each new test can make fail and keep temporary files under an owned OS temporary directory.

- [ ] **Step 2: Write controlled-red unit tests for the checker**

Create `tests/release-check.test.mjs`. Import checker helpers without executing the CLI. Cover at least:

```js
test("validatePackFiles refuses a missing declaration entry", () => {
  assert.throws(
    () => validatePackFiles([{ path: "dist/index.js", size: 10 }]),
    /dist\/index\.d\.ts/,
  );
});

test("scanPublicBytes refuses an absolute local Windows path", () => {
  assert.throws(
    () => scanPublicBytes(new Map([["README.md", "C:\\\\Users\\\\owner\\\\secret"]])),
    /absolute local path/i,
  );
});

test("runBounded reports timeout separately", () => {
  const result = runBounded(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: repoRoot,
    timeoutMs: 50,
  });
  assert.equal(result.status, "TIMEOUT");
});
```

Also cover `.myco` package rejection, nonzero child-process failure, and a valid minimal pack list.

- [ ] **Step 3: Run the checker tests and verify RED**

Run `node --test tests/release-check.test.mjs`.

Expected: module-not-found failure because `tools/release-check.mjs` does not exist.

- [ ] **Step 4: Implement the smallest bounded checker**

Implement exported helpers:

```js
export function runBounded(command, args, { cwd, timeoutMs = 120_000 } = {})
export function validatePackFiles(files)
export function scanPublicBytes(filesByPath)
export async function runReleaseChecks({ repoRoot, requireClean = true } = {})
```

`runBounded` must use `spawnSync` with a finite timeout and 4 MiB output ceiling, and return distinct `PASS`, `FAIL`, and `TIMEOUT` states. `validatePackFiles` must require the runtime entry, declaration entry, README, AUDIT, SECURITY, CHANGELOG, LICENSE, and package manifest; refuse tests, source, `.myco`, secrets, and path traversal; and cap file count at 128, individual size at 1 MiB, and total unpacked size at 4 MiB.

`runReleaseChecks` must:

1. optionally refuse a dirty Git tree;
2. run `npm run build`;
3. run `node --test`;
4. create an owned temporary directory;
5. run `npm pack --json --pack-destination <temp>`;
6. validate the JSON receipt and packed file list;
7. create a disposable ESM consumer and install the exact tarball;
8. run a JavaScript import/match/refusal smoke check;
9. run a TypeScript no-emit consumer check using the repository's pinned compiler;
10. delete only the owned temporary directory in `finally`;
11. emit a deterministic JSON summary without secrets or absolute local paths.

Guard CLI execution with an exact `import.meta.url` comparison so importing the module in tests has no side effect.

- [ ] **Step 5: Verify checker GREEN and red-capability**

Run:

```powershell
node --test tests/release-check.test.mjs
node --test tests/public-release.test.mjs tests/release-check.test.mjs
```

Then temporarily mutate only an in-memory fixture in the test to prove each refusal test turns red when its validator is weakened; restore the implementation and rerun GREEN.

- [ ] **Step 6: Add the npm entry point and release documentation**

Add:

```json
"check:release": "node tools/release-check.mjs"
```

Document `npm run check:release` as the required local pre-publication command and explain that PASS authorizes neither publishing nor tagging.

- [ ] **Step 7: Run the full local release check from a clean temporary commit boundary**

First run focused/full tests and `git diff --check`. Commit the Task 3 files:

```powershell
git add tools/release-check.mjs tests/release-check.test.mjs package.json docs/RELEASING.md
git commit -m "test: add bounded TriRegex release verification"
```

Then run `npm run check:release` on the clean committed tree. Expected: JSON `PASS`, package and consumer checks complete, no repository residue.

---

### Task 4: Continuous integration and exact release closure

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `tests/public-release.test.mjs`
- Modify: `README.md`
- Modify: `docs/RELEASING.md`
- Create: `docs/independent-audits/2026-08-26-triregex-public-release-pass.md` only after an independent PASS is received.

**Interfaces:**
- Consumes: `npm test` and `npm run check:release` from earlier tasks.
- Produces: a platform-visible CI contract and exact-revision closure evidence.

- [ ] **Step 1: Add a RED test for the CI contract**

Extend `tests/public-release.test.mjs` to require `.github/workflows/ci.yml` and assert it contains `pull_request`, `push`, Node versions `18`, `20`, and `22`, `npm ci`, `npm test`, and `npm run check:release`.

- [ ] **Step 2: Run the focused test and verify RED**

Run `node --test tests/public-release.test.mjs`.

Expected: failure because the workflow does not exist.

- [ ] **Step 3: Add the minimal CI workflow**

Create one workflow with read-only contents permission, checkout, setup-node with npm cache, `npm ci`, `npm test`, and `npm run check:release` on a `18.x`, `20.x`, `22.x` matrix. Do not add publication credentials, release jobs, write permissions, or third-party actions beyond GitHub's checkout and setup-node actions.

Update README/release guidance only where necessary to describe CI as corroborating evidence rather than publication authority.

- [ ] **Step 4: Verify and commit CI**

Run:

```powershell
node --test tests/public-release.test.mjs
npm test
git diff --check
```

Inspect the four owned paths and commit:

```powershell
git add .github/workflows/ci.yml tests/public-release.test.mjs README.md docs/RELEASING.md
git commit -m "ci: verify the TriRegex release contract"
```

- [ ] **Step 5: Run exact-tree release verification**

On a clean tree run sequentially:

```powershell
npm ci
npm test
npm run check:release
npm audit --omit=dev
npm pack --dry-run --json
git diff --check HEAD^ HEAD
git status --short --branch
```

Record exact test counts, pack file count/size, audit result, HEAD, tree, branch, and status. Do not translate a skipped or timed-out check into PASS.

- [ ] **Step 6: Refresh and verify the exact code graph**

Index the worktree at the exact committed HEAD in full mode. Require `indexed_head_sha` to equal HEAD, actual nodes to equal expected nodes, skipped files to be zero or explicitly adjudicated, and searches to resolve `runReleaseChecks`, `validatePackFiles`, and `runBounded`.

- [ ] **Step 7: Obtain fresh independent exact-revision review**

Give an independent reviewer the approved design, plan, base SHA, exact target SHA/tree, changed-path list, test receipts, packed-file receipt, graph identity, and explicit review questions. Require source inspection, controlled-red checks, LF/physical-CRLF equivalence for changed executable files, package-consumer verification, and final `PASS`, `HOLD`, or findings with Critical/Important/Minor counts.

If the verdict is HOLD or contains Critical/Important findings, return to a new RED-first repair cycle and repeat exact-revision verification. Do not create a PASS receipt prematurely.

- [ ] **Step 8: Commit the independent PASS receipt and reverify closure**

Only after PASS, create the receipt at the exact path containing the reviewed commit, tree, reviewer identity, scope, commands/results, graph receipt, limitations, hashes, and publication boundary. Commit it separately, rerun documentation tests and `npm run check:release`, refresh the graph for the closure commit, and verify a clean tree.

- [ ] **Step 9: Present the integration decision**

Use `superpowers:finishing-a-development-branch`. State that publication remains owner-controlled and present exactly the local merge, push/PR, or keep-branch choices required by that skill.

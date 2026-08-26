import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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
const PUBLIC_DOCUMENTS = [
  "README.md",
  "AUDIT.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "docs/RELEASING.md",
];

function readPublicDocument(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

test("public release documentation keeps the required release contract", () => {
  for (const relativePath of PUBLIC_DOCUMENTS) {
    assert.ok(existsSync(join(repositoryRoot, relativePath)), `missing ${relativePath}`);
  }

  const readme = readPublicDocument("README.md");
  for (const heading of REQUIRED_README_HEADINGS) {
    assert.ok(readme.includes(heading), `README missing ${heading}`);
  }
  assert.doesNotMatch(readme, /ReDoS-immune/i);
  assert.match(readme, /must not silently fall back to native `RegExp`/i);
  assert.match(readme, /truncated/);
  assert.match(readme, /boundary-adjacency/i);

  const security = readPublicDocument("SECURITY.md");
  assert.match(security, /hello@trithypha\.dev/i);

  const audit = readPublicDocument("AUDIT.md");
  assert.match(audit, /0\.5\.0/);
  assert.doesNotMatch(audit, /34\/34/);
  assert.doesNotMatch(audit, /`?\\b\/\\B`?\s+refused/i);
  assert.doesNotMatch(audit, /no case-insensitive mode/i);
  assert.doesNotMatch(audit, /Remaining before myco/i);

  for (const relativePath of PUBLIC_DOCUMENTS) {
    assert.doesNotMatch(
      readPublicDocument(relativePath),
      /\b[A-Za-z]:[\\/]/,
      `${relativePath} contains a drive-rooted Windows path`,
    );
  }
});

test("package metadata exposes the canonical npm entry points", () => {
  const pkg = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));

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
});

test("release tree excludes generated myco indexes", () => {
  const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 5000,
  })
    .split("\0")
    .filter(Boolean);

  assert.ok(
    trackedPaths.every((relativePath) => !relativePath.includes("/.myco/") && !relativePath.startsWith(".myco/")),
    "generated .myco index is tracked",
  );
  assert.match(readFileSync(join(repositoryRoot, ".gitignore"), "utf8"), /^\.myco\/$/m);
});

test("license names the canonical repository", () => {
  const license = readFileSync(join(repositoryRoot, "LICENSE"), "utf8");

  assert.match(license, /github\.com\/TritHypha\/AI-Tools-TriRegex/);
  assert.doesNotMatch(license, /github\.com\/TritHypha\/TriRegex/);
});

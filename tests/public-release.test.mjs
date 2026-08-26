import assert from "node:assert/strict";
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

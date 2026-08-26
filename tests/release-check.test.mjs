import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runBounded,
  scanPublicBytes,
  validatePackFiles,
} from "../tools/release-check.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const validPackFiles = [
  { path: "dist/index.js", size: 10 },
  { path: "dist/index.d.ts", size: 10 },
  { path: "README.md", size: 10 },
  { path: "AUDIT.md", size: 10 },
  { path: "SECURITY.md", size: 10 },
  { path: "CHANGELOG.md", size: 10 },
  { path: "LICENSE", size: 10 },
  { path: "package.json", size: 10 },
];

test("validatePackFiles refuses a missing declaration entry", () => {
  assert.throws(
    () => validatePackFiles([{ path: "dist/index.js", size: 10 }]),
    /dist\/index\.d\.ts/,
  );
});

test("validatePackFiles accepts the minimal public package", () => {
  assert.doesNotThrow(() => validatePackFiles(validPackFiles));
});

for (const [label, path, expected] of [
  ["generated .myco content", ".myco/index.json", /\.myco/i],
  ["tests", "docs/tests/release-check.test.mjs", /tests/i],
  ["source", "vendor/src/index.js", /source/i],
  ["secret files", ".env", /secret/i],
  ["path traversal", "../LICENSE", /traversal/i],
  ["drive-qualified relative paths", "C:payload", /traversal|absolute/i],
]) {
  test(`validatePackFiles refuses ${label}`, () => {
    assert.throws(
      () => validatePackFiles([...validPackFiles, { path, size: 10 }]),
      expected,
    );
  });
}

test("scanPublicBytes refuses an absolute local Windows path", () => {
  assert.throws(
    () => scanPublicBytes(new Map([["README.md", "C:\\Users\\owner\\secret"]])),
    /absolute local path/i,
  );
});

test("scanPublicBytes refuses private-key material", () => {
  assert.throws(
    () => scanPublicBytes(new Map([["README.md", "-----BEGIN PRIVATE KEY-----"]])),
    /secret/i,
  );
});

test("runBounded reports a successful child process", () => {
  const result = runBounded(process.execPath, ["-e", "process.stdout.write('ok')"], {
    cwd: repoRoot,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.stdout, "ok");
});

test("runBounded reports nonzero child-process failure", () => {
  const result = runBounded(process.execPath, ["-e", "process.exit(7)"], {
    cwd: repoRoot,
    timeoutMs: 5_000,
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.exitCode, 7);
});

test("runBounded reports timeout separately", () => {
  const result = runBounded(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd: repoRoot,
    timeoutMs: 50,
  });

  assert.equal(result.status, "TIMEOUT");
});

test("runBounded refuses output beyond its fixed ceiling", () => {
  const result = runBounded(
    process.execPath,
    ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"],
    { cwd: repoRoot, timeoutMs: 5_000 },
  );

  assert.equal(result.status, "FAIL");
});

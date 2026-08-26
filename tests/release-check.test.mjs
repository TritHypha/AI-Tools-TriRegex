import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  runBounded,
  runReleaseChecks,
  scanPublicBytes,
  validatePackFiles,
} from "../tools/release-check.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const osTemporaryRoot = resolve(tmpdir());
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
  ["test-suffixed JavaScript", "dist/regression.test.js", /test|artifact/i],
  ["spec-suffixed JavaScript", "dist/regression.spec.js", /test|artifact/i],
  ["nested __tests__", "dist/__tests__/fixture.js", /test|artifact/i],
  ["nested spec directory", "dist/spec/fixture.js", /test|artifact/i],
  ["nested specs directory", "dist/specs/fixture.js", /test|artifact/i],
  ["nested __specs__ directory", "dist/__specs__/fixture.js", /test|artifact/i],
  ["source maps", "dist/index.js.map", /source|map|artifact/i],
  ["MTS source", "dist/source.mts", /source|artifact/i],
  ["CTS source", "dist/source.cts", /source|artifact/i],
  ["TSX source", "dist/source.tsx", /source|artifact/i],
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

for (const [label, localPath] of [
  ["macOS user path", "/Users/owner/project/secret"],
  ["Linux home path", "/home/owner/project/secret"],
  ["POSIX temporary path", "/tmp/triregex/secret"],
  ["workspace path", "/workspace/owner/private.txt"],
  ["service path", "/srv/triregex/private.txt"],
  ["data path", "/data/owner/private.txt"],
  ["UNC path", "\\\\server\\share\\owner\\secret"],
]) {
  test(`scanPublicBytes refuses a ${label}`, () => {
    assert.throws(
      () => scanPublicBytes(new Map([["README.md", localPath]])),
      /absolute local path/i,
    );
  });
}

test("scanPublicBytes preserves URLs, operators, and repository-relative paths", () => {
  assert.doesNotThrow(() =>
    scanPublicBytes(
      new Map([
        [
          "README.md",
          "https://example.invalid/home/owner //cdn.example.invalid/assets/file.js docs/README.md ./dist/index.js ../CHANGELOG.md ratio=1/2 value / other",
        ],
      ]),
    ),
  );
});

test("scanPublicBytes preserves JavaScript regex literals and regex examples in comments", () => {
  assert.doesNotThrow(() =>
    scanPublicBytes(
      new Map([
        ["dist/parser.js", "// /[\\b]/ is a regex example\nif (/[a-zA-Z]/.test(value)) return;"],
      ]),
    ),
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

function writeFixtureFile(root, relativePath, contents) {
  const target = join(root, ...relativePath.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

function requireCommandPass(command, args, cwd) {
  const result = runBounded(command, args, { cwd, timeoutMs: 30_000 });
  assert.equal(
    result.status,
    "PASS",
    `${command} ${args.join(" ")} failed: ${result.stderr}`,
  );
}

function findRealNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    if (pathEntry.length === 0) continue;
    candidates.push(join(pathEntry, "node_modules", "npm", "bin", "npm-cli.js"));
    candidates.push(join(pathEntry, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  }
  const found = candidates.find(
    (candidate) => typeof candidate === "string" && existsSync(candidate) && /npm-cli\.js$/i.test(candidate),
  );
  assert.ok(found, "test requires a local npm-cli.js");
  return resolve(found);
}

const realNpmCli = findRealNpmCli();

function createReleaseFixture({ withCompiler = false, directoryName = "repo" } = {}) {
  const fixtureRoot = mkdtempSync(join(osTemporaryRoot, "triregex-check-fixture-"));
  const fixtureRepo = join(fixtureRoot, directoryName);
  mkdirSync(fixtureRepo);

  writeFixtureFile(
    fixtureRepo,
    "package.json",
    `${JSON.stringify(
      {
        name: "triregex",
        version: "1.2.3",
        type: "module",
        main: "./dist/index.js",
        types: "./dist/index.d.ts",
        files: [
          "dist/**/*.js",
          "dist/**/*.d.ts",
          "README.md",
          "AUDIT.md",
          "SECURITY.md",
          "CHANGELOG.md",
          "LICENSE",
        ],
        scripts: { build: "node build.mjs" },
      },
      null,
      2,
    )}\n`,
  );
  writeFixtureFile(fixtureRepo, ".gitignore", "node_modules/\n");
  writeFixtureFile(fixtureRepo, "build.mjs", "// deterministic no-op build\n");
  writeFixtureFile(
    fixtureRepo,
    "test/fixture.test.mjs",
    'import assert from "node:assert/strict";\nimport test from "node:test";\ntest("fixture", () => assert.equal(1, 1));\n',
  );
  writeFixtureFile(
    fixtureRepo,
    "dist/index.js",
    'export function compile(pattern) {\n  if (pattern === "a+?") return { ok: false, verdict: -1, code: "TPRX-PARSE" };\n  return { ok: true, matcher: { test(input) { return { verdict: input.includes("a") ? 1 : -1 }; } } };\n}\n',
  );
  writeFixtureFile(
    fixtureRepo,
    "dist/index.d.ts",
    'export declare function compile(pattern: string): { ok: true; matcher: { test(input: string): { verdict: -1 | 0 | 1 } } } | { ok: false; verdict: -1; code: string };\n',
  );
  writeFixtureFile(fixtureRepo, "dist/helper.js", "export const helper = true;\n");
  writeFixtureFile(fixtureRepo, "README.md", "# Fixture\n");
  writeFixtureFile(fixtureRepo, "AUDIT.md", "# Audit\n");
  writeFixtureFile(fixtureRepo, "SECURITY.md", "# Security\n");
  writeFixtureFile(fixtureRepo, "CHANGELOG.md", "# Changelog\n");
  writeFixtureFile(fixtureRepo, "LICENSE", "Fixture license\n");

  if (withCompiler) {
    mkdirSync(join(fixtureRepo, "node_modules"));
    cpSync(join(repoRoot, "node_modules", "typescript"), join(fixtureRepo, "node_modules", "typescript"), {
      recursive: true,
    });
  }

  requireCommandPass("git", ["init", "-q"], fixtureRepo);
  requireCommandPass("git", ["config", "user.email", "fixture@example.invalid"], fixtureRepo);
  requireCommandPass("git", ["config", "user.name", "TriRegex fixture"], fixtureRepo);
  requireCommandPass(
    "git",
    [
      "add",
      "--",
      ".gitignore",
      "package.json",
      "build.mjs",
      "test/fixture.test.mjs",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/helper.js",
      "README.md",
      "AUDIT.md",
      "SECURITY.md",
      "CHANGELOG.md",
      "LICENSE",
    ],
    fixtureRepo,
  );
  requireCommandPass("git", ["commit", "-q", "-m", "fixture"], fixtureRepo);

  return { fixtureRoot, fixtureRepo };
}

function removeReleaseFixture(fixtureRoot) {
  const candidate = resolve(fixtureRoot);
  assert.ok(candidate.startsWith(`${osTemporaryRoot}${sep}`));
  assert.match(candidate.slice(osTemporaryRoot.length + 1), /^triregex-check-fixture-/);
  rmSync(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

async function withFixture(options, callback) {
  const fixture = createReleaseFixture(options);
  try {
    return await callback(fixture);
  } finally {
    removeReleaseFixture(fixture.fixtureRoot);
  }
}

async function withEnvironment(updates, callback) {
  const previous = new Map();
  for (const [name, value] of Object.entries(updates)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function createNpmMutationCli(fixtureRoot, mutation) {
  const packageRoot = join(fixtureRoot, `npm-shim-${mutation}`, "node_modules", "npm");
  const cliPath = join(packageRoot, "bin", "npm-cli.js");
  writeFixtureFile(
    packageRoot,
    "package.json",
    `${JSON.stringify({ name: "npm", version: "0.0.0-test", bin: { npm: "bin/npm-cli.js" } })}\n`,
  );
  writeFixtureFile(
    packageRoot,
    "bin/npm-cli.js",
    `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";\nimport { join } from "node:path";\nimport { spawnSync } from "node:child_process";\nimport { createHash } from "node:crypto";\nimport { gunzipSync, gzipSync } from "node:zlib";\nconst mutation = ${JSON.stringify(mutation)};\nconst realCli = process.env.TRIREGEX_TEST_REAL_NPM_CLI;\nconst args = process.argv.slice(2);\nconst child = spawnSync(process.execPath, [realCli, ...args], { cwd: process.cwd(), env: { ...process.env, npm_execpath: realCli }, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 120_000, windowsHide: true });\nlet stdout = child.stdout ?? "";\nfunction tarDirectoryHeader(path) {\n  const header = Buffer.alloc(512);\n  header.write(path, 0, 100, "utf8");\n  header.write("0000755\\0", 100, 8, "ascii");\n  header.write("0000000\\0", 108, 8, "ascii");\n  header.write("0000000\\0", 116, 8, "ascii");\n  header.write("00000000000\\0", 124, 12, "ascii");\n  header.write("00000000000\\0", 136, 12, "ascii");\n  header.fill(32, 148, 156);\n  header[156] = "5".charCodeAt(0);\n  header.write("ustar\\0", 257, 6, "ascii");\n  header.write("00", 263, 2, "ascii");\n  let sum = 0; for (const byte of header) sum += byte;\n  header.write(sum.toString(8).padStart(6, "0") + "\\0 ", 148, 8, "ascii");\n  return header;\n}\nfunction addTarDirectory(receipt, path) {\n  const destinationIndex = args.indexOf("--pack-destination");\n  const destination = args[destinationIndex + 1];\n  const tarballPath = join(destination, receipt.filename);\n  const archive = gunzipSync(readFileSync(tarballPath));\n  let end = 0;\n  while (end + 512 <= archive.length && !archive.subarray(end, end + 512).every((byte) => byte === 0)) {\n    const sizeText = archive.subarray(end + 124, end + 136).toString("ascii").replace(/\\0.*$/, "").trim();\n    const size = sizeText.length === 0 ? 0 : Number.parseInt(sizeText, 8);\n    end += 512 + Math.ceil(size / 512) * 512;\n  }\n  const header = tarDirectoryHeader(path);\n  const changed = Buffer.concat([archive.subarray(0, end), header, archive.subarray(end)]);\n  const compressed = gzipSync(changed);\n  writeFileSync(tarballPath, compressed);\n  receipt.size = compressed.length;\n  receipt.shasum = createHash("sha1").update(compressed).digest("hex");\n  receipt.integrity = "sha512-" + createHash("sha512").update(compressed).digest("base64");\n}\nif (child.status === 0 && args[0] === "pack" && args.includes("--json")) {\n  const parsed = JSON.parse(stdout);\n  const receipt = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];\n  if (mutation === "wrong-key") stdout = JSON.stringify({ unexpected: receipt });\n  if (mutation === "bad-shasum") { receipt.shasum = "0".repeat(40); stdout = JSON.stringify(parsed); }\n  if (mutation === "bad-integrity") { receipt.integrity = \`sha512-\${Buffer.alloc(64).toString("base64")}\`; stdout = JSON.stringify(parsed); }\n  if (mutation === "archive-list") { const entry = receipt.files.find((file) => file.path === "dist/helper.js"); entry.path = "dist/extra.js"; stdout = JSON.stringify(parsed); }\n  const tarDirectories = { "tar-dir-traversal": "package/../../outside/", "tar-dir-empty": "package//unexpected/", "tar-dir-drive": "package/C:outside/", "tar-dir-unexpected": "package/unexpected/" };\n  if (tarDirectories[mutation]) { addTarDirectory(receipt, tarDirectories[mutation]); stdout = JSON.stringify(parsed); }\n}\nif (child.status === 0 && args[0] === "install") {\n  const manifestPath = join(process.cwd(), "node_modules", "triregex", "package.json");\n  if (mutation === "installed-manifest" && existsSync(manifestPath)) { const manifest = JSON.parse(readFileSync(manifestPath, "utf8")); manifest.version = "9.9.9"; writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\\n"); }\n  if (mutation === "installed-extra" && existsSync(manifestPath)) writeFileSync(join(process.cwd(), "node_modules", "triregex", "EXTRA.md"), "extra\\n");\n  if (mutation === "installed-directory" && existsSync(manifestPath)) mkdirSync(join(process.cwd(), "node_modules", "triregex", "EMPTY"));\n}\nif (stdout.length > 0) process.stdout.write(stdout);\nif ((child.stderr ?? "").length > 0) process.stderr.write(child.stderr);\nprocess.exitCode = child.status ?? 1;\n`,
  );
  return cliPath;
}

function releaseTempDirectories(root = osTemporaryRoot) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("triregex-release-"))
    .map((entry) => entry.name)
    .sort();
}

async function runMutationFailure(mutation, expectedError) {
  await withFixture({}, async ({ fixtureRoot, fixtureRepo }) => {
    const cliPath = createNpmMutationCli(fixtureRoot, mutation);
    const before = releaseTempDirectories();
    const result = await withEnvironment(
      { npm_execpath: cliPath, TRIREGEX_TEST_REAL_NPM_CLI: realNpmCli },
      () => runReleaseChecks({ repoRoot: fixtureRepo }),
    );
    assert.equal(result.status, "FAIL");
    assert.equal(result.error, expectedError);
    assert.deepEqual(result.cleanup, { status: "PASS" });
    assert.deepEqual(releaseTempDirectories(), before);
  });
}

test("runReleaseChecks refuses a dirty tree before build", async () => {
  await withFixture({}, async ({ fixtureRepo }) => {
    writeFixtureFile(fixtureRepo, "dirty.txt", "dirty\n");
    const result = await runReleaseChecks({ repoRoot: fixtureRepo });
    assert.equal(result.status, "FAIL");
    assert.equal(result.error, "GIT_TREE_DIRTY");
    assert.deepEqual(result.checks, [{ name: "git-clean", status: "FAIL" }]);
    assert.deepEqual(result.cleanup, { status: "PASS" });
  });
});

test("runReleaseChecks refuses a wrongly keyed pack receipt and cleans its temp directory", async () => {
  await runMutationFailure("wrong-key", "PACK_RECEIPT_INVALID_SHAPE");
});

test("runReleaseChecks independently refuses a mismatched tarball SHA-1", async () => {
  await runMutationFailure("bad-shasum", "PACK_SHASUM_MISMATCH");
});

test("runReleaseChecks independently refuses a mismatched tarball SHA-512 SRI", async () => {
  await runMutationFailure("bad-integrity", "PACK_INTEGRITY_MISMATCH");
});

test("runReleaseChecks refuses a receipt list that differs from the archive", async () => {
  await runMutationFailure("archive-list", "PACK_ARCHIVE_FILE_SET_MISMATCH");
});

for (const [label, mutation, expectedError] of [
  ["traversing TAR directory", "tar-dir-traversal", "PACK_ARCHIVE_INVALID"],
  ["TAR directory with an empty segment", "tar-dir-empty", "PACK_ARCHIVE_INVALID"],
  ["drive-qualified TAR directory", "tar-dir-drive", "PACK_ARCHIVE_INVALID"],
  ["unexpected canonical TAR directory", "tar-dir-unexpected", "PACK_ARCHIVE_DIRECTORY_SET_MISMATCH"],
]) {
  test(`runReleaseChecks refuses a ${label}`, async () => {
    await runMutationFailure(mutation, expectedError);
  });
}

test("runReleaseChecks refuses an installed manifest identity mismatch", async () => {
  await runMutationFailure("installed-manifest", "INSTALLED_PACKAGE_IDENTITY_MISMATCH");
});

test("runReleaseChecks refuses an extra installed package file", async () => {
  await runMutationFailure("installed-extra", "INSTALLED_PACKAGE_FILE_SET_MISMATCH");
});

test("runReleaseChecks refuses an unexpected installed package directory", async () => {
  await runMutationFailure("installed-directory", "INSTALLED_PACKAGE_FILE_SET_MISMATCH");
});

test("runReleaseChecks accepts valid archive directories, uses safe npm resolution, and completes both real consumers", async () => {
  await withFixture(
    { withCompiler: true, directoryName: "repo & hostile" },
    async ({ fixtureRoot, fixtureRepo }) => {
      const markerPath = join(fixtureRoot, "cmd-route-executed.txt");
      const fakeCmd = join(fixtureRoot, "npm.cmd");
      writeFileSync(
        fakeCmd,
        `@ECHO OFF\r\nECHO INJECTED>"${markerPath}"\r\n"${process.execPath}" "${realNpmCli}" %*\r\n`,
        "utf8",
      );
      const hostileTemp = join(fixtureRoot, "temp & hostile");
      mkdirSync(hostileTemp);
      const result = await withEnvironment(
        { npm_execpath: fakeCmd, TEMP: hostileTemp, TMP: hostileTemp },
        () => runReleaseChecks({ repoRoot: fixtureRepo }),
      );

      assert.equal(result.status, "PASS");
      assert.equal(existsSync(markerPath), false, "unsafe npm.cmd route executed");
      assert.ok(result.checks.some((check) => check.name === "javascript-consumer" && check.status === "PASS"));
      assert.ok(result.checks.some((check) => check.name === "typescript-consumer" && check.status === "PASS"));
      assert.ok(result.checks.some((check) => check.name === "final-git-clean" && check.status === "PASS"));
      assert.deepEqual(result.cleanup, { status: "PASS" });
      assert.deepEqual(releaseTempDirectories(hostileTemp), []);
    },
  );
});

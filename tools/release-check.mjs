import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_FILE_COUNT = 128;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_PACK_FILES = [
  "dist/index.js",
  "dist/index.d.ts",
  "README.md",
  "AUDIT.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "LICENSE",
  "package.json",
];

class ReleaseCheckError extends Error {
  constructor(code) {
    super(code);
    this.name = "ReleaseCheckError";
    this.code = code;
  }
}

export function runBounded(command, args, { cwd, timeoutMs = 120_000 } = {}) {
  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError("command must be a non-empty string");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new TypeError("args must be an array of strings");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }

  const child = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: timeoutMs,
    windowsHide: true,
  });
  const timedOut = child.error?.code === "ETIMEDOUT";
  const status = timedOut ? "TIMEOUT" : child.status === 0 && child.error === undefined ? "PASS" : "FAIL";

  return {
    status,
    exitCode: child.status,
    signal: child.signal,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    errorCode: child.error?.code,
  };
}

function canonicalPackPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error("package path must be a non-empty relative path");
  }
  const portable = value.replaceAll("\\", "/");
  const segments = portable.split("/");
  if (
    isAbsolute(value) ||
    portable.startsWith("/") ||
    /^[A-Za-z]:/.test(portable) ||
    segments.some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    throw new Error(`package path traversal or absolute path refused: ${value}`);
  }
  return segments.join("/");
}

function isSecretPath(path) {
  const name = posix.basename(path);
  return (
    /^\.env(?:\..*)?$/i.test(name) ||
    /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|credentials?)(?:\..*)?$/i.test(name) ||
    /(?:^|[._-])(?:secret|private[-_.]?key|credentials?)(?:[._-]|$)/i.test(name) ||
    /\.(?:p12|pfx|pem|key|keystore)$/i.test(name)
  );
}

export function validatePackFiles(files) {
  if (!Array.isArray(files)) {
    throw new TypeError("packed files must be an array");
  }
  if (files.length > MAX_FILE_COUNT) {
    throw new Error(`package file count exceeds ${MAX_FILE_COUNT}`);
  }

  const paths = new Set();
  let totalSize = 0;
  for (const file of files) {
    if (file === null || typeof file !== "object") {
      throw new Error("packed file entry must be an object");
    }
    const path = canonicalPackPath(file.path);
    if (paths.has(path)) {
      throw new Error(`duplicate package path refused: ${path}`);
    }
    if (/(^|\/)\.myco(?:\/|$)/i.test(path)) {
      throw new Error(`generated .myco content refused: ${path}`);
    }
    if (/(^|\/)(?:test|tests)(?:\/|$)/i.test(path)) {
      throw new Error(`tests are not public package content: ${path}`);
    }
    if (/(^|\/)src(?:\/|$)/i.test(path) || (/\.ts$/i.test(path) && !/\.d\.ts$/i.test(path))) {
      throw new Error(`source files are not public package content: ${path}`);
    }
    if (isSecretPath(path)) {
      throw new Error(`secret file refused: ${path}`);
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`invalid packed size for ${path}`);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`packed file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
    }
    totalSize += file.size;
    if (totalSize > MAX_TOTAL_BYTES) {
      throw new Error(`total unpacked size exceeds ${MAX_TOTAL_BYTES} bytes`);
    }
    paths.add(path);
  }

  for (const requiredPath of REQUIRED_PACK_FILES) {
    if (!paths.has(requiredPath)) {
      throw new Error(`required packed file missing: ${requiredPath}`);
    }
  }

  return { fileCount: files.length, totalUnpackedSize: totalSize };
}

export function scanPublicBytes(filesByPath) {
  if (!(filesByPath instanceof Map)) {
    throw new TypeError("public files must be provided as a Map");
  }
  if (filesByPath.size > MAX_FILE_COUNT) {
    throw new Error(`public file count exceeds ${MAX_FILE_COUNT}`);
  }

  let totalSize = 0;
  for (const [rawPath, rawBytes] of filesByPath) {
    const path = canonicalPackPath(rawPath);
    if (typeof rawBytes !== "string" && !Buffer.isBuffer(rawBytes) && !ArrayBuffer.isView(rawBytes)) {
      throw new TypeError(`public bytes must be text or bytes: ${path}`);
    }
    const bytes = typeof rawBytes === "string" ? Buffer.from(rawBytes, "utf8") : Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new Error(`public file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
    }
    totalSize += bytes.byteLength;
    if (totalSize > MAX_TOTAL_BYTES) {
      throw new Error(`public bytes exceed ${MAX_TOTAL_BYTES} bytes`);
    }

    const text = bytes.toString("utf8");
    if (/(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/m.test(text)) {
      throw new Error(`absolute local path refused in public bytes: ${path}`);
    }
    if (
      /-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
      /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,})\b/.test(text)
    ) {
      throw new Error(`secret material refused in public bytes: ${path}`);
    }
  }

  return { fileCount: filesByPath.size, totalBytes: totalSize };
}

function resolveNpmInvocation(args) {
  const configured = process.env.npm_execpath;
  if (configured && existsSync(configured)) {
    if (/\.(?:c?m?js)$/i.test(configured)) {
      return { command: process.execPath, args: [configured, ...args] };
    }
    if (process.platform === "win32" && /\.cmd$/i.test(configured)) {
      return {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", configured, ...args],
      };
    }
    return { command: configured, args };
  }

  const adjacentCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (existsSync(adjacentCli)) {
    return { command: process.execPath, args: [adjacentCli, ...args] };
  }
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...args],
    };
  }
  return { command: "npm", args };
}

function runNpm(args, options) {
  const invocation = resolveNpmInvocation(args);
  return runBounded(invocation.command, invocation.args, options);
}

function requirePassingStep(checks, name, result) {
  checks.push({ name, status: result.status });
  if (result.status !== "PASS") {
    throw new ReleaseCheckError(`${name.toUpperCase().replaceAll("-", "_")}_${result.status}`);
  }
  return result;
}

function parsePackReceipt(stdout, expectedPackage) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ReleaseCheckError("PACK_RECEIPT_INVALID_JSON");
  }
  let receipts;
  if (Array.isArray(parsed)) {
    receipts = parsed;
  } else if (parsed !== null && typeof parsed === "object") {
    const entries = Object.entries(parsed);
    if (entries.length !== 1 || entries[0][0] !== expectedPackage.name) {
      throw new ReleaseCheckError("PACK_RECEIPT_INVALID_SHAPE");
    }
    receipts = [entries[0][1]];
  } else {
    throw new ReleaseCheckError("PACK_RECEIPT_INVALID_SHAPE");
  }
  if (receipts.length !== 1 || receipts[0] === null || typeof receipts[0] !== "object") {
    throw new ReleaseCheckError("PACK_RECEIPT_INVALID_SHAPE");
  }
  const receipt = receipts[0];
  if (
    receipt.name !== expectedPackage.name ||
    receipt.version !== expectedPackage.version ||
    typeof receipt.filename !== "string" ||
    basename(receipt.filename) !== receipt.filename ||
    !Array.isArray(receipt.files) ||
    typeof receipt.shasum !== "string" ||
    typeof receipt.integrity !== "string"
  ) {
    throw new ReleaseCheckError("PACK_RECEIPT_INVALID_FIELDS");
  }
  return receipt;
}

function readInstalledPackFiles(packageRoot, files) {
  const root = resolve(packageRoot);
  const bytesByPath = new Map();
  for (const file of files) {
    const target = resolve(root, ...file.path.split("/"));
    if (!target.startsWith(`${root}${sep}`) || !existsSync(target) || !lstatSync(target).isFile()) {
      throw new ReleaseCheckError("INSTALLED_PACKAGE_FILE_MISSING");
    }
    const bytes = readFileSync(target);
    if (bytes.byteLength !== file.size) {
      throw new ReleaseCheckError("INSTALLED_PACKAGE_SIZE_MISMATCH");
    }
    bytesByPath.set(file.path, bytes);
  }
  return bytesByPath;
}

function ownedTemporaryDirectory(path) {
  const temporaryRoot = resolve(tmpdir());
  const candidate = resolve(path);
  return candidate.startsWith(`${temporaryRoot}${sep}`) && basename(candidate).startsWith("triregex-release-");
}

export async function runReleaseChecks({ repoRoot = DEFAULT_REPO_ROOT, requireClean = true } = {}) {
  const root = resolve(repoRoot);
  const checks = [];
  let temporaryDirectory;
  let summary;

  try {
    if (requireClean) {
      const gitStatus = requirePassingStep(
        checks,
        "git-clean",
        runBounded("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: root,
          timeoutMs: 10_000,
        }),
      );
      if (gitStatus.stdout.trim().length !== 0) {
        checks[checks.length - 1] = { name: "git-clean", status: "FAIL" };
        throw new ReleaseCheckError("GIT_TREE_DIRTY");
      }
    } else {
      checks.push({ name: "git-clean", status: "SKIP" });
    }

    requirePassingStep(
      checks,
      "build",
      runNpm(["run", "build"], { cwd: root, timeoutMs: 120_000 }),
    );
    requirePassingStep(
      checks,
      "tests",
      runBounded(process.execPath, ["--test"], { cwd: root, timeoutMs: 120_000 }),
    );

    temporaryDirectory = mkdtempSync(join(tmpdir(), "triregex-release-"));
    if (!ownedTemporaryDirectory(temporaryDirectory)) {
      throw new ReleaseCheckError("TEMPORARY_DIRECTORY_NOT_OWNED");
    }

    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const pack = requirePassingStep(
      checks,
      "npm-pack",
      runNpm(["pack", "--json", "--pack-destination", temporaryDirectory], {
        cwd: root,
        timeoutMs: 120_000,
      }),
    );
    const receipt = parsePackReceipt(pack.stdout, packageJson);
    const packStats = validatePackFiles(receipt.files);
    if (receipt.unpackedSize !== packStats.totalUnpackedSize) {
      throw new ReleaseCheckError("PACK_RECEIPT_SIZE_MISMATCH");
    }
    checks.push({ name: "pack-files", status: "PASS" });

    const tarballPath = resolve(temporaryDirectory, receipt.filename);
    if (!tarballPath.startsWith(`${resolve(temporaryDirectory)}${sep}`) || !existsSync(tarballPath)) {
      throw new ReleaseCheckError("PACK_TARBALL_MISSING");
    }

    const consumerRoot = join(temporaryDirectory, "consumer");
    mkdirSync(consumerRoot);
    writeFileSync(
      join(consumerRoot, "package.json"),
      `${JSON.stringify({ name: "triregex-release-consumer", private: true, type: "module" }, null, 2)}\n`,
      "utf8",
    );
    requirePassingStep(
      checks,
      "consumer-install",
      runNpm(
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarballPath],
        { cwd: consumerRoot, timeoutMs: 120_000 },
      ),
    );

    const installedRoot = join(consumerRoot, "node_modules", packageJson.name);
    const publicBytes = readInstalledPackFiles(installedRoot, receipt.files);
    scanPublicBytes(publicBytes);
    checks.push({ name: "public-bytes", status: "PASS" });

    writeFileSync(
      join(consumerRoot, "smoke.mjs"),
      `import assert from "node:assert/strict";\nimport { compile } from "triregex";\n\nconst accepted = compile("a+");\nassert.equal(accepted.ok, true);\nassert.equal(accepted.matcher.test("caa").verdict, 1);\nconst refused = compile("a+?");\nassert.equal(refused.ok, false);\nassert.equal(refused.verdict, -1);\n`,
      "utf8",
    );
    requirePassingStep(
      checks,
      "javascript-consumer",
      runBounded(process.execPath, ["smoke.mjs"], { cwd: consumerRoot, timeoutMs: 30_000 }),
    );

    writeFileSync(
      join(consumerRoot, "smoke.ts"),
      `import { compile } from "triregex";\n\nconst accepted = compile("a+");\nif (!accepted.ok) throw new Error(accepted.code);\nconst result = accepted.matcher.test("caa");\nexport const verdict: -1 | 0 | 1 = result.verdict;\n`,
      "utf8",
    );
    const compilerPath = join(root, "node_modules", "typescript", "bin", "tsc");
    if (!existsSync(compilerPath)) {
      throw new ReleaseCheckError("PINNED_TYPESCRIPT_MISSING");
    }
    requirePassingStep(
      checks,
      "typescript-consumer",
      runBounded(
        process.execPath,
        [
          compilerPath,
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--skipLibCheck",
          "smoke.ts",
        ],
        { cwd: consumerRoot, timeoutMs: 120_000 },
      ),
    );

    summary = {
      status: "PASS",
      package: {
        name: receipt.name,
        version: receipt.version,
        filename: receipt.filename,
        fileCount: packStats.fileCount,
        unpackedSize: packStats.totalUnpackedSize,
        shasum: receipt.shasum,
        integrity: receipt.integrity,
      },
      checks,
      cleanup: { status: "PENDING" },
    };
  } catch (error) {
    summary = {
      status: "FAIL",
      error: error instanceof ReleaseCheckError ? error.code : "UNEXPECTED_ERROR",
      checks,
      cleanup: { status: "PENDING" },
    };
  } finally {
    try {
      if (temporaryDirectory !== undefined) {
        if (!ownedTemporaryDirectory(temporaryDirectory)) {
          throw new ReleaseCheckError("TEMPORARY_DIRECTORY_NOT_OWNED");
        }
        rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      }
      summary.cleanup = { status: "PASS" };
    } catch {
      summary = {
        status: "FAIL",
        error: "TEMPORARY_CLEANUP_FAILED",
        checks,
        cleanup: { status: "FAIL" },
      };
    }
  }

  return summary;
}

const invokedPath = process.argv[1] === undefined ? undefined : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath !== undefined && import.meta.url === invokedPath) {
  const summary = await runReleaseChecks();
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.status !== "PASS") process.exitCode = 1;
}

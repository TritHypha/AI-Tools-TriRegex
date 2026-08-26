import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, posix, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_FILE_COUNT = 128;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_TAR_BYTES = MAX_TOTAL_BYTES + 1024 * 1024;
const MAX_DIRECTORY_COUNT = MAX_FILE_COUNT * 4;
const MAX_DIRECTORY_DEPTH = 16;
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

function validatePublicArtifact(path) {
  if (/(^|\/)(?:__(?:tests|specs)__|tests?|specs?)(?:\/|$)/i.test(path) || /(?:^|[._-])(?:test|spec)(?=[._-]|$)/i.test(posix.basename(path))) {
    throw new Error(`test artifact is not public package content: ${path}`);
  }
  if (
    /(^|\/)(?:src|source)(?:\/|$)/i.test(path) ||
    /\.(?:map|ts|tsx|mts|cts)$/i.test(path) && !/\.d\.ts$/i.test(path)
  ) {
    throw new Error(`source artifact is not public package content: ${path}`);
  }
  if (REQUIRED_PACK_FILES.includes(path)) return;
  if (/^dist\/(?:[^/]+\/)*(?:[^/]+\.js|[^/]+\.d\.ts)$/.test(path)) return;
  throw new Error(`artifact is not allowed in the public package: ${path}`);
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
    if (isSecretPath(path)) {
      throw new Error(`secret file refused: ${path}`);
    }
    validatePublicArtifact(path);
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

function regexLiteralEnd(text, start) {
  let escaped = false;
  let inClass = false;
  let hasPattern = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\n" || char === "\r") return -1;
    if (escaped) {
      escaped = false;
      hasPattern = true;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      hasPattern = true;
      continue;
    }
    if (char === "[" && !inClass) {
      inClass = true;
      hasPattern = true;
      continue;
    }
    if (char === "]" && inClass) {
      inClass = false;
      continue;
    }
    if (char !== "/" || inClass) {
      hasPattern = true;
      continue;
    }
    if (!hasPattern) return -1;

    const flags = new Set();
    let end = index + 1;
    while (end < text.length && /[dgimsuvy]/.test(text[end])) {
      if (flags.has(text[end])) return -1;
      flags.add(text[end]);
      end += 1;
    }
    if (end < text.length && !/[\s.,;:)\]}!?&|=<>+*%-]/.test(text[end])) return -1;
    return end;
  }
  return -1;
}

function regexModeNotationEnd(text, start) {
  const flags = new Set();
  let end = start + 1;
  while (end < text.length && /[dgimsuvy]/.test(text[end])) {
    if (flags.has(text[end])) return -1;
    flags.add(text[end]);
    end += 1;
  }
  if (flags.size === 0 || !text.startsWith(" mode", end)) return -1;
  const notationEnd = end + " mode".length;
  if (notationEnd < text.length && /[A-Za-z0-9_]/.test(text[notationEnd])) return -1;
  return notationEnd;
}

function containsAbsolutePosixPath(text, artifactPath) {
  const allowsRegexLiterals = artifactPath.endsWith(".js");
  const hasJavaScriptLexicalContexts = allowsRegexLiterals || artifactPath.endsWith(".d.ts");
  let javascriptContext = "code";
  let escaped = false;
  const templateExpressionDepths = [];

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (hasJavaScriptLexicalContexts) {
      if (javascriptContext === "line-comment") {
        if (char === "\n" || char === "\r") javascriptContext = "code";
      } else if (javascriptContext === "block-comment") {
        if (char === "*" && next === "/") {
          javascriptContext = "code";
          index += 1;
          continue;
        }
      } else if (
        javascriptContext === "single-quoted" ||
        javascriptContext === "double-quoted" ||
        javascriptContext === "template"
      ) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (javascriptContext === "template" && char === "$" && next === "{") {
          templateExpressionDepths.push(1);
          javascriptContext = "code";
          index += 1;
          continue;
        }
        const closingQuote = javascriptContext === "single-quoted"
          ? "'"
          : javascriptContext === "double-quoted"
            ? '"'
            : "`";
        if (char === closingQuote) {
          javascriptContext = "code";
          continue;
        }
      } else {
        if (char === "'") {
          javascriptContext = "single-quoted";
          continue;
        }
        if (char === '"') {
          javascriptContext = "double-quoted";
          continue;
        }
        if (char === "`") {
          javascriptContext = "template";
          continue;
        }
        if (char === "/" && next === "/") {
          javascriptContext = "line-comment";
          index += 1;
          continue;
        }
        if (char === "/" && next === "*") {
          javascriptContext = "block-comment";
          index += 1;
          continue;
        }
        if (templateExpressionDepths.length > 0 && char === "{") {
          templateExpressionDepths[templateExpressionDepths.length - 1] += 1;
          continue;
        }
        if (templateExpressionDepths.length > 0 && char === "}") {
          const depthIndex = templateExpressionDepths.length - 1;
          templateExpressionDepths[depthIndex] -= 1;
          if (templateExpressionDepths[depthIndex] === 0) {
            templateExpressionDepths.pop();
            javascriptContext = "template";
          }
          continue;
        }
      }
    }

    if (text[index] !== "/" || text[index + 1] === "/") continue;
    if (index > 0 && !/[\s=([{,:;"'`<>]/.test(text[index - 1])) continue;

    if (javascriptContext === "line-comment" || javascriptContext === "block-comment") {
      const notationEnd = regexModeNotationEnd(text, index);
      if (notationEnd !== -1) {
        index = notationEnd - 1;
        continue;
      }
    }

    if (allowsRegexLiterals && javascriptContext === "code") {
      const regexEnd = regexLiteralEnd(text, index);
      if (regexEnd !== -1) {
        index = regexEnd - 1;
        continue;
      }
    }

    let end = index + 1;
    if (end >= text.length || !/[A-Za-z0-9._~:@%+,&-]/.test(text[end])) continue;
    while (end < text.length && /[A-Za-z0-9._~:@%+,&\/-]/.test(text[end])) end += 1;
    if (end === text.length || /[\s"'`)\]},;<>]/.test(text[end])) return true;
  }
  return false;
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
    if (
      /(?:^|[^A-Za-z0-9])[A-Za-z]:[\\/]/m.test(text) ||
      /(?:^|[\s"'(=])\\\\[^\\/\r\n]+[\\/][^\\/\r\n]+/m.test(text) ||
      containsAbsolutePosixPath(text, path)
    ) {
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

function verifyNpmCli(candidate) {
  if (typeof candidate !== "string" || !/npm-cli\.js$/i.test(candidate)) return undefined;
  try {
    const cliPath = resolve(candidate);
    const cliStats = lstatSync(cliPath);
    if (!cliStats.isFile() || cliStats.isSymbolicLink()) return undefined;
    const packageRoot = resolve(dirname(cliPath), "..");
    if (resolve(packageRoot, "bin", "npm-cli.js") !== cliPath) return undefined;
    const manifestPath = join(packageRoot, "package.json");
    const manifestStats = lstatSync(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) return undefined;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const npmBin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.npm;
    if (manifest.name !== "npm" || npmBin !== "bin/npm-cli.js") return undefined;
    const realPackageRoot = realpathSync(packageRoot);
    const realCliPath = realpathSync(cliPath);
    if (realCliPath !== join(realPackageRoot, "bin", "npm-cli.js")) return undefined;
    return realCliPath;
  } catch {
    return undefined;
  }
}

function resolveNpmInvocation(args) {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    if (pathEntry.length === 0) continue;
    candidates.push(join(pathEntry, "node_modules", "npm", "bin", "npm-cli.js"));
    candidates.push(join(pathEntry, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  }
  for (const candidate of new Set(candidates)) {
    const cliPath = verifyNpmCli(candidate);
    if (cliPath !== undefined) return { command: process.execPath, args: [cliPath, ...args] };
  }
  throw new ReleaseCheckError("NPM_CLI_UNAVAILABLE");
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
    !Number.isSafeInteger(receipt.size) ||
    receipt.size <= 0 ||
    receipt.size > MAX_TOTAL_BYTES ||
    !Number.isSafeInteger(receipt.unpackedSize) ||
    receipt.unpackedSize < 0 ||
    typeof receipt.shasum !== "string" ||
    typeof receipt.integrity !== "string"
  ) {
    throw new ReleaseCheckError("PACK_RECEIPT_INVALID_FIELDS");
  }
  return receipt;
}

function validateTarballDigests(receipt, tarballBytes) {
  if (!/^[a-f0-9]{40}$/.test(receipt.shasum)) {
    throw new ReleaseCheckError("PACK_SHASUM_INVALID");
  }
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(receipt.integrity)) {
    throw new ReleaseCheckError("PACK_INTEGRITY_INVALID");
  }
  const shasum = createHash("sha1").update(tarballBytes).digest("hex");
  if (shasum !== receipt.shasum) {
    throw new ReleaseCheckError("PACK_SHASUM_MISMATCH");
  }
  const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;
  if (integrity !== receipt.integrity) {
    throw new ReleaseCheckError("PACK_INTEGRITY_MISMATCH");
  }
}

function tarText(header, offset, length) {
  return header.subarray(offset, offset + length).toString("utf8").split("\0", 1)[0].trimEnd();
}

function tarOctal(header, offset, length) {
  const text = tarText(header, offset, length).trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
  return value;
}

function validateTarChecksum(header) {
  const expected = tarOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
}

function readTarballFiles(tarballBytes) {
  let archive;
  try {
    archive = gunzipSync(tarballBytes, { maxOutputLength: MAX_TAR_BYTES });
  } catch {
    throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
  }

  const files = new Map();
  const directories = new Set();
  let directoryCount = 0;
  let totalSize = 0;
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= archive.byteLength) {
    const header = archive.subarray(offset, offset + 512);
    const zeroHeader = header.every((byte) => byte === 0);
    offset += 512;
    if (zeroHeader) {
      zeroBlocks += 1;
      if (zeroBlocks >= 2) {
        if (!archive.subarray(offset).every((byte) => byte === 0)) {
          throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
        }
        return { files, directories };
      }
      continue;
    }
    if (zeroBlocks !== 0) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
    validateTarChecksum(header);

    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 155);
    const archivePath = prefix.length === 0 ? name : `${prefix}/${name}`;
    const size = tarOctal(header, 124, 12);
    const type = header[156];
    if (!archivePath.startsWith("package/")) {
      throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
    }
    const relativePath = archivePath.slice("package/".length).replace(/\/$/, "");
    if (type === 53) {
      directoryCount += 1;
      if (size !== 0 || directoryCount > MAX_DIRECTORY_COUNT) {
        throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
      }
      if (relativePath.length !== 0) {
        let path;
        try {
          path = canonicalPackPath(relativePath);
        } catch {
          throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
        }
        if (directories.has(path)) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
        directories.add(path);
      }
    } else if (type === 0 || type === 48) {
      let path;
      try {
        path = canonicalPackPath(relativePath);
      } catch {
        throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
      }
      if (files.has(path) || files.size >= MAX_FILE_COUNT || size > MAX_FILE_BYTES) {
        throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
      }
      totalSize += size;
      if (totalSize > MAX_TOTAL_BYTES) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
      if (offset + size > archive.byteLength) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
      files.set(path, Buffer.from(archive.subarray(offset, offset + size)));
    } else {
      throw new ReleaseCheckError("PACK_ARCHIVE_UNSAFE_ENTRY");
    }

    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + paddedSize > archive.byteLength) throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
    offset += paddedSize;
  }
  throw new ReleaseCheckError("PACK_ARCHIVE_INVALID");
}

function requireExactFileSet(actualPaths, expectedPaths, errorCode) {
  const actual = [...actualPaths].sort();
  const expected = [...expectedPaths].sort();
  if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
    throw new ReleaseCheckError(errorCode);
  }
}

function validateArchiveIdentity(receipt, archive, expectedPackage) {
  const { files: archiveFiles, directories: archiveDirectories } = archive;
  const receiptSizes = new Map(receipt.files.map((file) => [file.path, file.size]));
  requireExactFileSet(archiveFiles.keys(), receiptSizes.keys(), "PACK_ARCHIVE_FILE_SET_MISMATCH");
  const impliedDirectories = new Set();
  for (const path of archiveFiles.keys()) {
    const segments = path.split("/");
    segments.pop();
    while (segments.length > 0) {
      impliedDirectories.add(segments.join("/"));
      segments.pop();
    }
  }
  for (const path of archiveDirectories) {
    if (!impliedDirectories.has(path)) {
      throw new ReleaseCheckError("PACK_ARCHIVE_DIRECTORY_SET_MISMATCH");
    }
  }
  for (const [path, bytes] of archiveFiles) {
    if (receiptSizes.get(path) !== bytes.byteLength) {
      throw new ReleaseCheckError("PACK_ARCHIVE_SIZE_MISMATCH");
    }
  }
  const manifestBytes = archiveFiles.get("package.json");
  try {
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.name !== expectedPackage.name || manifest.version !== expectedPackage.version) {
      throw new ReleaseCheckError("PACK_ARCHIVE_IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof ReleaseCheckError) throw error;
    throw new ReleaseCheckError("PACK_ARCHIVE_IDENTITY_MISMATCH");
  }
}

function enumerateInstalledFiles(packageRoot, expectedPaths) {
  const root = resolve(packageRoot);
  const expectedDirectories = new Set();
  for (const path of expectedPaths) {
    const segments = path.split("/");
    for (let length = 1; length < segments.length; length += 1) {
      expectedDirectories.add(segments.slice(0, length).join("/"));
    }
  }
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new ReleaseCheckError("INSTALLED_PACKAGE_UNSAFE_ENTRY");
  }
  const files = new Map();
  const pending = [{ directory: root, prefix: "", depth: 0 }];
  let directoryCount = 0;
  let totalSize = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = readdirSync(current.directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = current.prefix.length === 0 ? entry.name : `${current.prefix}/${entry.name}`;
      const target = resolve(current.directory, entry.name);
      if (!target.startsWith(`${root}${sep}`)) throw new ReleaseCheckError("INSTALLED_PACKAGE_UNSAFE_ENTRY");
      const stats = lstatSync(target);
      if (stats.isSymbolicLink()) throw new ReleaseCheckError("INSTALLED_PACKAGE_UNSAFE_ENTRY");
      if (stats.isDirectory()) {
        if (!expectedDirectories.has(path)) {
          throw new ReleaseCheckError("INSTALLED_PACKAGE_FILE_SET_MISMATCH");
        }
        directoryCount += 1;
        if (directoryCount > MAX_DIRECTORY_COUNT || current.depth >= MAX_DIRECTORY_DEPTH) {
          throw new ReleaseCheckError("INSTALLED_PACKAGE_UNSAFE_ENTRY");
        }
        pending.push({ directory: target, prefix: path, depth: current.depth + 1 });
        continue;
      }
      if (!stats.isFile() || files.size >= MAX_FILE_COUNT || stats.size > MAX_FILE_BYTES) {
        throw new ReleaseCheckError("INSTALLED_PACKAGE_UNSAFE_ENTRY");
      }
      totalSize += stats.size;
      if (totalSize > MAX_TOTAL_BYTES) throw new ReleaseCheckError("INSTALLED_PACKAGE_UNSAFE_ENTRY");
      files.set(canonicalPackPath(path), readFileSync(target));
    }
  }
  return files;
}

function validateInstalledIdentity(installedFiles, archiveFiles, expectedPackage) {
  const manifestBytes = installedFiles.get("package.json");
  try {
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (manifest.name !== expectedPackage.name || manifest.version !== expectedPackage.version) {
      throw new ReleaseCheckError("INSTALLED_PACKAGE_IDENTITY_MISMATCH");
    }
  } catch (error) {
    if (error instanceof ReleaseCheckError) throw error;
    throw new ReleaseCheckError("INSTALLED_PACKAGE_IDENTITY_MISMATCH");
  }
  requireExactFileSet(installedFiles.keys(), archiveFiles.keys(), "INSTALLED_PACKAGE_FILE_SET_MISMATCH");
  for (const [path, archiveBytes] of archiveFiles) {
    if (!installedFiles.get(path).equals(archiveBytes)) {
      throw new ReleaseCheckError("INSTALLED_PACKAGE_CONTENT_MISMATCH");
    }
  }
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
    const tarballStats = lstatSync(tarballPath);
    if (!tarballStats.isFile() || tarballStats.isSymbolicLink() || tarballStats.size !== receipt.size) {
      throw new ReleaseCheckError("PACK_TARBALL_SIZE_MISMATCH");
    }
    const tarballBytes = readFileSync(tarballPath);
    validateTarballDigests(receipt, tarballBytes);
    checks.push({ name: "tarball-digests", status: "PASS" });
    const archive = readTarballFiles(tarballBytes);
    validateArchiveIdentity(receipt, archive, packageJson);
    checks.push({ name: "archive-identity", status: "PASS" });

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
    const installedFiles = enumerateInstalledFiles(installedRoot, archive.files.keys());
    validateInstalledIdentity(installedFiles, archive.files, packageJson);
    checks.push({ name: "installed-tree", status: "PASS" });
    scanPublicBytes(installedFiles);
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

    if (requireClean) {
      const finalGitStatus = requirePassingStep(
        checks,
        "final-git-clean",
        runBounded("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: root,
          timeoutMs: 10_000,
        }),
      );
      if (finalGitStatus.stdout.trim().length !== 0) {
        checks[checks.length - 1] = { name: "final-git-clean", status: "FAIL" };
        throw new ReleaseCheckError("GIT_TREE_DIRTY_AFTER_CHECKS");
      }
    } else {
      checks.push({ name: "final-git-clean", status: "SKIP" });
    }

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

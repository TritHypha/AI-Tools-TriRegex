// LICENSE drift gate — the fix (full Apache-2.0 text) ships with its detector.
// A short-form licence stub, a lost APPENDIX, a leftover pre-publish NOTE, or a
// copyright line naming a different project would each silently re-block
// publication; this test makes any of them a red run instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, "LICENSE"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

test("LICENSE carries the full Apache-2.0 text, not a stub", () => {
  assert.ok(text.includes("Version 2.0, January 2004"), "version line");
  assert.ok(text.includes("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION"), "terms heading");
  assert.ok(text.includes("APPENDIX: How to apply the Apache License to your work"), "appendix");
  assert.ok(text.includes("END OF TERMS AND CONDITIONS"), "end marker");
  assert.ok(text.length > 10000, `full text is ~11KB; got ${text.length}`);
});

test("LICENSE names this project and carries no pre-publish placeholder", () => {
  assert.match(text, /Copyright 2026 .*TriRegex/, "copyright line names TriRegex");
  assert.ok(!/pre-publish checklist/i.test(text), "old NOTE removed");
  assert.ok(!/Galerina project/.test(text), "not the parent repo's copyright line");
});

test("LICENSE is pure ASCII (no mojibake can hide in a legal document)", () => {
  const nonAscii = [...text].filter((c) => c.charCodeAt(0) > 0x7f);
  assert.equal(nonAscii.length, 0, `non-ASCII chars: ${nonAscii.length}`);
});

test("package.json licence field and files list agree with the LICENSE", () => {
  assert.equal(pkg.license, "Apache-2.0");
  assert.ok(pkg.files.includes("LICENSE"), "LICENSE ships in the package");
});

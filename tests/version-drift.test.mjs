// version-drift: package.json and the VERSION export must agree (a real incident
// class: an incomplete bump shipped once elsewhere; this test makes it impossible).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VERSION } from "../dist/index.js";

test("VERSION constant matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
});

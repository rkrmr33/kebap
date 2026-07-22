import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("uses user-activated access without persistent host permissions", () => {
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.equal("host_permissions" in manifest, false);
  assert.equal("content_scripts" in manifest, false);
});

test("keeps package and manifest versions aligned", () => {
  assert.equal(manifest.version, packageJson.version);
});

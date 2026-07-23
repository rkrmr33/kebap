import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("uses persistent access and injects the panel on every matching page", () => {
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.ok(manifest.permissions.includes("scripting"));
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["<all_urls>"],
      js: ["src/react-bridge.js"],
      run_at: "document_start",
      all_frames: false,
      world: "MAIN",
    },
    {
      matches: ["<all_urls>"],
      js: ["src/core.js", "src/settings.js", "src/content.js"],
      run_at: "document_idle",
      all_frames: false,
    },
  ]);
});

test("keeps package and manifest versions aligned", () => {
  assert.equal(manifest.version, packageJson.version);
});

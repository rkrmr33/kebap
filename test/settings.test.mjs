import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

await import("../src/settings.js");
const Settings = globalThis.KebapSettings;

test("uses a selectable panel fade delay as the default", () => {
  assert.equal(Settings.DEFAULT_PANEL_FADE_DELAY_MS, 2_500);
  assert.ok(Settings.PANEL_FADE_DELAYS_MS.includes(Settings.DEFAULT_PANEL_FADE_DELAY_MS));
});

test("keeps every supported fade delay available in settings", async () => {
  const html = await readFile(new URL("../src/options.html", import.meta.url), "utf8");
  const optionValues = [...html.matchAll(/<option value="(\d+)">/gu)]
    .map((match) => Number(match[1]));
  assert.deepEqual(optionValues, Settings.PANEL_FADE_DELAYS_MS);
});

test("normalizes missing and invalid panel fade delays", () => {
  assert.equal(Settings.normalizePanelFadeDelay(undefined), 2_500);
  assert.equal(Settings.normalizePanelFadeDelay(""), 2_500);
  assert.equal(Settings.normalizePanelFadeDelay(0), 2_500);
  assert.equal(Settings.normalizePanelFadeDelay("5000"), 5_000);
});

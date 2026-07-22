(function initializeKebapSettings(globalObject) {
  "use strict";

  const DEFAULT_PANEL_FADE_DELAY_MS = 2_500;
  const PANEL_FADE_DELAYS_MS = Object.freeze([1_000, 2_500, 5_000, 10_000]);

  function normalizePanelFadeDelay(value) {
    const delay = Number(value);
    return PANEL_FADE_DELAYS_MS.includes(delay) ? delay : DEFAULT_PANEL_FADE_DELAY_MS;
  }

  globalObject.KebapSettings = Object.freeze({
    DEFAULT_PANEL_FADE_DELAY_MS,
    PANEL_FADE_DELAYS_MS,
    normalizePanelFadeDelay,
  });
})(globalThis);

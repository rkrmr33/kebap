(function initializeKebap() {
  "use strict";

  const Core = globalThis.KebapCore;
  const Settings = globalThis.KebapSettings;
  if (!Core || !Settings || window.top !== window || location.origin === "null") return;

  const origin = location.origin;
  const PROBE_ATTRIBUTE = "data-kebap-probe";
  const REACT_TIMEOUT_MS = 150;
  const PANEL_FADE_DURATION_MS = 180;
  const EXTENSION_CONTEXT_ERROR = "KEBAP_EXTENSION_CONTEXT_INVALIDATED";
  const RECONNECT_MESSAGE = "Kebap was updated. Reload this page to reconnect.";
  const SAFE_ATTRIBUTES = new Set(["role", "title", "alt", "type", "name", "href", "src"]);
  const TEST_ATTRIBUTES = new Set(["data-testid", "data-test", "data-cy", "data-qa"]);

  let queue = Core.emptyQueue(origin);
  let inspectModifier = "Alt";
  let panelFadeDelayMs = Settings.DEFAULT_PANEL_FADE_DELAY_MS;
  let modifierHeld = false;
  let inspecting = false;
  let latchedInspection = false;
  let leafTarget = null;
  let targetChain = [];
  let targetIndex = 0;
  let selectedElement = null;
  let selectedEvidence = null;
  let editingId = null;
  let fadeTimer = null;
  let hideTimer = null;
  let pointerFrame = null;
  let highlightAnimation = null;
  let highlightedInspectTarget = null;
  let pendingPointerTarget = null;
  let noticeCleanup = null;
  let noticeTimer = null;

  const ui = createVisualLayer();
  bindUi();
  bindPageEvents();
  initialize().catch(showOperationError);

  async function initialize() {
    const settings = await chrome.storage.local.get({
      inspectModifier: "Alt",
      panelFadeDelayMs: Settings.DEFAULT_PANEL_FADE_DELAY_MS,
    });
    inspectModifier = settings.inspectModifier || "Alt";
    panelFadeDelayMs = Settings.normalizePanelFadeDelay(settings.panelFadeDelayMs);
    const response = await sendQueueMessage("KEBAP_GET_QUEUE");
    queue = response.queue;
    renderQueue();
  }

  function createVisualLayer() {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "false");
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("inset", "0", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("pointer-events", "none", "important");
    host.style.setProperty("display", "block", "important");
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; color-scheme: light dark; }
      * { box-sizing: border-box; }
      .highlight {
        position: fixed;
        display: none;
        pointer-events: none;
        border: 2px solid #fb7185;
        border-radius: 3px;
        background: color-mix(in srgb, #fb7185 10%, transparent);
        box-shadow: 0 0 0 1px rgba(255,255,255,.82), 0 4px 18px rgba(15,23,42,.22);
        transform: translate(0, 0) scale(1);
        transform-origin: top left;
        transition: border-color 100ms ease, background-color 100ms ease;
        will-change: transform;
      }
      .highlight.selected {
        border-color: #f59e0b;
        background: rgba(245,158,11,.12);
      }
      .badge {
        position: fixed;
        display: none;
        pointer-events: none;
        max-width: min(520px, calc(100vw - 24px));
        padding: 5px 8px;
        border-radius: 6px;
        background: #111827;
        color: #f8fafc;
        box-shadow: 0 5px 18px rgba(15,23,42,.28);
        font: 600 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .badge small { color: #cbd5e1; font: 500 10px/1.35 system-ui, sans-serif; }
      .panel {
        position: fixed;
        display: none;
        width: min(390px, calc(100vw - 24px));
        max-height: min(620px, calc(100vh - 24px));
        overflow: hidden;
        pointer-events: auto;
        flex-direction: column;
        border: 1px solid rgba(148,163,184,.45);
        border-radius: 14px;
        background: #f8fafc;
        color: #0f172a;
        box-shadow: 0 18px 50px rgba(15,23,42,.3);
        opacity: 1;
        transform: translateY(0);
        transition: opacity ${PANEL_FADE_DURATION_MS}ms ease, transform ${PANEL_FADE_DURATION_MS}ms ease;
        font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .panel.visible { display: flex; }
      .panel.fading { opacity: 0; transform: translateY(5px); }
      .header, .toolbar, .composer, .notice { flex: 0 0 auto; }
      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #e2e8f0;
      }
      .brand { display: flex; flex: 1; min-width: 0; align-items: center; gap: 2px; }
      .brand-icon { display: block; width: 24px; height: 24px; flex: 0 0 auto; object-fit: contain; }
      .title { font-size: 14px; font-weight: 750; }
      .count { color: #64748b; font-size: 12px; }
      button {
        appearance: none;
        border: 1px solid #cbd5e1;
        border-radius: 7px;
        background: #fff;
        color: #0f172a;
        cursor: pointer;
        font: 600 12px/1 system-ui, sans-serif;
        min-height: 30px;
        padding: 0 9px;
      }
      button:hover { background: #f1f5f9; border-color: #94a3b8; }
      button:focus-visible, textarea:focus-visible, select:focus-visible {
        outline: 2px solid #2563eb;
        outline-offset: 2px;
      }
      button.icon { width: 30px; padding: 0; font-size: 14px; }
      button.pick { font-family: system-ui, "Apple Symbols", "Segoe UI Symbol", sans-serif; font-size: 16px; }
      button.pin { font-size: 8px; }
      button.primary { background: #0f172a; border-color: #0f172a; color: #fff; }
      button.danger { color: #b91c1c; }
      button[aria-pressed="true"] { background: #fef3c7; border-color: #f59e0b; }
      .queue {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 8px;
      }
      .empty { color: #64748b; padding: 20px 12px; text-align: center; }
      .item {
        border: 1px solid #e2e8f0;
        border-radius: 9px;
        background: #fff;
        padding: 9px;
      }
      .item + .item { margin-top: 7px; }
      .item-head { display: flex; align-items: center; gap: 7px; }
      .number {
        align-items: center;
        background: #e2e8f0;
        border-radius: 999px;
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 11px;
        height: 22px;
        justify-content: center;
        width: 22px;
      }
      .element-label {
        color: #475569;
        flex: 1;
        font: 600 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .item-comment { margin: 7px 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
      .item-actions { display: flex; gap: 5px; margin-top: 8px; }
      .item-actions button { min-height: 26px; padding: 0 7px; font-size: 11px; }
      details { margin-top: 7px; color: #475569; font-size: 11px; }
      summary { cursor: pointer; }
      .evidence { margin-top: 5px; overflow-wrap: anywhere; }
      .edit-box, .comment-box {
        width: 100%;
        resize: vertical;
        border: 1px solid #94a3b8;
        border-radius: 8px;
        background: #fff;
        color: #0f172a;
        font: 13px/1.45 system-ui, sans-serif;
        padding: 8px;
      }
      .edit-box { min-height: 72px; margin-top: 8px; }
      .composer { border-top: 1px solid #e2e8f0; padding: 10px; }
      .composer-target {
        color: #475569;
        font: 600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        margin-bottom: 7px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .comment-box { min-height: 82px; }
      .comment-box:disabled { background: #f1f5f9; color: #64748b; }
      .hint { color: #64748b; font-size: 11px; margin-top: 5px; }
      .toolbar { display: flex; gap: 6px; padding: 9px 10px; border-top: 1px solid #e2e8f0; }
      .toolbar .spacer { flex: 1; }
      .notice {
        display: none;
        align-items: center;
        gap: 7px;
        padding: 8px 10px;
        background: #ecfeff;
        border-top: 1px solid #a5f3fc;
        color: #155e75;
        font-size: 12px;
      }
      .notice.visible { display: flex; }
      .notice.error { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
      .notice.confirm { background: #fffbeb; border-color: #fde68a; color: #92400e; }
      .notice-text { flex: 1; }
      @media (prefers-color-scheme: dark) {
        .panel { background: #111827; color: #f8fafc; border-color: #475569; }
        .header, .composer, .toolbar { border-color: #334155; }
        .count, .element-label, .hint, details { color: #94a3b8; }
        button { background: #1e293b; color: #f8fafc; border-color: #475569; }
        button:hover { background: #334155; }
        button.primary { background: #f8fafc; border-color: #f8fafc; color: #0f172a; }
        .queue .item { background: #1e293b; border-color: #334155; }
        .number { background: #334155; }
        .edit-box, .comment-box { background: #0f172a; color: #f8fafc; border-color: #64748b; }
        .comment-box:disabled { background: #1e293b; color: #94a3b8; }
      }
    `;

    const highlight = document.createElement("div");
    highlight.className = "highlight";
    const badge = document.createElement("div");
    badge.className = "badge";

    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Kebap feedback queue");
    panel.innerHTML = `
      <header class="header">
        <div class="brand">
          <img class="brand-icon" alt="" aria-hidden="true">
          <div class="title">Kebap</div>
        </div>
        <div class="count">0 comments</div>
        <button class="icon pick" type="button" aria-label="Select an element" title="Pick element"><span aria-hidden="true">◎</span></button>
        <button class="icon pin" type="button" aria-label="Pin panel" aria-pressed="false" title="Pin panel">●</button>
        <button class="icon settings" type="button" aria-label="Open settings" title="Settings">⚙</button>
        <button class="icon close" type="button" aria-label="Close panel" title="Close">×</button>
      </header>
      <div class="queue" aria-live="polite"></div>
      <div class="composer">
        <div class="composer-target">Select an element with Alt/Option + click</div>
        <textarea class="comment-box" disabled placeholder="Select an element first"></textarea>
        <div class="hint">Enter to add · Shift+Enter for newline · Escape to cancel</div>
      </div>
      <div class="notice" role="status"><span class="notice-text"></span></div>
      <footer class="toolbar">
        <button class="copy" type="button" title="Copy Markdown" aria-keyshortcuts="Alt+Shift+C">Copy</button>
        <button class="cut" type="button" title="Cut queue" aria-keyshortcuts="Alt+Shift+X">Cut</button>
        <span class="spacer"></span>
        <button class="clear danger" type="button" title="Clear queue">Clear</button>
      </footer>
    `;
    panel.querySelector(".brand-icon").src = chrome.runtime.getURL("assets/icons/icon-32.png");

    shadow.append(style, highlight, badge, panel);
    (document.documentElement || document).append(host);

    return {
      host,
      shadow,
      highlight,
      badge,
      panel,
      count: panel.querySelector(".count"),
      pick: panel.querySelector(".pick"),
      pin: panel.querySelector(".pin"),
      settings: panel.querySelector(".settings"),
      close: panel.querySelector(".close"),
      queueList: panel.querySelector(".queue"),
      composerTarget: panel.querySelector(".composer-target"),
      commentBox: panel.querySelector(".comment-box"),
      notice: panel.querySelector(".notice"),
      noticeText: panel.querySelector(".notice-text"),
      copy: panel.querySelector(".copy"),
      cut: panel.querySelector(".cut"),
      clear: panel.querySelector(".clear"),
      pinned: false,
    };
  }

  function bindUi() {
    ui.panel.addEventListener("pointerdown", cancelFade);
    ui.panel.addEventListener("focusin", cancelFade);
    ui.panel.addEventListener("keydown", cancelFade);
    ui.pick.addEventListener("click", beginLatchedInspection);
    ui.pin.addEventListener("click", () => {
      ui.pinned = !ui.pinned;
      ui.pin.setAttribute("aria-pressed", String(ui.pinned));
      const label = ui.pinned ? "Unpin panel" : "Pin panel";
      ui.pin.setAttribute("aria-label", label);
      ui.pin.title = label;
      cancelFade();
    });
    ui.settings.addEventListener("click", () => void openOptions());
    ui.close.addEventListener("click", requestClosePanel);
    ui.commentBox.addEventListener("input", () => {
      if (noticeCleanup === "draft") clearNotice();
    });
    ui.commentBox.addEventListener("keydown", handleComposerKeydown);
    ui.copy.addEventListener("click", () => copyQueue(false));
    ui.cut.addEventListener("click", () => copyQueue(true));
    ui.clear.addEventListener("click", confirmClear);
  }

  function bindPageEvents() {
    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("keyup", handleKeyup, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerdown", suppressInspectPointerEvent, true);
    window.addEventListener("mousedown", suppressInspectPointerEvent, true);
    window.addEventListener("mouseup", suppressInspectPointerEvent, true);
    window.addEventListener("click", handleInspectClick, true);
    window.addEventListener("blur", stopInspecting);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopInspecting();
    });
    window.addEventListener("scroll", updateVisualGeometry, true);
    window.addEventListener("resize", updateVisualGeometry, true);

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "KEBAP_TOGGLE_PANEL") togglePanel();
      if (message?.type === "KEBAP_QUEUE_UPDATED" && message.origin === origin) {
        queue = message.queue;
        renderQueue();
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.inspectModifier) {
        inspectModifier = changes.inspectModifier.newValue || "Alt";
        updateComposerPrompt();
      }
      if (area === "local" && changes.panelFadeDelayMs) {
        panelFadeDelayMs = Settings.normalizePanelFadeDelay(changes.panelFadeDelayMs.newValue);
      }
    });
  }

  async function openOptions() {
    try {
      await sendRuntimeMessage({ type: "KEBAP_OPEN_OPTIONS" });
    } catch (error) {
      showOperationError(error);
    }
  }

  function isEditable(node) {
    return node instanceof Element && Boolean(
      node.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
    );
  }

  function isExtensionEditing() {
    if (!ui.panel.classList.contains("visible")) return false;
    const active = ui.shadow.activeElement;
    return active instanceof HTMLInputElement
      || active instanceof HTMLTextAreaElement
      || active instanceof HTMLSelectElement
      || active?.isContentEditable;
  }

  function isModifierEvent(event) {
    return event.key === inspectModifier;
  }

  function queueShortcutAction(event) {
    if (event.repeat || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return null;
    if (event.code === "KeyC") return "copy";
    if (event.code === "KeyX") return "cut";
    return null;
  }

  function handleKeydown(event) {
    const queueAction = queueShortcutAction(event);
    if (queueAction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopInspecting();
      void copyQueue(queueAction === "cut", true);
      return;
    }

    if (isModifierEvent(event) && !event.repeat) {
      modifierHeld = true;
      if (isEditable(event.target) || isExtensionEditing() || hasNonEmptyDraft()) return;
      inspecting = true;
      latchedInspection = false;
      const focused = document.activeElement;
      if (focused instanceof Element && focused !== document.body && focused !== document.documentElement) {
        leafTarget = focused;
        targetChain = composedAncestors(focused);
        targetIndex = 0;
        renderInspectTarget();
      }
      event.preventDefault();
      return;
    }

    if (!inspecting || (!modifierHeld && !latchedInspection)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      stopInspecting();
      return;
    }
    if (event.key === "Enter" && currentTarget()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = currentTarget();
      inspecting = false;
      modifierHeld = false;
      latchedInspection = false;
      void selectTarget(target);
      return;
    }
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "ArrowUp") targetIndex = Math.min(targetIndex + 1, targetChain.length - 1);
    else targetIndex = Math.max(targetIndex - 1, 0);
    renderInspectTarget();
  }

  function handleKeyup(event) {
    if (!isModifierEvent(event)) return;
    modifierHeld = false;
    if (inspecting && !latchedInspection) stopInspecting();
  }

  function handlePointerMove(event) {
    if (!inspecting) return;
    const candidate = firstSelectableElement(event.composedPath());
    if (!candidate) return;
    pendingPointerTarget = candidate;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = null;
      if (!inspecting || !pendingPointerTarget) return;
      if (pendingPointerTarget !== leafTarget) {
        setLeafTarget(pendingPointerTarget);
        renderInspectTarget();
      }
    });
  }

  function setLeafTarget(element) {
    leafTarget = element;
    targetChain = composedAncestors(leafTarget);
    targetIndex = 0;
  }

  function firstSelectableElement(path) {
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (node === ui.host || ui.host.contains(node)) return null;
      return node;
    }
    return null;
  }

  function composedParent(element) {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function composedAncestors(element) {
    const result = [];
    let current = element;
    while (current instanceof Element && result.length < 50) {
      if (current === ui.host) break;
      result.push(current);
      current = composedParent(current);
    }
    return result;
  }

  function currentTarget() {
    return targetChain[targetIndex] || leafTarget;
  }

  function suppressInspectPointerEvent(event) {
    if (!inspecting) return;
    const candidate = firstSelectableElement(event.composedPath());
    if (!candidate) return;
    if (!currentTarget()) setLeafTarget(candidate);
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleInspectClick(event) {
    if (!inspecting) return;
    const candidate = firstSelectableElement(event.composedPath());
    if (!candidate) return;
    if (!currentTarget()) setLeafTarget(candidate);
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = currentTarget();
    inspecting = false;
    modifierHeld = false;
    latchedInspection = false;
    void selectTarget(target);
  }

  function stopInspecting() {
    inspecting = false;
    modifierHeld = false;
    latchedInspection = false;
    leafTarget = null;
    targetChain = [];
    targetIndex = 0;
    highlightedInspectTarget = null;
    pendingPointerTarget = null;
    hideBadge();
    if (!selectedElement) hideHighlight();
  }

  function renderInspectTarget() {
    const target = currentTarget();
    if (!target?.isConnected) return;
    const rect = target.getBoundingClientRect();
    showHighlight(rect, false, Boolean(highlightedInspectTarget && highlightedInspectTarget !== target));
    highlightedInspectTarget = target;
    showBadge(rect, `${describeElement(target)}\n↑/↓ change target · click select`);
  }

  function beginLatchedInspection() {
    if (hasNonEmptyDraft()) {
      showNotice("Submit or discard the current draft before selecting another element.", "error");
      return;
    }
    inspecting = true;
    latchedInspection = true;
    modifierHeld = false;
    leafTarget = null;
    targetChain = [];
    targetIndex = 0;
    hidePanel();
  }

  async function selectTarget(target) {
    cancelFade();
    selectedElement = target;
    selectedEvidence = null;
    updateVisualGeometry();
    ui.composerTarget.textContent = `Capturing ${describeElement(target)}…`;
    ui.commentBox.disabled = true;
    showPanel(true);

    try {
      selectedEvidence = await captureEvidence(target);
      ui.composerTarget.textContent = describeElement(target);
      ui.commentBox.disabled = false;
      ui.commentBox.placeholder = "Describe the change…";
      ui.commentBox.focus();
    } catch (error) {
      selectedElement = null;
      selectedEvidence = null;
      updateComposerPrompt();
      hideHighlight();
      showNotice(`Could not capture this element: ${error.message}`, "error");
    }
  }

  function handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submitDraft();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      requestCancelDraft();
    }
  }

  async function submitDraft() {
    const comment = ui.commentBox.value.trim();
    if (!selectedEvidence || !comment) {
      showNotice(selectedEvidence ? "Write a comment before adding it." : "Select an element first.", "error", null, "draft");
      return;
    }

    ui.commentBox.disabled = true;
    try {
      const response = await sendQueueMessage("KEBAP_ADD_ANNOTATION", {
        annotation: { ...selectedEvidence, comment },
      });
      queue = response.queue;
      ui.commentBox.value = "";
      selectedElement = null;
      selectedEvidence = null;
      hideHighlight();
      hideBadge();
      updateComposerPrompt();
      renderQueue();
      showNotice("Comment added.");
      scheduleFade();
    } catch (error) {
      ui.commentBox.disabled = false;
      showOperationError(error);
    }
  }

  function hasNonEmptyDraft() {
    return Boolean(selectedEvidence && ui.commentBox.value.trim());
  }

  function requestCancelDraft() {
    if (!selectedEvidence) {
      hidePanel();
      return;
    }
    if (!hasNonEmptyDraft()) {
      discardDraft();
      return;
    }
    showNotice("Discard this unsaved comment?", "confirm", [
      { label: "Keep editing", action: () => { clearNotice(); ui.commentBox.focus(); } },
      { label: "Discard", danger: true, action: discardDraft },
    ]);
  }

  function discardDraft() {
    ui.commentBox.value = "";
    selectedElement = null;
    selectedEvidence = null;
    hideHighlight();
    hideBadge();
    updateComposerPrompt();
    clearNotice();
    hidePanel();
  }

  function requestClosePanel() {
    if (selectedEvidence) requestCancelDraft();
    else hidePanel();
  }

  function togglePanel() {
    if (ui.panel.classList.contains("visible")) requestClosePanel();
    else showPanel(false);
  }

  function showPanel(focusEditor) {
    cancelFade();
    ui.panel.classList.remove("fading");
    ui.panel.classList.add("visible");
    positionPanel();
    if (focusEditor && !ui.commentBox.disabled) ui.commentBox.focus();
  }

  function hidePanel() {
    cancelFade();
    const active = ui.shadow.activeElement;
    if (active instanceof HTMLElement && ui.panel.contains(active)) active.blur();
    ui.panel.classList.remove("visible", "fading");
    if (!selectedEvidence) {
      selectedElement = null;
      hideHighlight();
      hideBadge();
    }
  }

  function scheduleFade() {
    cancelFade();
    if (ui.pinned) return;
    fadeTimer = setTimeout(() => {
      ui.panel.classList.add("fading");
      hideTimer = setTimeout(hidePanel, PANEL_FADE_DURATION_MS);
    }, panelFadeDelayMs);
  }

  function cancelFade() {
    if (fadeTimer) clearTimeout(fadeTimer);
    if (hideTimer) clearTimeout(hideTimer);
    fadeTimer = null;
    hideTimer = null;
    ui.panel.classList.remove("fading");
  }

  function positionPanel() {
    if (!ui.panel.classList.contains("visible")) return;
    requestAnimationFrame(() => {
      const inset = 12;
      const panelRect = ui.panel.getBoundingClientRect();
      const width = panelRect.width;
      const height = panelRect.height;
      const maxX = Math.max(inset, innerWidth - width - inset);
      const maxY = Math.max(inset, innerHeight - height - inset);
      const candidates = [
        { x: inset, y: inset },
        { x: maxX, y: inset },
        { x: inset, y: maxY },
        { x: maxX, y: maxY },
      ];
      const targetRect = selectedElement?.isConnected ? selectedElement.getBoundingClientRect() : null;
      const currentX = Number.parseFloat(ui.panel.style.left);
      const currentY = Number.parseFloat(ui.panel.style.top);
      const currentPlacement = Number.isFinite(currentX) && Number.isFinite(currentY)
        ? {
            x: Math.min(Math.max(inset, currentX), maxX),
            y: Math.min(Math.max(inset, currentY), maxY),
          }
        : candidates[3];
      const best = targetRect
        ? candidates.sort((left, right) => comparePlacements(left, right, width, height, targetRect))[0]
        : currentPlacement;
      ui.panel.style.left = `${best.x}px`;
      ui.panel.style.top = `${best.y}px`;
    });
  }

  function comparePlacements(left, right, width, height, targetRect) {
    const leftOverlap = overlapArea(left.x, left.y, width, height, targetRect);
    const rightOverlap = overlapArea(right.x, right.y, width, height, targetRect);
    if (leftOverlap !== rightOverlap) return leftOverlap - rightOverlap;
    return distanceSquared(right.x, right.y, width, height, targetRect)
      - distanceSquared(left.x, left.y, width, height, targetRect);
  }

  function overlapArea(x, y, width, height, rect) {
    const overlapWidth = Math.max(0, Math.min(x + width, rect.right) - Math.max(x, rect.left));
    const overlapHeight = Math.max(0, Math.min(y + height, rect.bottom) - Math.max(y, rect.top));
    return overlapWidth * overlapHeight;
  }

  function distanceSquared(x, y, width, height, rect) {
    const deltaX = x + width / 2 - (rect.left + rect.width / 2);
    const deltaY = y + height / 2 - (rect.top + rect.height / 2);
    return deltaX * deltaX + deltaY * deltaY;
  }

  function showHighlight(rect, selected, animateGeometry = false) {
    const previousRect = animateGeometry && ui.highlight.style.display !== "none"
      ? ui.highlight.getBoundingClientRect()
      : null;
    highlightAnimation?.cancel();
    highlightAnimation = null;
    Object.assign(ui.highlight.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    ui.highlight.classList.toggle("selected", selected);
    if (!previousRect || rect.width <= 0 || rect.height <= 0) return;
    const deltaX = previousRect.left - rect.left;
    const deltaY = previousRect.top - rect.top;
    const scaleX = previousRect.width / rect.width;
    const scaleY = previousRect.height / rect.height;
    if (![deltaX, deltaY, scaleX, scaleY].every(Number.isFinite)) return;
    highlightAnimation = ui.highlight.animate([
      { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})` },
      { transform: "translate(0, 0) scale(1)" },
    ], {
      duration: 180,
      easing: "cubic-bezier(.2,.8,.2,1)",
    });
  }

  function hideHighlight() {
    highlightAnimation?.cancel();
    highlightAnimation = null;
    highlightedInspectTarget = null;
    ui.highlight.style.display = "none";
  }

  function showBadge(rect, text) {
    const [label, hint] = text.split("\n");
    ui.badge.replaceChildren(document.createTextNode(label), document.createElement("br"));
    const small = document.createElement("small");
    small.textContent = hint;
    ui.badge.append(small);
    ui.badge.style.display = "block";
    const badgeRect = ui.badge.getBoundingClientRect();
    const left = Math.min(Math.max(6, rect.left), Math.max(6, innerWidth - badgeRect.width - 6));
    const preferredTop = rect.top - badgeRect.height - 6;
    const top = preferredTop >= 6 ? preferredTop : Math.min(innerHeight - badgeRect.height - 6, rect.bottom + 6);
    ui.badge.style.left = `${left}px`;
    ui.badge.style.top = `${Math.max(6, top)}px`;
  }

  function hideBadge() {
    ui.badge.style.display = "none";
  }

  function updateVisualGeometry() {
    if (inspecting) {
      renderInspectTarget();
    } else {
      hideBadge();
      if (selectedElement?.isConnected) showHighlight(selectedElement.getBoundingClientRect(), true);
      else if (selectedElement) hideHighlight();
    }
    positionPanel();
  }

  function updateComposerPrompt() {
    if (selectedElement) {
      ui.composerTarget.textContent = describeElement(selectedElement);
      ui.commentBox.disabled = false;
      ui.commentBox.placeholder = "Describe the change…";
      return;
    }
    const key = inspectModifier === "Alt" ? "Alt/Option" : inspectModifier;
    ui.composerTarget.textContent = `Select an element with ${key} + click`;
    ui.commentBox.disabled = true;
    ui.commentBox.placeholder = "Select an element first";
  }

  function renderQueue() {
    ui.count.textContent = `${queue.items.length} ${queue.items.length === 1 ? "comment" : "comments"}`;
    ui.copy.disabled = queue.items.length === 0;
    ui.cut.disabled = queue.items.length === 0;
    ui.clear.disabled = queue.items.length === 0;
    ui.queueList.replaceChildren();

    if (queue.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No feedback yet. Hold Alt/Option and click an element, or use Pick.";
      ui.queueList.append(empty);
      positionPanel();
      return;
    }

    for (const item of [...queue.items].sort((left, right) => left.sequence - right.sequence)) {
      ui.queueList.append(renderQueueItem(item));
    }
    positionPanel();
  }

  function renderQueueItem(item) {
    const article = document.createElement("article");
    article.className = "item";
    const header = document.createElement("div");
    header.className = "item-head";
    const number = document.createElement("span");
    number.className = "number";
    number.textContent = String(item.sequence);
    const label = document.createElement("span");
    label.className = "element-label";
    label.textContent = Core.componentLabel(item.element);
    header.append(number, label);
    article.append(header);

    if (editingId === item.id) {
      const textarea = document.createElement("textarea");
      textarea.className = "edit-box";
      textarea.value = item.comment;
      const actions = itemActions();
      actions.append(
        actionButton("Save", () => void saveEdit(item.id, textarea.value), "primary"),
        actionButton("Cancel", () => { editingId = null; renderQueue(); }),
      );
      article.append(textarea, actions);
      queueMicrotask(() => textarea.focus());
      return article;
    }

    const comment = document.createElement("p");
    comment.className = "item-comment";
    comment.textContent = item.comment;
    article.append(comment);

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Captured evidence";
    const evidence = document.createElement("div");
    evidence.className = "evidence";
    const parts = [item.element?.visibleText, item.element?.selector, item.providers?.react?.components?.join(" > ")]
      .filter(Boolean);
    evidence.textContent = parts.join(" · ") || "Generic element evidence captured.";
    details.append(summary, evidence);
    article.append(details);

    const actions = itemActions();
    actions.append(
      actionButton("Edit", () => { editingId = item.id; renderQueue(); }),
      actionButton("Delete", () => void deleteItem(item.id), "danger"),
    );
    article.append(actions);
    return article;
  }

  function itemActions() {
    const actions = document.createElement("div");
    actions.className = "item-actions";
    return actions;
  }

  function actionButton(label, action, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    const tooltips = {
      Save: "Save changes",
      Cancel: "Cancel",
      Edit: "Edit comment",
      Delete: "Delete comment",
      Undo: "Undo cut",
      "Keep editing": "Keep editing",
      Discard: "Discard draft",
      Clear: "Clear queue",
      "Reload page": "Reload page",
    };
    button.title = tooltips[label] || label;
    if (className) button.className = className;
    button.addEventListener("click", action);
    return button;
  }

  async function saveEdit(id, value) {
    const comment = value.trim();
    if (!comment) {
      showNotice("A comment cannot be empty.", "error");
      return;
    }
    try {
      const response = await sendQueueMessage("KEBAP_UPDATE_COMMENT", { id, comment });
      queue = response.queue;
      editingId = null;
      renderQueue();
      showNotice("Comment updated.");
    } catch (error) {
      showOperationError(error);
    }
  }

  async function deleteItem(id) {
    try {
      const response = await sendQueueMessage("KEBAP_DELETE_ANNOTATION", { id });
      queue = response.queue;
      renderQueue();
      showNotice("Comment deleted.");
    } catch (error) {
      showOperationError(error);
    }
  }

  async function copyQueue(cut, revealPanel = false) {
    const shouldRevealPanel = revealPanel && !ui.panel.classList.contains("visible");
    if (queue.items.length === 0) {
      if (shouldRevealPanel) {
        showNotice("Queue is empty.");
        showPanel(false);
        scheduleFade();
      }
      return;
    }
    const snapshot = structuredClone(queue);
    const markdown = Core.generateMarkdown(snapshot);
    try {
      await writeClipboard(markdown);
      if (!cut) {
        showNotice("Copied to clipboard.");
        if (shouldRevealPanel) {
          showPanel(false);
          scheduleFade();
        }
        return;
      }
      const response = await sendQueueMessage("KEBAP_CUT_ITEMS", {
        ids: snapshot.items.map((item) => item.id),
        revision: snapshot.revision,
      });
      queue = response.queue;
      renderQueue();
      const undoNotice = `undo:${response.undoToken}`;
      showNotice("Copied to clipboard and queue cleared.", "info", [
        {
          label: "Undo",
          action: () => void undoCut(response.undoToken),
        },
      ], undoNotice);
      scheduleNoticeExpiration(undoNotice, response.undoExpiresAt);
      if (shouldRevealPanel) showPanel(false);
      scheduleFade();
    } catch (error) {
      showOperationError(error, "Clipboard unchanged: ");
      if (shouldRevealPanel) showPanel(false);
    }
  }

  async function undoCut(token) {
    try {
      const response = await sendQueueMessage("KEBAP_UNDO_CUT", { token });
      queue = response.queue;
      renderQueue();
      showNotice("Cut undone.");
    } catch (error) {
      showOperationError(error);
    }
  }

  function confirmClear() {
    showNotice("Clear this origin's queue in every tab?", "confirm", [
      { label: "Cancel", action: clearNotice },
      { label: "Clear", danger: true, action: () => void clearQueue() },
    ]);
  }

  async function clearQueue() {
    try {
      const response = await sendQueueMessage("KEBAP_CLEAR_QUEUE");
      queue = response.queue;
      renderQueue();
      showNotice("Queue cleared.");
    } catch (error) {
      showOperationError(error);
    }
  }

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    ui.shadow.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("The browser rejected clipboard access.");
  }

  function showNotice(text, kind = "info", actions = null, cleanup = null) {
    clearNotice();
    ui.notice.className = `notice visible ${kind}`;
    ui.noticeText.textContent = text;
    noticeCleanup = cleanup;
    for (const descriptor of actions || []) {
      ui.notice.append(actionButton(descriptor.label, descriptor.action, descriptor.danger ? "danger" : ""));
    }
  }

  function clearNotice() {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    for (const button of ui.notice.querySelectorAll("button")) button.remove();
    ui.notice.className = "notice";
    ui.noticeText.textContent = "";
    noticeCleanup = null;
  }

  function scheduleNoticeExpiration(cleanup, expiresAt) {
    const delay = Math.max(0, expiresAt - Date.now());
    noticeTimer = setTimeout(() => {
      if (noticeCleanup === cleanup) clearNotice();
    }, delay);
  }

  function normalizeRuntimeError(error) {
    const message = error?.message || String(error);
    if (/Extension context invalidated\.?/iu.test(message)) {
      const reconnectError = new Error(RECONNECT_MESSAGE);
      reconnectError.code = EXTENSION_CONTEXT_ERROR;
      return reconnectError;
    }
    return error instanceof Error ? error : new Error(message);
  }

  function showOperationError(error, prefix = "") {
    const normalized = normalizeRuntimeError(error);
    const actions = normalized.code === EXTENSION_CONTEXT_ERROR
      ? [{ label: "Reload page", action: () => location.reload() }]
      : null;
    showNotice(`${prefix}${normalized.message}`, "error", actions);
  }

  async function sendRuntimeMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      throw normalizeRuntimeError(error);
    }
  }

  async function sendQueueMessage(type, payload = {}) {
    const response = await sendRuntimeMessage({ type, origin, ...payload });
    if (!response?.ok) throw new Error(response?.error || "The extension service worker did not respond.");
    return response;
  }

  function safeToken(value, limit = 120) {
    const normalized = Core.normalizeText(value, limit);
    if (!normalized || /(?:password|passwd|secret|bearer|auth(?:orization)?|token|api[-_]?key)/iu.test(normalized)) {
      return "";
    }
    return normalized;
  }

  function safeClasses(element) {
    return [...element.classList]
      .map((value) => safeToken(value, 100))
      .filter(Boolean)
      .slice(0, 12);
  }

  function describeElement(element) {
    const id = safeToken(element.id) ? `#${safeToken(element.id)}` : "";
    const classes = safeClasses(element).slice(0, 3);
    return `${element.tagName.toLowerCase()}${id}${classes.length ? `.${classes.join(".")}` : ""}`;
  }

  function captureAttributes(element) {
    const result = {};
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name === "id" || name === "class" || name === "style" || name.startsWith("on") || name === "value") continue;
      if (!SAFE_ATTRIBUTES.has(name) && !TEST_ATTRIBUTES.has(name) && !name.startsWith("aria-")) continue;
      let value = attribute.value;
      if (name === "href" || name === "src") {
        try {
          value = Core.sanitizeUrl(new URL(value, location.href).toString());
        } catch {
          value = "";
        }
      }
      else value = safeToken(value, 250);
      if (value) result[name] = value;
    }
    return result;
  }

  function accessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return Core.normalizeText(ariaLabel, 200);

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const root = element.getRootNode();
      const text = labelledBy
        .split(/\s+/u)
        .map((id) => root.getElementById?.(id)?.innerText || "")
        .join(" ");
      if (text.trim()) return Core.normalizeText(text, 200);
    }

    if (element instanceof HTMLInputElement && element.id) {
      const root = element.getRootNode();
      const label = root.querySelector?.(`label[for="${attributeEscape(element.id)}"]`);
      if (label?.innerText) return Core.normalizeText(label.innerText, 200);
    }

    return Core.normalizeText(
      element.getAttribute("alt")
      || element.getAttribute("title")
      || element.innerText
      || element.textContent
      || "",
      200,
    );
  }

  function visibleText(element) {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return "";
    return Core.normalizeText(element.innerText || element.textContent || "", Core.TEXT_LIMIT);
  }

  function attributeEscape(value) {
    return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/gu, (character) => `\\${character}`);
  }

  function selectorUnique(selector, element, root) {
    try {
      const matches = root.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  }

  function selectorSegment(element, root, allowId = true) {
    const tag = element.tagName.toLowerCase();
    const id = safeToken(element.id);
    if (allowId && id) {
      const selector = `#${cssEscape(id)}`;
      if (selectorUnique(selector, element, root)) return selector;
    }

    for (const name of TEST_ATTRIBUTES) {
      const value = safeToken(element.getAttribute(name));
      if (!value) continue;
      const selector = `${tag}[${name}="${attributeEscape(value)}"]`;
      if (selectorUnique(selector, element, root)) return selector;
    }

    const classes = safeClasses(element).slice(0, 3);
    const classSelector = classes.map((value) => `.${cssEscape(value)}`).join("");
    if (classSelector && selectorUnique(`${tag}${classSelector}`, element, root)) return `${tag}${classSelector}`;

    const parent = element.parentElement;
    if (!parent) return `${tag}${classSelector}`;
    const siblings = [...parent.children].filter((sibling) => sibling.tagName === element.tagName);
    const index = siblings.indexOf(element) + 1;
    return `${tag}${classSelector}:nth-of-type(${index})`;
  }

  function selectorWithinRoot(element) {
    const root = element.getRootNode();
    const direct = selectorSegment(element, root);
    if (selectorUnique(direct, element, root)) return direct;

    const parts = [];
    let current = element;
    while (current instanceof Element && parts.length < 8) {
      parts.unshift(selectorSegment(current, root, parts.length === 0));
      const selector = parts.join(" > ");
      if (selectorUnique(selector, element, root)) return selector;
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function elementSelector(element) {
    const local = selectorWithinRoot(element);
    const root = element.getRootNode();
    if (!(root instanceof ShadowRoot)) return local;
    return `${elementSelector(root.host)} >>> ${local}`;
  }

  function ancestorPath(element) {
    const parts = [];
    let current = element;
    while (current instanceof Element && parts.length < 10) {
      parts.unshift(describeElement(current));
      const root = current.getRootNode();
      if (!current.parentElement && root instanceof ShadowRoot) {
        parts.unshift(">>>");
        current = root.host;
      } else {
        current = current.parentElement;
      }
    }
    return parts.join(" > ").replace("> >>> >", ">>>");
  }

  function sanitizedHtml(element) {
    const clone = element.cloneNode(true);
    if (!(clone instanceof Element)) return "";
    clone.querySelectorAll("script, style, noscript, template, [hidden], [aria-hidden='true']").forEach((node) => node.remove());
    const elements = [clone, ...clone.querySelectorAll("*")];
    for (const node of elements) {
      const sourceAttributes = captureAttributes(node);
      const id = safeToken(node.id);
      const classes = safeClasses(node);
      for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
      if (id) node.id = id;
      if (classes.length) node.className = classes.join(" ");
      for (const [name, value] of Object.entries(sourceAttributes)) node.setAttribute(name, value);
      if (node instanceof HTMLInputElement) node.value = "";
      if (node instanceof HTMLTextAreaElement) node.textContent = "";
    }
    return Core.truncate(clone.outerHTML, Core.HTML_LIMIT);
  }

  function rounded(value) {
    return Math.round(value * 100) / 100;
  }

  function renderedEvidence(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      bounds: {
        x: rounded(rect.x),
        y: rounded(rect.y),
        width: rounded(rect.width),
        height: rounded(rect.height),
      },
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      styles: {
        display: style.display,
        boxSizing: style.boxSizing,
        width: style.width,
        height: style.height,
        marginTop: style.marginTop,
        marginRight: style.marginRight,
        marginBottom: style.marginBottom,
        marginLeft: style.marginLeft,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        paddingBottom: style.paddingBottom,
        paddingLeft: style.paddingLeft,
        backgroundColor: style.backgroundColor,
        backgroundImage: Core.sanitizeCssUrl(style.backgroundImage),
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        borderTopStyle: style.borderTopStyle,
        borderRightStyle: style.borderRightStyle,
        borderBottomStyle: style.borderBottomStyle,
        borderLeftStyle: style.borderLeftStyle,
        borderTopColor: style.borderTopColor,
        borderRightColor: style.borderRightColor,
        borderBottomColor: style.borderBottomColor,
        borderLeftColor: style.borderLeftColor,
        borderRadius: style.borderRadius,
        position: style.position,
        top: style.top,
        right: style.right,
        bottom: style.bottom,
        left: style.left,
        zIndex: style.zIndex,
      },
    };
  }

  async function captureEvidence(element) {
    const generic = {
      page: { url: Core.sanitizeUrl(location.href) },
      element: {
        tagName: element.tagName.toLowerCase(),
        id: safeToken(element.id) || undefined,
        classes: safeClasses(element),
        attributes: captureAttributes(element),
        accessibleName: accessibleName(element) || undefined,
        visibleText: visibleText(element) || undefined,
        selector: elementSelector(element),
        ancestorPath: ancestorPath(element),
        html: sanitizedHtml(element),
      },
      rendered: renderedEvidence(element),
      providers: {},
      attachments: [],
    };

    const react = await captureReactEvidence(element);
    if (react) generic.providers.react = react;
    return generic;
  }

  async function captureReactEvidence(element) {
    const requestId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const previous = element.getAttribute(PROBE_ATTRIBUTE);
    element.setAttribute(PROBE_ATTRIBUTE, token);

    return new Promise((resolve) => {
      const finish = (evidence) => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timeout);
        if (previous === null) element.removeAttribute(PROBE_ATTRIBUTE);
        else element.setAttribute(PROBE_ATTRIBUTE, previous);
        resolve(sanitizeReactEvidence(evidence));
      };
      const onMessage = (event) => {
        const message = event.data;
        if (
          event.source !== window
          || message?.source !== "kebap:main"
          || message?.type !== "KEBAP_REACT_RESPONSE"
          || message.requestId !== requestId
        ) return;
        finish(message.evidence);
      };
      const timeout = setTimeout(() => finish(null), REACT_TIMEOUT_MS);
      window.addEventListener("message", onMessage);
      window.postMessage({
        source: "kebap:isolated",
        type: "KEBAP_REACT_REQUEST",
        requestId,
        token,
      }, "*");
    });
  }

  function sanitizeReactEvidence(value) {
    if (!value || !Array.isArray(value.components)) return null;
    const components = value.components
      .map((name) => String(name).replace(/[^a-zA-Z0-9_$.-]/gu, "").slice(0, 120))
      .filter(Boolean)
      .slice(0, 20);
    const sourceFile = Core.sanitizeSourceHint(value.source?.file);
    if (components.length === 0 && !sourceFile) return null;
    return {
      provider: "react-zero-config",
      providerVersion: 1,
      confidence: sourceFile ? "high" : "medium",
      components,
      source: sourceFile ? {
        file: sourceFile,
        line: positiveInteger(value.source?.line),
        column: positiveInteger(value.source?.column),
      } : null,
    };
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
  }
})();

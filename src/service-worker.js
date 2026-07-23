"use strict";

importScripts("core.js");

const Core = globalThis.KebapCore;
const mutationChains = new Map();
const UNDO_WINDOW_MS = 60_000;

function originFromSender(sender) {
  const rawUrl = sender?.url || sender?.tab?.url;
  if (!rawUrl) return null;
  try {
    const origin = new URL(rawUrl).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function senderContext(message, sender) {
  const senderOrigin = originFromSender(sender);
  if (!senderOrigin || senderOrigin !== message.origin) {
    throw new Error("Queue origin does not match the sending page.");
  }
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("Queue messages must come from a browser tab.");
  return { origin: senderOrigin, tabId };
}

async function readQueue(tabId) {
  const key = Core.queueStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const queue = stored[key] || Core.emptyQueue(tabId);
  if (queue.undo?.expiresAt <= Date.now()) queue.undo = null;
  return queue;
}

async function writeQueue(tabId, queue) {
  const key = Core.queueStorageKey(tabId);
  await chrome.storage.session.set({ [key]: queue });
}

function serialize(tabId, operation) {
  const previous = mutationChains.get(tabId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.catch(() => undefined).finally(() => {
    if (mutationChains.get(tabId) === tail) mutationChains.delete(tabId);
  });
  mutationChains.set(tabId, tail);
  return current;
}

function cleanAnnotationDraft(draft) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sequence: 0,
    createdAt: now,
    updatedAt: now,
    comment: String(draft.comment || "").slice(0, 10_000),
    page: draft.page || {},
    element: draft.element || {},
    rendered: draft.rendered || {},
    providers: draft.providers || {},
    attachments: [],
  };
}

async function mutateQueue(tabId, operation) {
  return serialize(tabId, async () => {
    const queue = await readQueue(tabId);
    const result = await operation(queue);
    queue.revision += 1;
    await writeQueue(tabId, queue);
    return { queue, ...result };
  });
}

async function handleQueueMessage(message, sender) {
  const { tabId } = senderContext(message, sender);

  switch (message.type) {
    case "KEBAP_GET_QUEUE":
      return { queue: await readQueue(tabId) };

    case "KEBAP_ADD_ANNOTATION":
      return mutateQueue(tabId, (queue) => {
        const item = cleanAnnotationDraft(message.annotation || {});
        item.sequence = queue.nextSequence;
        queue.nextSequence += 1;
        queue.items.push(item);
        queue.undo = null;
        return { item };
      });

    case "KEBAP_UPDATE_COMMENT":
      return mutateQueue(tabId, (queue) => {
        const item = queue.items.find((candidate) => candidate.id === message.id);
        if (!item) throw new Error("Annotation no longer exists.");
        item.comment = String(message.comment || "").slice(0, 10_000);
        item.updatedAt = new Date().toISOString();
        queue.undo = null;
        return {};
      });

    case "KEBAP_DELETE_ANNOTATION":
      return mutateQueue(tabId, (queue) => {
        queue.items = queue.items.filter((item) => item.id !== message.id);
        queue.undo = null;
        if (queue.items.length === 0) queue.nextSequence = 1;
        return {};
      });

    case "KEBAP_CUT_ITEMS":
      return mutateQueue(tabId, (queue) => {
        const ids = new Set(Array.isArray(message.ids) ? message.ids : []);
        const removed = queue.items.filter((item) => ids.has(item.id));
        queue.items = queue.items.filter((item) => !ids.has(item.id));
        const undoToken = crypto.randomUUID();
        queue.undo = {
          token: undoToken,
          expiresAt: Date.now() + UNDO_WINDOW_MS,
          items: removed,
        };
        if (queue.items.length === 0) queue.nextSequence = 1;
        return { undoToken, undoExpiresAt: queue.undo.expiresAt };
      });

    case "KEBAP_UNDO_CUT":
      return mutateQueue(tabId, (queue) => {
        if (!queue.undo || queue.undo.token !== message.token || queue.undo.expiresAt <= Date.now()) {
          throw new Error("The undo window has expired.");
        }
        const existingIds = new Set(queue.items.map((item) => item.id));
        queue.items.push(...queue.undo.items.filter((item) => !existingIds.has(item.id)));
        queue.items.sort((left, right) => left.sequence - right.sequence);
        queue.nextSequence = Math.max(
          queue.nextSequence,
          ...queue.items.map((item) => item.sequence + 1),
          1,
        );
        queue.undo = null;
        return {};
      });

    case "KEBAP_CLEAR_QUEUE":
      return mutateQueue(tabId, (queue) => {
        queue.items = [];
        queue.nextSequence = 1;
        queue.undo = null;
        return {};
      });

    default:
      throw new Error(`Unknown queue message: ${message.type}`);
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") throw new Error("Invalid message.");

  if (message.type.startsWith("KEBAP_") && message.type !== "KEBAP_OPEN_OPTIONS") {
    return handleQueueMessage(message, sender);
  }

  if (message.type === "KEBAP_OPEN_OPTIONS") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  throw new Error(`Unknown message: ${message.type}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse({ ok: true, ...response }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

async function injectKebap(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["src/react-bridge.js"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/core.js", "src/settings.js", "src/content.js"],
  });
}

async function showActivationError(tabId) {
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#dc2626" });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 2_000);
}

async function togglePanel(tab) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "KEBAP_TOGGLE_PANEL" });
  } catch {
    try {
      // Manifest-declared scripts cover normal loads. This handles tabs that
      // were already open when the extension was installed or reloaded.
      await injectKebap(tabId);
      await chrome.tabs.sendMessage(tabId, { type: "KEBAP_TOGGLE_PANEL" });
    } catch {
      await showActivationError(tabId);
    }
  }
}

chrome.action.onClicked.addListener(togglePanel);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await togglePanel(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  mutationChains.delete(tabId);
  void chrome.storage.session.remove(Core.queueStorageKey(tabId));
});

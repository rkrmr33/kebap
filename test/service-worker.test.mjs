import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

await import("../src/core.js");
const Core = globalThis.KebapCore;
const workerSource = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");

function createWorkerHarness() {
  const session = new Map();
  const readyTabs = new Set();
  const injections = [];
  let messageListener;
  let actionListener;
  let removedListener;
  let updatedListener;
  const chrome = {
    storage: {
      session: {
        async get(key) {
          return session.has(key) ? { [key]: structuredClone(session.get(key)) } : {};
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) session.set(key, structuredClone(value));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) session.delete(key);
        },
      },
    },
    tabs: {
      async query() { return [{ id: 1 }]; },
      async sendMessage(tabId) {
        if (!readyTabs.has(tabId)) throw new Error("No receiver");
      },
      onUpdated: { addListener(listener) { updatedListener = listener; } },
      onRemoved: { addListener(listener) { removedListener = listener; } },
    },
    scripting: {
      async executeScript(details) {
        injections.push(structuredClone(details));
        if (details.files?.includes("src/content.js")) readyTabs.add(details.target.tabId);
      },
    },
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } },
      async openOptionsPage() {},
    },
    action: {
      onClicked: { addListener(listener) { actionListener = listener; } },
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
    commands: { onCommand: { addListener() {} } },
  };

  const context = vm.createContext({
    URL,
    chrome,
    console,
    crypto,
    setTimeout,
    clearTimeout,
    structuredClone,
  });
  context.globalThis = context;
  context.importScripts = () => { context.KebapCore = Core; };
  vm.runInContext(workerSource, context, { filename: "service-worker.js" });

  async function send(message, { tabId = 1, url = "https://example.com/page" } = {}) {
    return new Promise((resolve) => {
      const keepAlive = messageListener(message, { tab: { id: tabId, url }, url }, resolve);
      assert.equal(keepAlive, true);
    });
  }

  async function closeTab(tabId) {
    readyTabs.delete(tabId);
    removedListener(tabId);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return {
    closeTab,
    injections,
    readyTabs,
    send,
    triggerAction: (tabId) => actionListener({ id: tabId }),
    async triggerUpdated(tabId, status = "complete") {
      updatedListener(tabId, { status });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function annotation(comment) {
  return {
    comment,
    page: { url: "https://example.com/page" },
    element: {
      tagName: "button",
      classes: [],
      selector: "button",
      ancestorPath: "body > button",
      html: "<button>Go</button>",
    },
    rendered: { bounds: {}, viewport: {}, styles: {} },
    providers: {},
    attachments: [],
  };
}

test("serializes a tab queue and assigns chronological sequence numbers", async () => {
  const worker = createWorkerHarness();
  const first = await worker.send({
    type: "KEBAP_ADD_ANNOTATION",
    origin: "https://example.com",
    annotation: annotation("First"),
  });
  const second = await worker.send({
    type: "KEBAP_ADD_ANNOTATION",
    origin: "https://example.com",
    annotation: annotation("Second"),
  });

  assert.equal(first.ok, true);
  assert.equal(first.item.sequence, 1);
  assert.equal(second.item.sequence, 2);
  assert.deepEqual(second.queue.items.map((item) => item.comment), ["First", "Second"]);
});

test("keeps same-origin tabs in separate queues", async () => {
  const worker = createWorkerHarness();
  await worker.send({
    type: "KEBAP_ADD_ANNOTATION",
    origin: "https://example.com",
    annotation: annotation("Tab one"),
  }, { tabId: 1 });
  const secondTab = await worker.send({
    type: "KEBAP_GET_QUEUE",
    origin: "https://example.com",
  }, { tabId: 2 });

  assert.deepEqual(secondTab.queue.items, []);
});

test("keeps a tab queue across navigation", async () => {
  const worker = createWorkerHarness();
  await worker.send({
    type: "KEBAP_ADD_ANNOTATION",
    origin: "https://example.com",
    annotation: annotation("Before navigation"),
  }, { tabId: 4 });
  const afterNavigation = await worker.send({
    type: "KEBAP_GET_QUEUE",
    origin: "https://other.example",
  }, { tabId: 4, url: "https://other.example/page" });

  assert.deepEqual(afterNavigation.queue.items.map((item) => item.comment), ["Before navigation"]);
});

test("Cut removes only its snapshot and Undo preserves newer annotations", async () => {
  const worker = createWorkerHarness();
  const first = await worker.send({ type: "KEBAP_ADD_ANNOTATION", origin: "https://example.com", annotation: annotation("First") });
  const second = await worker.send({ type: "KEBAP_ADD_ANNOTATION", origin: "https://example.com", annotation: annotation("Second") });
  await worker.send({ type: "KEBAP_ADD_ANNOTATION", origin: "https://example.com", annotation: annotation("Concurrent") });

  const cut = await worker.send({
    type: "KEBAP_CUT_ITEMS",
    origin: "https://example.com",
    ids: [first.item.id, second.item.id],
  });
  assert.deepEqual(cut.queue.items.map((item) => item.comment), ["Concurrent"]);

  const undo = await worker.send({
    type: "KEBAP_UNDO_CUT",
    origin: "https://example.com",
    token: cut.undoToken,
  });
  assert.deepEqual(undo.queue.items.map((item) => item.comment), ["First", "Second", "Concurrent"]);
});

test("rejects attempts to mutate a different origin", async () => {
  const worker = createWorkerHarness();
  const response = await worker.send({
    type: "KEBAP_ADD_ANNOTATION",
    origin: "https://other.example",
    annotation: annotation("Nope"),
  });
  assert.equal(response.ok, false);
  assert.match(response.error, /origin does not match/iu);
});

test("removes feedback when its tab closes", async () => {
  const worker = createWorkerHarness();
  await worker.send({
    type: "KEBAP_ADD_ANNOTATION",
    origin: "https://example.com",
    annotation: annotation("Temporary"),
  }, { tabId: 8 });
  await worker.closeTab(8);
  const reopened = await worker.send({
    type: "KEBAP_GET_QUEUE",
    origin: "https://example.com",
  }, { tabId: 8 });

  assert.deepEqual(reopened.queue.items, []);
});

test("injects Kebap into a tab when the user activates it", async () => {
  const worker = createWorkerHarness();
  await worker.triggerAction(12);

  assert.equal(worker.readyTabs.has(12), true);
  assert.deepEqual(worker.injections, [
    {
      target: { tabId: 12 },
      world: "MAIN",
      files: ["src/react-bridge.js"],
    },
    {
      target: { tabId: 12 },
      files: ["src/core.js", "src/settings.js", "src/content.js"],
    },
  ]);
});

test("reinjects Kebap after an activated tab reloads", async () => {
  const worker = createWorkerHarness();
  await worker.triggerAction(13);
  worker.readyTabs.delete(13);

  await worker.triggerUpdated(13);

  assert.equal(worker.readyTabs.has(13), true);
  assert.deepEqual(worker.injections.slice(2), [
    {
      target: { tabId: 13 },
      world: "MAIN",
      files: ["src/react-bridge.js"],
    },
    {
      target: { tabId: 13 },
      files: ["src/core.js", "src/settings.js", "src/content.js"],
    },
  ]);
});

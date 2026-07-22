import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

await import("../src/core.js");
const Core = globalThis.KebapCore;
const workerSource = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");

function createWorkerHarness() {
  const session = new Map();
  let messageListener;
  const chrome = {
    storage: {
      session: {
        async get(key) {
          return session.has(key) ? { [key]: structuredClone(session.get(key)) } : {};
        },
        async set(values) {
          for (const [key, value] of Object.entries(values)) session.set(key, structuredClone(value));
        },
      },
    },
    tabs: {
      async query() { return []; },
      async sendMessage() {},
    },
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } },
      async openOptionsPage() {},
    },
    action: {
      onClicked: { addListener() {} },
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

  async function send(message, url = "https://example.com/page") {
    return new Promise((resolve) => {
      const keepAlive = messageListener(message, { url }, resolve);
      assert.equal(keepAlive, true);
    });
  }

  return { send };
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

test("serializes origin queues and assigns chronological sequence numbers", async () => {
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

import assert from "node:assert/strict";
import test from "node:test";

await import("../src/core.js");
const Core = globalThis.KebapCore;

test("normalizes and truncates visible text by Unicode character", () => {
  assert.equal(Core.normalizeText("  hello\n\tworld  "), "hello world");
  const value = Core.truncate("😀😀😀😀😀", 4, "…");
  assert.equal(value, "😀😀😀…");
});

test("sanitizes query values and removes ordinary fragments", () => {
  const sanitized = Core.sanitizeUrl("https://user:pass@example.com/cart?account=123&token=secret#private");
  assert.equal(
    sanitized,
    "https://example.com/cart?account=%5Bredacted%5D&token=%5Bredacted%5D",
  );
});

test("preserves structural hash routes while redacting their query", () => {
  const sanitized = Core.sanitizeUrl("https://example.com/#/checkout?account=123");
  assert.equal(sanitized, "https://example.com/#/checkout?account=%5Bredacted%5D");
});

test("sanitizes source hints to project-relative paths", () => {
  assert.equal(
    Core.sanitizeSourceHint("file:///Users/person/private-project/src/components/Button.tsx?cache=1"),
    "src/components/Button.tsx",
  );
});

test("generates chronological agent-ready Markdown", () => {
  const queue = Core.emptyQueue("https://example.com");
  queue.items = [
    {
      id: "later",
      sequence: 2,
      comment: "Use a stronger border",
      page: { url: "https://example.com/cart" },
      element: {
        tagName: "section",
        classes: ["summary"],
        selector: "section.summary",
        ancestorPath: "body > main > section.summary",
        html: '<section class="summary">Summary</section>',
      },
      rendered: { viewport: { width: 1440, height: 900, devicePixelRatio: 2 }, styles: {} },
      providers: {},
    },
    {
      id: "first",
      sequence: 1,
      comment: "Increase spacing\nKeep the mobile layout compact.",
      page: { url: "https://example.com/cart" },
      element: {
        tagName: "button",
        id: "checkout",
        classes: ["primary"],
        accessibleName: "Complete purchase",
        visibleText: "Complete purchase",
        selector: "#checkout",
        ancestorPath: "body > main > button#checkout",
        html: '<button id="checkout">Complete purchase</button>',
      },
      rendered: {
        viewport: { width: 1440, height: 900, devicePixelRatio: 2 },
        styles: { width: "240px", marginTop: "0px" },
      },
      providers: {
        react: {
          components: ["CheckoutButton", "CartPage"],
          source: { file: "src/CheckoutButton.tsx", line: 42 },
        },
      },
    },
  ];

  const markdown = Core.generateMarkdown(queue);
  assert.ok(markdown.startsWith("Implement the UI feedback below."));
  assert.ok(markdown.indexOf("## 1. Increase spacing") < markdown.indexOf("## 2. Use a stronger border"));
  assert.match(markdown, /React: `CheckoutButton > CartPage`/u);
  assert.match(markdown, /Source hint: `src\/CheckoutButton\.tsx:42`/u);
  assert.match(markdown, /width: 240px;/u);
  assert.match(markdown, /> Keep the mobile layout compact\./u);
});

test("uses a longer Markdown fence when evidence contains backticks", () => {
  assert.equal(Core.fencedBlock("html", "```danger```"), "````html\n```danger```\n````");
  assert.equal(Core.inlineCode("a`b"), "``a`b``");
});

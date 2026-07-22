(function initializeKebapCore(global) {
  "use strict";

  const TEXT_LIMIT = 300;
  const HTML_LIMIT = 4_000;
  const SOURCE_LIMIT = 500;
  const REDACTED = "[redacted]";

  function unicodeLength(value) {
    return Array.from(value).length;
  }

  function truncate(value, limit, marker = " … [truncated]") {
    const text = String(value ?? "");
    const characters = Array.from(text);
    if (characters.length <= limit) return text;
    const markerLength = unicodeLength(marker);
    const contentLength = Math.max(0, limit - markerLength);
    return `${characters.slice(0, contentLength).join("")}${marker}`;
  }

  function normalizeText(value, limit = TEXT_LIMIT) {
    const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
    return truncate(normalized, limit);
  }

  function redactSearchParams(searchParams) {
    const redacted = new URLSearchParams();
    for (const key of searchParams.keys()) {
      if (!redacted.has(key)) redacted.set(key, REDACTED);
    }
    return redacted.toString();
  }

  function sanitizeHash(hash) {
    if (!hash || hash === "#") return "";
    if (!hash.startsWith("#/") && !hash.startsWith("#!/")) return "";

    const prefix = hash.startsWith("#!/") ? "#!" : "#";
    const route = hash.slice(prefix.length);
    const queryIndex = route.indexOf("?");
    if (queryIndex === -1) return `${prefix}${route}`;

    const path = route.slice(0, queryIndex);
    const params = new URLSearchParams(route.slice(queryIndex + 1));
    const search = redactSearchParams(params);
    return search ? `${prefix}${path}?${search}` : `${prefix}${path}`;
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(String(value));
      if (!["http:", "https:", "file:"].includes(url.protocol)) return "";
      url.username = "";
      url.password = "";
      url.search = redactSearchParams(url.searchParams);
      url.hash = sanitizeHash(url.hash);
      return truncate(url.toString(), SOURCE_LIMIT);
    } catch {
      return "";
    }
  }

  function sanitizeSourceHint(value) {
    let source = String(value ?? "").trim().replaceAll("\\", "/");
    if (!source) return "";

    source = source.replace(/[?#].*$/u, "");
    source = source.replace(/^(?:webpack|vite|file):\/{0,3}/u, "");
    const srcIndex = source.lastIndexOf("/src/");
    if (srcIndex >= 0) source = source.slice(srcIndex + 1);
    else {
      const segments = source.split("/").filter(Boolean);
      source = segments.slice(-4).join("/");
    }
    return truncate(source, SOURCE_LIMIT);
  }

  function sanitizeCssUrl(value) {
    return String(value ?? "").replace(/url\((['"]?)(.*?)\1\)/giu, (_match, quote, url) => {
      const sanitized = sanitizeUrl(url);
      return sanitized ? `url(${quote}${sanitized}${quote})` : "none";
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function inlineCode(value) {
    const text = String(value ?? "").replace(/\s+/gu, " ").trim();
    const runs = text.match(/`+/gu) ?? [];
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    const fence = "`".repeat(Math.max(1, longest + 1));
    const padded = /^\s|\s$/u.test(text) || text.startsWith("`") || text.endsWith("`")
      ? ` ${text} `
      : text;
    return `${fence}${padded}${fence}`;
  }

  function fencedBlock(language, value) {
    const text = String(value ?? "");
    const runs = text.match(/`+/gu) ?? [];
    const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `${fence}${language}\n${text}\n${fence}`;
  }

  function headingText(comment) {
    const firstLine = String(comment ?? "").split(/\r?\n/u, 1)[0];
    return escapeHtml(normalizeText(firstLine, 120) || "Untitled feedback");
  }

  function cssPropertyName(value) {
    return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
  }

  function renderStyles(styles) {
    return Object.entries(styles ?? {})
      .filter(([, value]) => value !== "" && value != null)
      .map(([property, value]) => `${cssPropertyName(property)}: ${value};`)
      .join("\n");
  }

  function componentLabel(element) {
    if (!element) return "unknown";
    const id = element.id ? `#${element.id}` : "";
    const classes = Array.isArray(element.classes) && element.classes.length
      ? `.${element.classes.join(".")}`
      : "";
    return `${element.tagName || "unknown"}${id}${classes}`;
  }

  function generateMarkdown(queue) {
    const items = [...(queue?.items ?? [])].sort((left, right) => left.sequence - right.sequence);
    const lines = [
      "Implement the UI feedback below. Use the rendered element evidence to locate the responsible source code; selectors and HTML describe runtime output and may not appear verbatim in the repository.",
      "",
      "# UI feedback",
      "",
    ];

    for (const item of items) {
      lines.push(`## ${item.sequence}. ${headingText(item.comment)}`, "");

      const commentLines = String(item.comment ?? "").split(/\r?\n/u);
      if (commentLines.length > 1) {
        lines.push("### Full comment", "");
        for (const line of commentLines) lines.push(`> ${escapeHtml(line)}`);
        lines.push("");
      }

      const target = componentLabel(item.element);
      if (item.page?.url) lines.push(`- Page: ${item.page.url}`);
      lines.push(`- Target: ${inlineCode(target)}`);
      if (item.element?.accessibleName) {
        lines.push(`- Accessible name: ${inlineCode(item.element.accessibleName)}`);
      }
      if (item.element?.visibleText) {
        lines.push(`- Visible text: ${inlineCode(item.element.visibleText)}`);
      }
      if (item.element?.selector) lines.push(`- Selector: ${inlineCode(item.element.selector)}`);

      const react = item.providers?.react;
      if (react?.components?.length) {
        lines.push(`- React: ${inlineCode(react.components.join(" > "))}`);
      }
      if (react?.source?.file) {
        const location = [react.source.file, react.source.line, react.source.column]
          .filter((part) => part !== undefined && part !== null && part !== "")
          .join(":");
        lines.push(`- Source hint: ${inlineCode(location)}`);
      }

      const viewport = item.rendered?.viewport;
      if (viewport) {
        lines.push(`- Viewport: ${inlineCode(`${viewport.width} × ${viewport.height} @ ${viewport.devicePixelRatio}x`)}`);
      }
      lines.push("");

      if (item.element?.html) {
        lines.push("### Rendered HTML", "", fencedBlock("html", item.element.html), "");
      }
      if (item.element?.ancestorPath) {
        lines.push("### Ancestor context", "", inlineCode(item.element.ancestorPath), "");
      }
      const renderedStyles = renderStyles(item.rendered?.styles);
      if (renderedStyles) {
        lines.push("### Rendered style", "", fencedBlock("css", renderedStyles), "");
      }
    }

    return `${lines.join("\n").trim()}\n`;
  }

  function queueStorageKey(tabId) {
    return `queue:tab:${tabId}`;
  }

  function emptyQueue(tabId = null) {
    return {
      tabId: Number.isInteger(tabId) ? tabId : null,
      revision: 0,
      nextSequence: 1,
      items: [],
      undo: null,
    };
  }

  global.KebapCore = Object.freeze({
    HTML_LIMIT,
    REDACTED,
    SOURCE_LIMIT,
    TEXT_LIMIT,
    componentLabel,
    emptyQueue,
    escapeHtml,
    fencedBlock,
    generateMarkdown,
    inlineCode,
    normalizeText,
    queueStorageKey,
    renderStyles,
    sanitizeCssUrl,
    sanitizeHash,
    sanitizeSourceHint,
    sanitizeUrl,
    truncate,
  });
})(globalThis);

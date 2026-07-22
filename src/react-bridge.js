(function initializeKebapReactBridge() {
  "use strict";

  const instanceKey = Symbol.for("kebap.reactBridge.initialized");
  if (window[instanceKey]) return;
  window[instanceKey] = true;

  const REQUEST_SOURCE = "kebap:isolated";
  const RESPONSE_SOURCE = "kebap:main";
  const PROBE_ATTRIBUTE = "data-kebap-probe";

  function findProbe(root, token) {
    if (!root?.querySelectorAll) return null;
    for (const element of root.querySelectorAll(`[${PROBE_ATTRIBUTE}]`)) {
      if (element.getAttribute(PROBE_ATTRIBUTE) === token) return element;
    }
    for (const element of root.querySelectorAll("*")) {
      if (!element.shadowRoot) continue;
      const match = findProbe(element.shadowRoot, token);
      if (match) return match;
    }
    return null;
  }

  function reactFiberFor(element) {
    const property = Object.getOwnPropertyNames(element).find(
      (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"),
    );
    return property ? element[property] : null;
  }

  function componentName(fiber) {
    const candidate = fiber?.elementType || fiber?.type;
    if (!candidate) return "";
    if (typeof candidate === "function") return candidate.displayName || candidate.name || "";
    if (typeof candidate === "object") {
      return candidate.displayName
        || candidate.render?.displayName
        || candidate.render?.name
        || candidate.type?.displayName
        || candidate.type?.name
        || "";
    }
    return "";
  }

  function sourceFor(fiber) {
    const source = fiber?._debugSource;
    if (!source?.fileName) return null;
    return {
      file: String(source.fileName),
      line: Number.isFinite(source.lineNumber) ? source.lineNumber : undefined,
      column: Number.isFinite(source.columnNumber) ? source.columnNumber : undefined,
    };
  }

  function evidenceFor(element) {
    const fiber = reactFiberFor(element);
    if (!fiber) return null;

    const components = [];
    let source = null;
    let current = fiber;
    let safety = 0;
    while (current && safety < 100) {
      const name = componentName(current);
      if (name && components.at(-1) !== name) components.push(name);
      if (!source) source = sourceFor(current);
      current = current.return;
      safety += 1;
    }

    if (components.length === 0 && !source) return null;
    return {
      provider: "react-zero-config",
      providerVersion: 1,
      confidence: source ? "high" : "medium",
      components: components.slice(0, 20),
      source,
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (
      !message
      || message.source !== REQUEST_SOURCE
      || message.type !== "KEBAP_REACT_REQUEST"
      || typeof message.requestId !== "string"
      || typeof message.token !== "string"
    ) return;

    const element = findProbe(document, message.token);
    const evidence = element ? evidenceFor(element) : null;
    window.postMessage({
      source: RESPONSE_SOURCE,
      type: "KEBAP_REACT_RESPONSE",
      requestId: message.requestId,
      evidence,
    }, "*");
  });
})();

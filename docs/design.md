# Element Feedback Browser Extension — Design

**Status:** Approved for implementation  
**Target:** Chrome and Chromium browsers, Manifest V3  
**Last updated:** 2026-07-22

## 1. Summary

This extension lets a user point at rendered HTML, attach a written fix or comment, accumulate feedback in capture order, and copy the result as agent-friendly Markdown. The exported evidence should help a coding agent find the responsible source code even when the rendered HTML does not appear verbatim in the repository.

The extension works on generic HTML without application changes. React pages receive additional, zero-configuration component evidence when the runtime exposes it. All data stays local to the browser.

## 2. Goals

- Make capturing element-specific UI feedback fast enough to use repeatedly during a review.
- Identify targets with several complementary signals instead of depending on one brittle CSS selector.
- Preserve comments in chronological order within a tab review queue.
- Produce a self-contained Markdown handoff optimized for a coding agent.
- Work on arbitrary HTML pages and progressively enrich React targets.
- Avoid resizing or otherwise changing the reviewed page's viewport.
- Sanitize captured evidence before it enters extension storage.
- Perform no analytics, telemetry, cloud synchronization, or extension-originated network requests.

## 3. Non-goals for v1

- Screenshots or other binary attachments
- Selecting content inside iframes
- Identifying logical objects drawn inside a canvas
- Vue, Svelte, Angular, or other framework adapters
- Reliable source-file lookup when React does not expose source metadata
- Relocating and scrolling to an element from a saved queue item
- Persistence across full browser restarts
- Chrome-internal pages, the Chrome Web Store, or closed Shadow DOM
- `file://` pages unless the user explicitly enables file access

The evidence model should permit later attachment and framework-provider fields without a migration of the core queue format.

## 4. Terminology

- **Inspect mode:** The temporary mode active while the inspect modifier is held.
- **Leaf target:** The deepest eligible element under the pointer.
- **Target:** The leaf target or one of its ancestors chosen by the user.
- **Annotation:** A written comment plus captured evidence about one target.
- **Queue:** The ordered annotations associated with one browser tab.
- **Origin:** The URL tuple `scheme://hostname:port`, used to verify that queue messages came from the page they claim.
- **Evidence provider:** A module that contributes target metadata. Generic HTML is mandatory; React is optional and best-effort.

## 5. Primary interaction

### 5.1 Inspecting

1. The content script remains dormant until the user holds `Alt` on Windows/Linux or `Option` on macOS. The modifier is configurable.
2. Moving the pointer outlines the deepest eligible element without modifying that element's styles or layout.
3. A badge identifies the current target, for example:

   ```text
   button#checkout.primary
   ↑/↓ change target · click select
   ```

4. While the modifier remains held, Up selects the current target's parent and Down moves back toward the leaf target.
5. Moving to a new leaf resets ancestor navigation to that leaf.
6. Clicking captures the chosen target and suppresses that click's normal page behavior.
7. Releasing the modifier before clicking exits inspect mode and removes the transient highlight.

For keyboard accessibility, holding the modifier while a page element has focus starts on that element, and Enter selects it.

Inspect mode must not activate while focus is in an `input`, `textarea`, `select`, or editable region. It must also reset on window blur and `visibilitychange` so a missed keyup cannot leave inspection active.

### 5.2 Composing

After target selection, the extension:

- Captures and sanitizes evidence immediately.
- Keeps the chosen element outlined while the editor is open.
- Opens the in-page panel and focuses its textarea.
- Submits on Enter.
- Inserts a newline on Shift+Enter.
- Does not submit Enter while an input method editor is composing text.
- Cancels on Escape, asking for confirmation only when the draft is non-empty.

There is only one active draft. If it is empty, another selection may replace its target. If it contains text, further inspection is disabled until the user submits or cancels it. Partial drafts are never auto-saved.

On successful submission, the new annotation appears at the bottom of the queue. One second later, the unpinned panel begins a short fade-out.

### 5.3 Reopening and managing the queue

The extension toolbar icon and a configurable extension command toggle the in-page panel. A pin control prevents automatic fading.

The panel also exposes a one-shot **Pick** action as an accessibility fallback for environments where a held modifier cannot be used. It enters inspect mode until the next selection or Escape; hold-to-inspect remains the primary path.

The panel shows annotations in capture order, oldest first. Each row includes its sequence number, comment, and a compact element badge. The user can:

- Edit the comment
- Delete the item
- Copy the queue as Markdown
- Cut the queue as Markdown
- Clear the queue after confirmation

Selecting the same element repeatedly creates separate annotations. Reordering is deliberately omitted because capture order is meaningful.

## 6. In-page visual layer

The visual layer is mounted in a closed extension-owned Shadow DOM so page styles do not leak into the extension and extension styles do not leak into the page. It must never add a border, class, or other persistent styling to the selected page element.

### 6.1 Highlight

The highlight is a fixed-position overlay derived from `getBoundingClientRect()`. It tracks scroll and resize events and uses different visual states for hover and confirmed selection. Extension-owned UI must never be eligible for selection.

### 6.2 Panel placement

The panel uses `position: fixed` and does not resize the site viewport. It evaluates four viewport anchors:

- Top-left
- Top-right
- Bottom-left
- Bottom-right

Placement first minimizes intersection with the selected element's bounding rectangle, then maximizes distance between the panel and element. The panel has a viewport-aware width, a capped height, and an internally scrolling queue. On very small viewports, keeping controls reachable takes precedence over distance from the target.

A maximum practical z-index is used, although browser top-layer content such as a page-owned modal may still render above the extension.

## 7. Evidence capture

Evidence is a snapshot taken at selection time. Selectors and HTML describe runtime output and are diagnostic clues, not guaranteed persistent locators.

### 7.1 Generic HTML provider

The generic provider always attempts to capture:

- Page URL after sanitization
- Tag name
- Safe ID and class names
- `role`, ARIA attributes, and common test identifiers
- Accessible name when derivable
- Short visible-text excerpt
- A best-effort CSS selector
- Compact ancestor path
- Sanitized and size-limited HTML snippet
- Target bounding rectangle
- Curated computed styles
- Viewport width and height
- Device pixel ratio

Selector generation prefers, in order:

1. A unique safe ID
2. A unique test attribute
3. Stable semantic attributes
4. Stable class segments
5. Structural segments using `:nth-of-type()` only where necessary

The ancestor path provides an independent clue and should not simply repeat the full selector.

### 7.2 Text capture

Only rendered text is captured. Whitespace is normalized, the default maximum is 300 Unicode characters, and truncated values end with an explicit `[truncated]` marker. Hidden text and form-control values are excluded.

### 7.3 Style snapshot

The style snapshot is intentionally curated rather than a dump of every computed property. It contains:

- Bounding `x`, `y`, width, and height
- Computed width and height
- `display` and `box-sizing`
- Four-sided margin and padding
- Background color and sanitized background image
- Border widths, styles, colors, and radius
- `position`, inset properties, and `z-index`

Viewport dimensions and device pixel ratio accompany the snapshot so a coding agent can interpret measurements in context.

### 7.4 React provider

React enrichment is zero-configuration and opportunistic. When runtime metadata is available, the provider may add:

- The closest owning component name
- A component-owner chain
- A source filename and line/column hint already exposed by the runtime
- A confidence level and provider version

The provider must not capture props, state, context values, or other application data. It must not fetch source maps or make any network request. It uses feature detection, treats framework internals as unstable, and fails closed: errors or low-confidence results omit React evidence while preserving the generic annotation.

The provider boundary must support future framework adapters without changing queue, UI, or export code.

## 8. Sanitization

Sanitization happens before data is placed in extension storage. Export-time sanitization alone is insufficient.

The sanitizer must:

- Remove values from inputs, textareas, and other form controls.
- Remove password values under all circumstances.
- Remove inline event-handler attributes.
- Remove script and style contents.
- Remove credentials from URLs.
- Redact URL query values while retaining parameter names.
- Omit or redact fragment data that cannot safely be identified as a route.
- Sanitize query and fragment data in `href`, `src`, and background-image URLs.
- Retain only useful structural, semantic, accessibility, and test attributes.
- Limit captured text and HTML sizes with visible truncation markers.
- Exclude the extension's own Shadow DOM and visual overlays.

Semantic PII in visible page text cannot be identified reliably without external processing. The extension therefore captures only the bounded visible excerpt described above and exposes it in annotation details before export.

## 9. Data model

The following is conceptual rather than a prescribed TypeScript definition:

```ts
interface ReviewQueue {
  tabId: number;
  revision: number;
  nextSequence: number;
  items: Annotation[];
}

interface Annotation {
  id: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  comment: string;
  page: {
    url: string;
  };
  element: {
    tagName: string;
    id?: string;
    classes: string[];
    attributes: Record<string, string>;
    accessibleName?: string;
    visibleText?: string;
    selector: string;
    ancestorPath: string;
    html: string;
  };
  rendered: {
    bounds: { x: number; y: number; width: number; height: number };
    viewport: { width: number; height: number; devicePixelRatio: number };
    styles: Record<string, string>;
  };
  providers: {
    react?: ReactEvidence;
  };
  attachments: [];
}
```

`attachments` is empty in v1 but reserves an additive path for future screenshots. Unknown provider fields must be ignored so future adapters remain backward compatible.

## 10. Persistence and synchronization

Queues are keyed by the browser-assigned tab ID. Two tabs on the same origin have separate queues, while navigation within one tab retains that tab's feedback.

Queue data lives in `chrome.storage.session`, so it survives service-worker suspension, page reloads, and navigation in the activated tab. A `tabs.onRemoved` handler deletes the queue when its tab closes; browser-session shutdown also discards session storage.

All writes go through the extension service worker. It serializes mutations per tab, assigns monotonically increasing sequence numbers, and increments a queue revision. The sender's tab ID is taken from Chrome's trusted message metadata rather than page-controlled input.

## 11. Copy, Cut, Clear, and Undo

### 11.1 Copy

Copy serializes the latest queue revision to Markdown, writes it to the clipboard, and leaves storage unchanged.

### 11.2 Cut

Cut follows transactional semantics:

1. Snapshot the current item IDs and revision.
2. Generate and successfully write Markdown to the clipboard.
3. Ask the service worker to remove only the copied item IDs.
4. Show an Undo action for one minute containing the removed snapshot.

If clipboard writing fails, nothing is removed. If a new item is added during the clipboard operation, that new item is not cleared. Undo restores removed items using their original IDs and sequence positions without deleting newer work.

### 11.3 Clear

Clear requires confirmation and affects only the current tab's queue. It does not write to the clipboard.

## 12. Markdown export contract

The export begins with a brief instruction:

> Implement the UI feedback below. Use the rendered element evidence to locate the responsible source code; selectors and HTML describe runtime output and may not appear verbatim in the repository.

Annotations remain in chronological order and use this general structure:

````md
# UI feedback

## 1. Increase spacing above the checkout button

- Page: https://example.com/cart
- Target: `button#checkout.primary`
- Accessible name: `Complete purchase`
- Selector: `main#cart > section.summary button#checkout`
- React: `CheckoutButton > CartSummary > CartPage`
- Source hint: `src/components/CheckoutButton.tsx:42`
- Viewport: `1440 × 900 @ 2x`

### Rendered HTML

```html
<button id="checkout" class="primary">Complete purchase</button>
```

### Ancestor context

`body > main#cart > section.summary > form > button#checkout`

### Rendered style

```css
width: 240px;
height: 48px;
margin: 0;
padding: 0 16px;
background-color: rgb(15, 23, 42);
border: 1px solid rgb(15, 23, 42);
position: static;
```
````

Unavailable or empty fields are omitted. Markdown generators must escape user comments and evidence so an annotation cannot break the surrounding document structure.

## 13. Extension architecture

### 13.1 Manifest and permissions

The extension uses Manifest V3 with:

- `activeTab` access granted by an explicit toolbar or keyboard-shortcut gesture
- `scripting` permission for top-frame runtime injection after activation
- An extension service worker for storage and serialized queue mutations
- `storage` permission
- Clipboard-writing capability
- A toolbar action and extension command for toggling the panel

Iframe injection remains disabled. Kebap requests no persistent host permissions and cannot inspect a page until the user activates it for that tab.

### 13.2 Modules

- **Inspect controller:** Keyboard state, pointer targeting, ancestor navigation, and click suppression.
- **Visual layer:** Highlight, badge, panel, focus behavior, placement, and animation.
- **Generic evidence provider:** DOM, locator, accessibility, text, HTML, geometry, and style capture.
- **React evidence provider:** Isolated best-effort framework enrichment.
- **Sanitizer:** The mandatory boundary between raw page data and stored evidence.
- **Queue client:** Sends tab-scoped commands to the service worker.
- **Queue service:** Serializes mutations and persists tab-scoped session data.
- **Markdown exporter:** Deterministic, escaped, agent-oriented serialization.
- **Settings:** Inspect modifier and panel-toggle preferences.

### 13.3 Interaction states

```text
DORMANT
  └─ toolbar/command ─────────────> PANEL_OPEN (scripts injected)

IDLE
  ├─ modifier down ───────────────> INSPECTING
  └─ toolbar/command ─────────────> PANEL_OPEN

INSPECTING
  ├─ pointer move / ↑ / ↓ ────────> INSPECTING (target updated)
  ├─ click target ────────────────> COMPOSING
  └─ modifier up / blur ──────────> IDLE

COMPOSING
  ├─ Enter ───────────────────────> PANEL_OPEN (saved, fade scheduled)
  ├─ Shift+Enter ─────────────────> COMPOSING (newline)
  └─ Escape + confirmation ───────> IDLE

PANEL_OPEN
  ├─ pin ─────────────────────────> PANEL_OPEN
  ├─ fade/toggle ─────────────────> IDLE
  └─ edit/delete/copy/cut/clear ──> PANEL_OPEN
```

## 14. Error handling

- A provider failure is isolated and never prevents saving generic evidence.
- A storage failure keeps the composer open and shows an actionable error.
- A clipboard failure leaves the queue unchanged and keeps the panel open.
- A target detached during capture still produces the evidence already collected.
- Invalid or spoofed page-world React messages are ignored.
- Unsupported pages fail quietly, while the toolbar action explains that the browser prevents injection there.
- The panel indicates when the session storage limit is near rather than silently dropping annotations.

## 15. Accessibility and page compatibility

- All extension controls are keyboard reachable and have accessible names.
- Focus moves to the textarea after capture and returns sensibly after dismissal.
- Focus is not trapped because the panel is non-modal.
- Highlight and badge colors meet contrast requirements in light and dark pages.
- Page CSS cannot style extension controls through the Shadow DOM boundary.
- Event listeners are dormant outside inspect mode and avoid expensive work during normal browsing.
- Selection overlays update through scheduled animation frames to avoid pointer-move layout thrashing.

## 16. Acceptance criteria

1. After user activation on a supported generic page, holding the configured modifier highlights the correct leaf element and displays its tag badge.
2. Up and Down traverse and identify ancestors without scrolling the page.
3. Selecting a link or button does not activate it.
4. Enter saves a single-line comment; Shift+Enter saves a multiline draft without premature submission.
5. Three annotations appear and export oldest-to-newest.
6. Repeated annotations on the same target remain separate.
7. The panel avoids the selected element when at least one viable corner exists and never changes viewport dimensions.
8. Reloading or navigating within an activated tab preserves the queue.
9. Two same-origin tabs maintain independent queues.
10. Closing a tab removes its queue without affecting other tabs.
11. A browser-session restart clears any remaining queues as designed.
12. Captured evidence contains no form values, password values, scripts, inline handlers, or unredacted URL query values.
13. Visible text is normalized and visibly truncated at the configured limit.
14. React failure or absence produces a complete generic annotation without a user-facing error.
15. Copy produces valid Markdown and retains the queue.
16. Successful Cut removes only the copied items; failed Cut removes nothing; Undo restores removed items.
17. Clear confirms once and affects only the current tab.
18. Network inspection shows no requests initiated by the extension.

## 17. Deferred evolution

Likely follow-up capabilities, in approximate dependency order:

1. Clicking a queue item to re-resolve, scroll to, and highlight its target
2. Screenshot attachments and asset-aware export
3. Optional development metadata protocol for precise source locations
4. Vue, Svelte, and Angular evidence providers
5. Iframe-aware selection and coordinate translation
6. Canvas point/region annotations
7. Recoverable queues across browser restarts

Each should remain additive: generic capture, the queue contract, and Markdown export must continue to work when an optional capability is unavailable.

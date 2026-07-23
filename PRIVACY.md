# Kebap Privacy Policy

Last updated: July 22, 2026

Kebap is a local-only browser extension for capturing element-specific UI feedback and exporting it as Markdown. Kebap does not operate a server, make network requests, use analytics, show advertising, or sell or share user data.

## Data Kebap handles

When you explicitly select a page element and add a comment, Kebap may process:

- the current page URL, with sensitive query-string and fragment values redacted;
- sanitized and truncated details about the selected element, such as its selector, visible text, accessible name, rendered HTML, dimensions, and basic computed styles;
- optional React component metadata when the page exposes it; and
- the feedback comment you enter.

Kebap also stores extension preferences such as the inspection modifier key and panel fade delay.

## Storage and retention

Feedback queues are stored locally in `chrome.storage.session`, isolated by browser tab. A queue remains available through reloads and navigation in its tab and is removed when that tab closes. Preferences are stored locally in `chrome.storage.local` until you change them, remove the extension, or clear the extension's data.

## Clipboard access

Kebap writes generated Markdown to the clipboard only when you invoke a Copy or Cut action. A Cut action also clears the corresponding local queue after the clipboard write succeeds, with a short local undo period.

## Data sharing

Kebap does not transmit page content, feedback, browsing activity, or preferences to the developer or to third parties. Any Markdown you paste into another application or service is shared by your own action and is governed by that application's privacy practices.

Kebap's use of information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is handled only to provide the extension's user-facing feedback-capture and export features; it is not used for advertising, creditworthiness, or any unrelated purpose.

## Permissions

- `storage` stores local preferences and browser-session feedback queues.
- `clipboardWrite` supports user-invoked Copy and Cut actions.
- `host_permissions: <all_urls>` keeps Kebap ready on supported web pages after they load or reload. Kebap captures page details only after you explicitly select an element.
- `scripting` provides a fallback injection path for tabs that were already open when Kebap was installed or reloaded.

## Changes and contact

Material changes to this policy will be published in this repository with an updated date. Questions can be filed at <https://github.com/rkrmr33/kebap/issues>.

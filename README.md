# Kebap

<p align="center">
  <img src="assets/icons/icon-128.png" alt="Kebap logo" width="96" height="96">
</p>

Kebap is a local-only Chrome extension for capturing element-specific UI feedback and handing it to a coding agent as Markdown.

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.

Kebap requests access to all sites so holding `Alt`/`Option` can activate inspection immediately. It does not make network requests or send captured data anywhere.

## Use it

1. Hold `Alt`/`Option` and hover an element.
2. Use Up/Down while holding the modifier to navigate its ancestors.
3. Click to select without activating the page element.
4. Type a comment and press Enter. Use Shift+Enter for a newline.
5. Click the extension icon or press `Ctrl+Shift+K` (`Command+Shift+K` on macOS) to reopen the queue.
6. Copy or Cut the queue as Markdown.

The panel's **Pick** button provides a one-shot selection mode when holding a modifier is inconvenient or unavailable.

Queues are shared by tabs on the same exact origin and last until the browser session ends.

## Development

```sh
npm test
npm run check
npm run serve:fixture
```

The design specification is in [docs/design.md](docs/design.md).

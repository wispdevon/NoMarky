# NoMarky

A small Firefox and Chrome/Chromium Manifest V3 extension for YouTube.

It does two things on `youtube.com`:

- Hides recommended sidebar videos when the channel name matches the blocked creator list.
- If the current video is from a blocked creator, it tries to jump to the first non-blocked recommended video in the sidebar.

## Load it locally in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/home/wisp/Projects/NoMarky`.

## Load it temporarily in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `manifest.json` from this folder.

## Package for Firefox Add-ons

Install Mozilla's tooling, then build and lint:

```bash
npm install
npm run lint:firefox
npm run build:firefox
```

The uploadable package will be created in `web-ext-artifacts/`.

Use the extension popup to toggle blocking or auto-jump. Use the options page to edit the creator list.

## Default blocked creators

- `markiplier`
- `markipliergame`
- `markiplier highlights`
- `markiplier twitch`
- `markiplier en espanol`
- `markiplier en español`
- `unus annus`

Matching is case-insensitive and ignores accents.

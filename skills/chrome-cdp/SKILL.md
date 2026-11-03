---
name: chrome-cdp
description: Interact with local Chrome browser session (only on explicit user approval after being asked to inspect, debug, or interact with a page open in Chrome)
---

# Chrome CDP

Lightweight Chrome DevTools Protocol CLI. Connects directly via WebSocket — no Puppeteer, works with 100+ tabs, instant connection.

## Prerequisites

- Chrome (or Chromium, Brave, Edge, Vivaldi) with remote debugging enabled: open `chrome://inspect/#remote-debugging` and toggle the switch
- Node.js 22+ (uses built-in WebSocket)
- If your browser's `DevToolsActivePort` is in a non-standard location, set `CDP_PORT_FILE` to its full path

## Speed rules (read first)

Every tool call is a full model turn, which takes seconds; the CDP work itself takes milliseconds. Fewer turns = faster.

1. **Delegate mechanical work.** If you are the main agent, send concrete browser steps to the `browser` subagent ("open X, report Y" / "set A=1, B=on, save, read back") and keep the reasoning yourself. Drive the browser yourself only when the task needs judgment about what is on screen.
2. **Read-only? Skip the browser.** For public pages use `webfetch`. For logged-in pages, `nav` then one `eval` that returns `document.body.innerText` (or a targeted extract) — not a snapshot.
3. **Use refs, not selectors.** `nav` and every action already print the interactive elements with `@e` refs. Act on refs directly; never `html` the page to hunt for selectors.
4. **Don't re-snapshot after actions.** Actions print what changed. Only run `snap -i` if refs went stale.
5. **Batch.** Several fills/clicks on the same page → one `batch` call.
6. **Screenshots only for visual questions** (layout, charts, images), never to find elements.

## Commands

All commands use `scripts/cdp.mjs`. The `<target>` is a **unique** targetId prefix from `list`; copy the full prefix shown in the `list` output (for example `6BE827FA`). The CLI rejects ambiguous prefixes.

### Look

```bash
scripts/cdp.mjs list                         # open pages
scripts/cdp.mjs snap    <target> -i          # interactive elements with @refs + headings/dialogs/status
scripts/cdp.mjs snap    <target>             # full accessibility tree (refs included)
scripts/cdp.mjs eval    <target> <expr>      # evaluate JS; best for extracting text/data in one call
scripts/cdp.mjs shot    <target> [file]      # viewport screenshot; prints DPR (see Coordinates)
scripts/cdp.mjs html    <target> [selector]  # HTML — last resort, very token-heavy
scripts/cdp.mjs net     <target>             # resource timing entries
```

### Act

Each action waits for the page to settle, then prints the result: a **new page** gets its full interactive snapshot (capped at 150 lines); the **same page** gets only changed/added lines plus a removed count, or `No change in interactive elements.`

```bash
scripts/cdp.mjs nav     <target> <url>                 # navigate (waits for DOMContentLoaded + DOM settle)
scripts/cdp.mjs click   <target> <@ref|selector>       # real mouse click; JS click fallback if covered
scripts/cdp.mjs fill    <target> <@ref|selector> <text> # replace value; <select>: option value or label; "" clears
scripts/cdp.mjs press   <target> <key>                 # Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp
scripts/cdp.mjs batch   <target> '<json>'              # several actions, one observation at the end
scripts/cdp.mjs clickxy <target> <x> <y>               # click at CSS pixel coords
scripts/cdp.mjs type    <target> <text>                # Input.insertText at current focus; works in cross-origin iframes
```

`batch` example — fill a form and submit in one turn:

```bash
scripts/cdp.mjs batch <target> '[["fill","@e1","Sniper v2"],["fill","@e2","Safe"],["click","@e5"],["click","@e6"]]'
```

Batch steps: `nav`, `click`, `clickxy`, `fill`, `type`, `press`. It stops at the first failing step and says which. Only use refs you already have; refs for elements a step reveals (e.g. a menu that opens) come back in the output, so act on them in the next call.

### Other

```bash
scripts/cdp.mjs loadall <target> <selector> [ms]  # click "load more" until gone (default 1500ms between clicks)
scripts/cdp.mjs evalraw <target> <method> [json]  # raw CDP command passthrough
scripts/cdp.mjs open    [url]                      # open new tab (each triggers Allow prompt)
scripts/cdp.mjs stop    [target]                   # stop daemon(s)
```

## Refs

- `@e12` points to an exact element; refs stay stable on the same page and reset when the page navigates.
- `Unknown ref` / `Element is gone` → run `snap -i` and use the fresh refs.
- Refs cover the main frame only. Inside iframes use `clickxy` + `type`. Clickable `<div>`s without a role don't get refs — use a CSS selector with `click`.

> **Watch out:** avoid index-based selection (`querySelectorAll(...)[i]`) across multiple `eval` calls when the DOM can change between them (e.g. after clicking Ignore, card indices shift). Collect all data in one `eval` or use stable selectors.

## Coordinates

`shot` saves an image at native resolution: image pixels = CSS pixels × DPR. CDP Input events (`clickxy` etc.) take **CSS pixels**.

```
CSS px = screenshot image px / DPR
```

`shot` prints the DPR for the current page. Typical Retina (DPR=2): divide screenshot coords by 2.

## Tips

- Use `type` (not eval) to enter text in cross-origin iframes — `click`/`clickxy` to focus first, then `type`.
- Chrome shows an "Allow debugging" modal once per tab on first access. A background daemon keeps the session alive so subsequent commands need no further approval. Daemons auto-exit after 20 minutes of inactivity.

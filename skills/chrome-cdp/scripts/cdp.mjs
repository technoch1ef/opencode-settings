#!/usr/bin/env node
// cdp - lightweight Chrome DevTools Protocol CLI
// Uses raw CDP over WebSocket, no Puppeteer dependency.
// Requires Node 22+ (built-in WebSocket).
//
// Per-tab persistent daemon: page commands go through a daemon that holds
// the CDP session open. Chrome's "Allow debugging" modal fires once per
// daemon (= once per tab). Daemons auto-exit after 20min idle.

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import { spawn } from 'child_process';
import net from 'net';

const TIMEOUT = 15000;
const NAVIGATION_TIMEOUT = 30000;
const IDLE_TIMEOUT = 20 * 60 * 1000;
const DAEMON_CONNECT_RETRIES = 20;
const DAEMON_CONNECT_DELAY = 300;
const MIN_TARGET_PREFIX_LEN = 8;
const IS_WINDOWS = process.platform === 'win32';
if (!IS_WINDOWS) process.umask(0o077);
const RUNTIME_DIR = IS_WINDOWS
  ? resolve(process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local'), 'cdp')
  : process.env.XDG_RUNTIME_DIR
    ? resolve(process.env.XDG_RUNTIME_DIR, 'cdp')
    : resolve(homedir(), '.cache', 'cdp');
try { mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 }); } catch {}
const PAGES_CACHE = resolve(RUNTIME_DIR, 'pages.json');

function sockPath(targetId) {
  return IS_WINDOWS
    ? `\\\\.\\pipe\\cdp-${targetId}`
    : resolve(RUNTIME_DIR, `cdp-${targetId}.sock`);
}

function getWsUrl() {
  const home = homedir();
  // macOS: ~/Library/Application Support/<name>/DevToolsActivePort
  const macBrowsers = [
    'Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome for Testing',
    'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge',
  ];
  // Linux: ~/.config/<name>/DevToolsActivePort
  const linuxBrowsers = [
    'google-chrome', 'google-chrome-beta', 'chromium',
    'vivaldi', 'vivaldi-snapshot',
    'BraveSoftware/Brave-Browser', 'microsoft-edge',
  ];
  // Linux Flatpak: ~/.var/app/<app-id>/config/<name>/DevToolsActivePort
  const flatpakBrowsers = [
    ['org.chromium.Chromium', 'chromium'],
    ['com.google.Chrome', 'google-chrome'],
    ['com.brave.Browser', 'BraveSoftware/Brave-Browser'],
    ['com.microsoft.Edge', 'microsoft-edge'],
    ['com.vivaldi.Vivaldi', 'vivaldi'],
  ];
  const candidates = [
    process.env.CDP_PORT_FILE,
    ...macBrowsers.flatMap(b => [
      resolve(home, 'Library/Application Support', b, 'DevToolsActivePort'),
      resolve(home, 'Library/Application Support', b, 'Default/DevToolsActivePort'),
    ]),
    ...linuxBrowsers.flatMap(b => [
      resolve(home, '.config', b, 'DevToolsActivePort'),
      resolve(home, '.config', b, 'Default/DevToolsActivePort'),
    ]),
    ...flatpakBrowsers.flatMap(([appId, name]) => [
      resolve(home, '.var/app', appId, 'config', name, 'DevToolsActivePort'),
      resolve(home, '.var/app', appId, 'config', name, 'Default/DevToolsActivePort'),
    ]),
    // Windows: %LOCALAPPDATA%/<name>/User Data/DevToolsActivePort
    ...(IS_WINDOWS ? ['Google/Chrome', 'BraveSoftware/Brave-Browser', 'Microsoft/Edge'].flatMap(b => {
      const base = process.env.LOCALAPPDATA || resolve(home, 'AppData/Local');
      return [
        resolve(base, b, 'User Data/DevToolsActivePort'),
        resolve(base, b, 'User Data/Default/DevToolsActivePort'),
      ];
    }) : []),
  ].filter(Boolean);
  const portFile = candidates.find(p => existsSync(p));
  if (!portFile) throw new Error('No DevToolsActivePort found. Enable remote debugging at chrome://inspect/#remote-debugging');
  const lines = readFileSync(portFile, 'utf8').trim().split('\n');
  if (lines.length < 2 || !lines[0] || !lines[1]) throw new Error(`Invalid DevToolsActivePort file: ${portFile}`);
  const host = process.env.CDP_HOST || '127.0.0.1';
  return `ws://${host}:${lines[0]}${lines[1]}`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));


function resolvePrefix(prefix, candidates, noun = 'target', missingHint = '') {
  const upper = prefix.toUpperCase();
  const matches = candidates.filter(candidate => candidate.toUpperCase().startsWith(upper));
  if (matches.length === 0) {
    const hint = missingHint ? ` ${missingHint}` : '';
    throw new Error(`No ${noun} matching prefix "${prefix}".${hint}`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous prefix "${prefix}" — matches ${matches.length} ${noun}s. Use more characters.`);
  }
  return matches[0];
}

function getDisplayPrefixLength(targetIds) {
  if (targetIds.length === 0) return MIN_TARGET_PREFIX_LEN;
  const maxLen = Math.max(...targetIds.map(id => id.length));
  for (let len = MIN_TARGET_PREFIX_LEN; len <= maxLen; len++) {
    const prefixes = new Set(targetIds.map(id => id.slice(0, len).toUpperCase()));
    if (prefixes.size === targetIds.length) return len;
  }
  return maxLen;
}

// ---------------------------------------------------------------------------
// CDP WebSocket client
// ---------------------------------------------------------------------------

class CDP {
  #ws; #id = 0; #pending = new Map(); #eventHandlers = new Map(); #closeHandlers = [];

  async connect(wsUrl) {
    return new Promise((res, rej) => {
      this.#ws = new WebSocket(wsUrl);
      this.#ws.onopen = () => res();
      this.#ws.onerror = (e) => rej(new Error('WebSocket error: ' + (e.message || e.type)));
      this.#ws.onclose = () => this.#closeHandlers.forEach(h => h());
      this.#ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.#pending.has(msg.id)) {
          const { resolve, reject } = this.#pending.get(msg.id);
          this.#pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        } else if (msg.method && this.#eventHandlers.has(msg.method)) {
          for (const handler of [...this.#eventHandlers.get(msg.method)]) {
            handler(msg.params || {}, msg);
          }
        }
      };
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.#ws.send(JSON.stringify(msg));
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`Timeout: ${method}`));
        }
      }, TIMEOUT);
    });
  }

  onEvent(method, handler) {
    if (!this.#eventHandlers.has(method)) this.#eventHandlers.set(method, new Set());
    const handlers = this.#eventHandlers.get(method);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.#eventHandlers.delete(method);
    };
  }

  waitForEvent(method, timeout = TIMEOUT) {
    let settled = false;
    let off;
    let timer;
    const promise = new Promise((resolve, reject) => {
      off = this.onEvent(method, (params) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(params);
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        reject(new Error(`Timeout waiting for event: ${method}`));
      }, timeout);
    });
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off?.();
      },
    };
  }

  onClose(handler) { this.#closeHandlers.push(handler); }
  close() { this.#ws.close(); }
}

// ---------------------------------------------------------------------------
// Command implementations — return strings, take (cdp, sessionId)
// ---------------------------------------------------------------------------

async function getPages(cdp) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  return targetInfos.filter(t => t.type === 'page' && !t.url.startsWith('chrome://'));
}

function formatPageList(pages) {
  const prefixLen = getDisplayPrefixLength(pages.map(p => p.targetId));
  return pages.map(p => {
    const id = p.targetId.slice(0, prefixLen).padEnd(prefixLen);
    const title = p.title.substring(0, 54).padEnd(54);
    return `${id}  ${title}  ${p.url}`;
  }).join('\n');
}

function shouldShowAxNode(node, compact = false) {
  const role = node.role?.value || '';
  const name = node.name?.value ?? '';
  const value = node.value?.value;
  if (compact && role === 'InlineTextBox') return false;
  return role !== 'none' && role !== 'generic' && !(name === '' && (value === '' || value == null));
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider',
  'spinbutton', 'listbox', 'treeitem',
]);
// Shown without a ref in interactive snapshots, for orientation.
const CONTEXT_ROLES = new Set(['heading', 'dialog', 'alertdialog', 'alert', 'status']);
const STATE_PROPS = new Set(['checked', 'selected', 'expanded', 'pressed', 'disabled', 'required']);
const OBSERVE_MAX_LINES = 150;
const SETTLE_QUIET_MS = 300;
const SETTLE_MAX_MS = 1500;

// Refs (@e1, @e2…) map to backendDOMNodeIds; they stay stable within a
// document and reset when the main frame navigates.
function refFor(refs, backendId) {
  let ref = refs.byBackend.get(backendId);
  if (!ref) {
    ref = `e${++refs.n}`;
    refs.byBackend.set(backendId, ref);
    refs.byRef.set(ref, backendId);
  }
  return ref;
}

function axState(node) {
  const out = [];
  for (const p of node.properties || []) {
    const v = p.value?.value;
    if (!STATE_PROPS.has(p.name) || !v || v === 'false') continue;
    out.push(v === true || v === 'true' ? p.name : `${p.name}=${v}`);
  }
  return out.length ? ` (${out.join(', ')})` : '';
}

function formatAxNode(node, depth, refs) {
  const role = node.role?.value || '';
  const name = node.name?.value ?? '';
  const value = node.value?.value;
  const indent = '  '.repeat(Math.min(depth, 10));
  const ref = refs && INTERACTIVE_ROLES.has(role) && node.backendDOMNodeId
    ? `@${refFor(refs, node.backendDOMNodeId)} ` : '';
  let line = `${indent}${ref}[${role}]`;
  if (name !== '') line += ` ${name}`;
  if (!(value === '' || value == null)) line += ` = ${JSON.stringify(value)}`;
  return line + axState(node);
}

function orderedAxChildren(node, nodesById, childrenByParent) {
  const children = [];
  const seen = new Set();
  for (const childId of node.childIds || []) {
    const child = nodesById.get(childId);
    if (child && !seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  for (const child of childrenByParent.get(node.nodeId) || []) {
    if (!seen.has(child.nodeId)) {
      seen.add(child.nodeId);
      children.push(child);
    }
  }
  return children;
}

// AX nodes in document order, as [node, depth] pairs
function axInOrder(nodes) {
  const nodesById = new Map(nodes.map(node => [node.nodeId, node]));
  const childrenByParent = new Map();
  for (const node of nodes) {
    if (!node.parentId) continue;
    if (!childrenByParent.has(node.parentId)) childrenByParent.set(node.parentId, []);
    childrenByParent.get(node.parentId).push(node);
  }

  const out = [];
  const visited = new Set();
  function visit(node, depth) {
    if (!node || visited.has(node.nodeId)) return;
    visited.add(node.nodeId);
    out.push([node, depth]);
    for (const child of orderedAxChildren(node, nodesById, childrenByParent)) {
      visit(child, depth + 1);
    }
  }

  const roots = nodes.filter(node => !node.parentId || !nodesById.has(node.parentId));
  for (const root of roots) visit(root, 0);
  for (const node of nodes) visit(node, 0);
  return out;
}

async function snapshotStr(cdp, sid, refs) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree', {}, sid);
  return axInOrder(nodes)
    .filter(([node]) => shouldShowAxNode(node, true))
    .map(([node, depth]) => formatAxNode(node, depth, refs))
    .join('\n');
}

// shortcut: main frame only (AX tree skips iframe content), use clickxy/type inside iframes.
async function interactiveLines(cdp, sid, refs) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree', {}, sid);
  const ordered = axInOrder(nodes);
  const lines = [];
  ordered.forEach(([node, depth], i) => {
    if (node.ignored) return;
    const role = node.role?.value || '';
    if (INTERACTIVE_ROLES.has(role)) {
      if (node.backendDOMNodeId) lines.push(formatAxNode(node, 0, refs));
    } else if ((role === 'status' || role === 'alert') && !node.name?.value) {
      // Live regions (toasts, "Saved") carry their message as text, not a name
      const text = [];
      for (let j = i + 1; j < ordered.length && ordered[j][1] > depth; j++) {
        if (ordered[j][0].role?.value === 'StaticText') text.push(ordered[j][0].name?.value ?? '');
      }
      if (text.join('').trim()) lines.push(`[${role}] ${text.join(' ').trim()}`);
    } else if (CONTEXT_ROLES.has(role) && shouldShowAxNode(node, true)) {
      lines.push(formatAxNode(node, 0, refs));
    }
  });
  return lines;
}

function capLines(lines) {
  if (lines.length <= OBSERVE_MAX_LINES) return lines.join('\n');
  return [...lines.slice(0, OBSERVE_MAX_LINES),
    `… ${lines.length - OBSERVE_MAX_LINES} more — run snap -i for all`].join('\n');
}

async function resolveBackendId(cdp, sid, refs, target) {
  if (!target) throw new Error('@ref or CSS selector required');
  if (target.startsWith('@')) {
    const id = refs.byRef.get(target.slice(1));
    if (!id) throw new Error(`Unknown ref ${target} — run snap -i again`);
    return id;
  }
  const res = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(target)})`,
  }, sid);
  if (res.exceptionDetails) throw new Error(`Bad selector: ${target}`);
  if (!res.result.objectId) throw new Error(`Element not found: ${target}`);
  const { node } = await cdp.send('DOM.describeNode', { objectId: res.result.objectId }, sid);
  return node.backendNodeId;
}

// Call `fn` (a function source string) with `this` bound to the element
async function callOn(cdp, sid, backendNodeId, fn, args = []) {
  let object;
  try {
    ({ object } = await cdp.send('DOM.resolveNode', { backendNodeId }, sid));
  } catch {
    throw new Error('Element is gone (page changed) — run snap -i again');
  }
  const res = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId, functionDeclaration: fn,
    arguments: args.map(value => ({ value })), returnByValue: true,
  }, sid);
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  }
  return res.result.value;
}

// Wait until the DOM stops mutating (or SETTLE_MAX_MS passes)
async function settle(cdp, sid) {
  await evalStr(cdp, sid, `new Promise(resolve => {
    const done = () => { mo.disconnect(); clearTimeout(t); clearTimeout(cap); resolve(true); };
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, ${SETTLE_QUIET_MS}); });
    let t = setTimeout(done, ${SETTLE_QUIET_MS});
    const cap = setTimeout(done, ${SETTLE_MAX_MS});
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  })`).catch(() => {});
}

// Run an action, wait for the page to react, and report what changed in the
// interactive snapshot, so the agent needs no separate snap turn.
async function act(cdp, sid, refs, fn) {
  const before = await interactiveLines(cdp, sid, refs).catch(() => []);
  const urlBefore = await evalStr(cdp, sid, 'location.href').catch(() => '');
  const { frameTree } = await cdp.send('Page.getFrameTree', {}, sid);
  const mainFrame = frameTree.frame.id;

  let navigating = false;
  let loaded;
  const loadedPromise = new Promise(r => { loaded = r; });
  const offs = [
    cdp.onEvent('Page.frameStartedLoading', p => { if (p.frameId === mainFrame) navigating = true; }),
    cdp.onEvent('Page.domContentEventFired', () => loaded()),
    // Fires for aborted navigations and downloads, which never reach DCL
    cdp.onEvent('Page.frameStoppedLoading', p => { if (p.frameId === mainFrame) loaded(); }),
  ];

  let result;
  try {
    result = await fn();
    await sleep(150);
    if (navigating) await Promise.race([loadedPromise, sleep(NAVIGATION_TIMEOUT)]);
  } finally {
    offs.forEach(off => off());
  }
  await settle(cdp, sid);
  return `${result}\n${await observe(cdp, sid, refs, before, urlBefore)}`;
}

async function observe(cdp, sid, refs, before, urlBefore) {
  const [title, url] = JSON.parse(await evalStr(cdp, sid, 'JSON.stringify([document.title, location.href])'));
  const after = await interactiveLines(cdp, sid, refs);
  if (url !== urlBefore) return `Page: ${title} — ${url}\n${capLines(after)}`;
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter(line => !beforeSet.has(line));
  const removed = before.filter(line => !afterSet.has(line)).length;
  if (!added.length && !removed) return 'No change in interactive elements.';
  return `Changes: +${added.length} -${removed}\n${capLines(added)}`;
}

async function evalStr(cdp, sid, expression) {
  await cdp.send('Runtime.enable', {}, sid);
  const result = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sid);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description);
  }
  const val = result.result.value;
  return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '');
}

async function shotStr(cdp, sid, filePath, targetId) {
  // Get device scale factor so we can report coordinate mapping
  let dpr = 1;
  try {
    const metrics = await cdp.send('Page.getLayoutMetrics', {}, sid);
    dpr = metrics.visualViewport?.clientWidth
      ? metrics.cssVisualViewport?.clientWidth
        ? Math.round((metrics.visualViewport.clientWidth / metrics.cssVisualViewport.clientWidth) * 100) / 100
        : 1
      : 1;
    // Simpler: deviceScaleFactor is on the root Page metrics
    const { deviceScaleFactor } = await cdp.send('Emulation.getDeviceMetricsOverride', {}, sid).catch(() => ({}));
    if (deviceScaleFactor) dpr = deviceScaleFactor;
  } catch {}
  // Fallback: try to get DPR from JS
  if (dpr === 1) {
    try {
      const raw = await evalStr(cdp, sid, 'window.devicePixelRatio');
      const parsed = parseFloat(raw);
      if (parsed > 0) dpr = parsed;
    } catch {}
  }

  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sid);
  const out = filePath || resolve(RUNTIME_DIR, `screenshot-${(targetId || 'unknown').slice(0, 8)}.png`);
  writeFileSync(out, Buffer.from(data, 'base64'));

  const lines = [out];
  lines.push(`Screenshot saved. Device pixel ratio (DPR): ${dpr}`);
  lines.push(`Coordinate mapping:`);
  lines.push(`  Screenshot pixels → CSS pixels (for CDP Input events): divide by ${dpr}`);
  lines.push(`  e.g. screenshot point (${Math.round(100 * dpr)}, ${Math.round(200 * dpr)}) → CSS (100, 200) → use clickxy <target> 100 200`);
  if (dpr !== 1) {
    lines.push(`  On this ${dpr}x display: CSS px = screenshot px / ${dpr} ≈ screenshot px × ${Math.round(100/dpr)/100}`);
  }
  return lines.join('\n');
}

async function htmlStr(cdp, sid, selector) {
  const expr = selector
    ? `document.querySelector(${JSON.stringify(selector)})?.outerHTML || 'Element not found'`
    : `document.documentElement.outerHTML`;
  return evalStr(cdp, sid, expr);
}

async function navStr(cdp, sid, url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      throw new Error(`Only http/https URLs allowed, got: ${url}`);
  } catch (e) {
    if (e.message.startsWith('Only')) throw e;
    throw new Error(`Invalid URL: ${url}`);
  }
  await cdp.send('Page.enable', {}, sid);
  // DOMContentLoaded, not load: act() then waits for the DOM to settle,
  // which skips waiting on ads/trackers/images.
  const domReady = cdp.waitForEvent('Page.domContentEventFired', NAVIGATION_TIMEOUT);
  const result = await cdp.send('Page.navigate', { url }, sid);
  if (result.errorText) {
    domReady.cancel();
    throw new Error(result.errorText);
  }
  if (result.loaderId) {
    await domReady.promise;
  } else {
    domReady.cancel();
  }
  return `Navigated to ${url}`;
}

async function netStr(cdp, sid) {
  const raw = await evalStr(cdp, sid, `JSON.stringify(performance.getEntriesByType('resource').map(e => ({
    name: e.name.substring(0, 120), type: e.initiatorType,
    duration: Math.round(e.duration), size: e.transferSize
  })))`);
  return JSON.parse(raw).map(e =>
    `${String(e.duration).padStart(5)}ms  ${String(e.size || '?').padStart(8)}B  ${e.type.padEnd(8)}  ${e.name}`
  ).join('\n');
}

// Click element by @ref or CSS selector. Uses real mouse events (so
// pointerdown-driven menus work), falling back to el.click() when the
// element is covered or has no box.
async function clickStr(cdp, sid, refs, target) {
  const backendNodeId = await resolveBackendId(cdp, sid, refs, target);
  const label = await callOn(cdp, sid, backendNodeId, `function() {
    this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const text = (this.innerText || this.value || this.getAttribute('aria-label') || '').trim();
    return '<' + this.tagName + '> "' + text.substring(0, 80) + '"';
  }`);
  let point;
  try {
    const { quads } = await cdp.send('DOM.getContentQuads', { backendNodeId }, sid);
    const q = quads[0];
    if (q) point = { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
  } catch {}
  const hit = point && await callOn(cdp, sid, backendNodeId, `function(x, y) {
    const e = this.getRootNode().elementFromPoint(x, y);
    return !!e && (e === this || this.contains(e) || e.contains(this));
  }`, [point.x, point.y]);
  if (hit) {
    await clickXyStr(cdp, sid, point.x, point.y);
    return `Clicked ${label}`;
  }
  await callOn(cdp, sid, backendNodeId, 'function() { this.click(); }');
  return `Clicked ${label} (JS click: element covered or not rendered)`;
}

// Replace a field's value (or pick a <select> option by value or label)
async function fillStr(cdp, sid, refs, target, text = '') {
  const backendNodeId = await resolveBackendId(cdp, sid, refs, target);
  const kind = await callOn(cdp, sid, backendNodeId, `function(text) {
    this.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (this.tagName === 'SELECT') {
      const opt = [...this.options].find(o => o.value === text || o.text.trim() === text);
      if (!opt) return 'no-option';
      this.value = opt.value;
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
      return 'select';
    }
    this.focus();
    if (typeof this.select === 'function') this.select();
    else if (this.isContentEditable) getSelection().selectAllChildren(this);
    return 'text';
  }`, [text]);
  if (kind === 'no-option') throw new Error(`No option "${text}" in ${target}`);
  if (kind === 'select') return `Selected "${text}" in ${target}`;
  // insertText replaces the selection and fires real input events (React-safe)
  if (text) await cdp.send('Input.insertText', { text }, sid);
  else await pressStr(cdp, sid, 'Backspace');
  return `Filled ${target}`;
}

const KEYS = {
  Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''], Backspace: [8, ''],
  ArrowDown: [40, ''], ArrowUp: [38, ''],
};

async function pressStr(cdp, sid, key) {
  const k = KEYS[key];
  if (!k) throw new Error(`Unsupported key "${key}" (use ${Object.keys(KEYS).join(', ')})`);
  const [keyCode, text] = k;
  const base = { key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', ...(text && { text }) }, sid);
  await cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' }, sid);
  return `Pressed ${key}`;
}

// Run several actions in one call; JSON array of [cmd, ...args]
async function batchStr(cdp, sid, actions, json) {
  let steps;
  try { steps = JSON.parse(json); } catch { steps = null; }
  if (!Array.isArray(steps) || !steps.every(Array.isArray)) {
    throw new Error('batch expects a JSON array of [cmd, ...args], e.g. [["fill","@e3","hi"],["click","@e4"]]');
  }
  const log = [];
  for (const [cmd, ...args] of steps) {
    const step = actions[cmd];
    try {
      if (!step) throw new Error(`unsupported in batch (use ${Object.keys(actions).join(', ')})`);
      log.push(await step(...args));
    } catch (e) {
      log.push(`✗ Step ${log.length + 1} (${cmd}) failed: ${e.message}. Remaining steps skipped.`);
      break;
    }
    await settle(cdp, sid);
  }
  return log.join('\n');
}

// Click at CSS pixel coordinates using Input.dispatchMouseEvent
async function clickXyStr(cdp, sid, x, y) {
  const cx = parseFloat(x);
  const cy = parseFloat(y);
  if (isNaN(cx) || isNaN(cy)) throw new Error('x and y must be numbers (CSS pixels)');
  const base = { x: cx, y: cy, button: 'left', clickCount: 1, modifiers: 0 };
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved' }, sid);
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' }, sid);
  await sleep(50);
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' }, sid);
  return `Clicked at CSS (${cx}, ${cy})`;
}

// Type text using Input.insertText (works in cross-origin iframes, unlike eval)
async function typeStr(cdp, sid, text) {
  if (text == null || text === '') throw new Error('text required');
  await cdp.send('Input.insertText', { text }, sid);
  return `Typed ${text.length} characters`;
}

// Load-more: repeatedly click a button/selector until it disappears
async function loadAllStr(cdp, sid, selector, intervalMs = 1500) {
  if (!selector) throw new Error('CSS selector required');
  let clicks = 0;
  const deadline = Date.now() + 5 * 60 * 1000; // 5-minute hard cap
  while (Date.now() < deadline) {
    const exists = await evalStr(cdp, sid,
      `!!document.querySelector(${JSON.stringify(selector)})`
    );
    if (exists !== 'true') break;
    const clickExpr = `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      })()
    `;
    const clicked = await evalStr(cdp, sid, clickExpr);
    if (clicked !== 'true') break;
    clicks++;
    await sleep(intervalMs);
  }
  return `Clicked "${selector}" ${clicks} time(s) until it disappeared`;
}

// Send a raw CDP command and return the result as JSON
async function evalRawStr(cdp, sid, method, paramsJson) {
  if (!method) throw new Error('CDP method required (e.g. "DOM.getDocument")');
  let params = {};
  if (paramsJson) {
    try { params = JSON.parse(paramsJson); }
    catch { throw new Error(`Invalid JSON params: ${paramsJson}`); }
  }
  const result = await cdp.send(method, params, sid);
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Per-tab daemon
// ---------------------------------------------------------------------------

async function runDaemon(targetId) {
  const sp = sockPath(targetId);

  const cdp = new CDP();
  try {
    await cdp.connect(getWsUrl());
  } catch (e) {
    process.stderr.write(`Daemon: cannot connect to Chrome: ${e.message}\n`);
    process.exit(1);
  }

  let sessionId;
  try {
    const res = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = res.sessionId;
  } catch (e) {
    process.stderr.write(`Daemon: attach failed: ${e.message}\n`);
    cdp.close();
    process.exit(1);
  }

  // Shutdown helpers
  let alive = true;
  function shutdown() {
    if (!alive) return;
    alive = false;
    server.close();
    if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
    cdp.close();
    process.exit(0);
  }

  // Exit if target goes away or Chrome disconnects
  cdp.onEvent('Target.targetDestroyed', (params) => {
    if (params.targetId === targetId) shutdown();
  });
  cdp.onEvent('Target.detachedFromTarget', (params) => {
    if (params.sessionId === sessionId) shutdown();
  });
  cdp.onClose(() => shutdown());
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Element refs, reset when the main frame navigates to a new document
  const refs = { byBackend: new Map(), byRef: new Map(), n: 0 };
  cdp.onEvent('Page.frameNavigated', ({ frame }) => {
    if (frame.parentId) return;
    refs.byBackend.clear(); refs.byRef.clear(); refs.n = 0;
  });
  await cdp.send('Page.enable', {}, sessionId).catch(() => {});

  // Commands that run through act() and report what changed
  const actions = {
    nav: (url) => navStr(cdp, sessionId, url),
    click: (target) => clickStr(cdp, sessionId, refs, target),
    clickxy: (x, y) => clickXyStr(cdp, sessionId, x, y),
    fill: (target, text) => fillStr(cdp, sessionId, refs, target, text),
    type: (text) => typeStr(cdp, sessionId, text),
    press: (key) => pressStr(cdp, sessionId, key),
  };
  actions.navigate = actions.nav;

  // Idle timer
  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
  }

  // Handle a command
  async function handleCommand({ cmd, args }) {
    resetIdle();
    try {
      let result;
      switch (cmd) {
        case 'list': {
          const pages = await getPages(cdp);
          result = formatPageList(pages);
          break;
        }
        case 'list_raw': {
          const pages = await getPages(cdp);
          result = JSON.stringify(pages);
          break;
        }
        case 'snap': case 'snapshot':
          result = ['-i', '--interactive'].includes(args[0])
            ? (await interactiveLines(cdp, sessionId, refs)).join('\n')
            : await snapshotStr(cdp, sessionId, refs);
          break;
        case 'eval': result = await evalStr(cdp, sessionId, args[0]); break;
        case 'shot': case 'screenshot': result = await shotStr(cdp, sessionId, args[0], targetId); break;
        case 'html': result = await htmlStr(cdp, sessionId, args[0]); break;
        case 'net': case 'network': result = await netStr(cdp, sessionId); break;
        case 'nav': case 'navigate': case 'click': case 'clickxy': case 'fill': case 'type': case 'press':
          result = await act(cdp, sessionId, refs, () => actions[cmd](...args));
          break;
        case 'batch': result = await act(cdp, sessionId, refs, () => batchStr(cdp, sessionId, actions, args[0])); break;
        case 'loadall': result = await loadAllStr(cdp, sessionId, args[0], args[1] ? parseInt(args[1]) : 1500); break;
        case 'evalraw': result = await evalRawStr(cdp, sessionId, args[0], args[1]); break;
        case 'stop': return { ok: true, result: '', stopAfter: true };
        default: return { ok: false, error: `Unknown command: ${cmd}` };
      }
      return { ok: true, result: result ?? '' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Unix socket server — NDJSON protocol
  // Wire format: each message is one JSON object followed by \n (newline-delimited JSON).
  // Request:  { "id": <number>, "cmd": "<command>", "args": ["arg1", "arg2", ...] }
  // Response: { "id": <number>, "ok": <boolean>, "result": "<string>" }
  //           or { "id": <number>, "ok": false, "error": "<message>" }
  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        if (!line.trim()) continue;
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          conn.write(JSON.stringify({ ok: false, error: 'Invalid JSON request', id: null }) + '\n');
          continue;
        }
        handleCommand(req).then((res) => {
          const payload = JSON.stringify({ ...res, id: req.id }) + '\n';
          if (res.stopAfter) conn.end(payload, shutdown);
          else conn.write(payload);
        });
      }
    });
  });

  server.on('error', (e) => {
    process.stderr.write(`Daemon server listen failed: ${e.message}\n`);
    process.exit(1);
  });

  if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
  server.listen(sp);
}

// ---------------------------------------------------------------------------
// CLI ↔ daemon communication
// ---------------------------------------------------------------------------

function connectToSocket(sp) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sp);
    conn.on('connect', () => resolve(conn));
    conn.on('error', reject);
  });
}

async function getOrStartTabDaemon(targetId) {
  const sp = sockPath(targetId);
  // Try existing daemon
  try { return await connectToSocket(sp); } catch {}

  // Clean stale socket
  if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}

  // Spawn daemon
  const child = spawn(process.execPath, [process.argv[1], '_daemon', targetId], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for socket (includes time for user to click Allow)
  for (let i = 0; i < DAEMON_CONNECT_RETRIES; i++) {
    await sleep(DAEMON_CONNECT_DELAY);
    try { return await connectToSocket(sp); } catch {}
  }
  throw new Error('Daemon failed to start — did you click Allow in Chrome?');
}

function sendCommand(conn, req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;

    const cleanup = () => {
      conn.off('data', onData);
      conn.off('error', onError);
      conn.off('end', onEnd);
      conn.off('close', onClose);
    };

    const onData = (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      settled = true;
      cleanup();
      resolve(JSON.parse(buf.slice(0, idx)));
      conn.end();
    };

    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Connection closed before response'));
    };

    const onClose = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Connection closed before response'));
    };

    conn.on('data', onData);
    conn.on('error', onError);
    conn.on('end', onEnd);
    conn.on('close', onClose);
    req.id = 1;
    conn.write(JSON.stringify(req) + '\n');
  });
}

// ---------------------------------------------------------------------------
// Stop daemons
// ---------------------------------------------------------------------------

async function stopDaemons(targetPrefix) {
  if (!existsSync(PAGES_CACHE)) return;
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const targets = targetPrefix
    ? [resolvePrefix(targetPrefix, pages.map(p => p.targetId), 'target')]
    : pages.map(p => p.targetId);

  for (const targetId of targets) {
    const sp = sockPath(targetId);
    try {
      const conn = await connectToSocket(sp);
      await sendCommand(conn, { cmd: 'stop' });
    } catch {
      if (!IS_WINDOWS) try { unlinkSync(sp); } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `cdp - lightweight Chrome DevTools Protocol CLI (no Puppeteer)

Usage: cdp <command> [args]

  list                              List open pages (shows unique target prefixes)
  snap  <target> [-i]               Accessibility tree snapshot; interactive elements get
                                    @refs. -i: only interactive elements + headings/dialogs
  eval  <target> <expr>             Evaluate JS expression
  shot  <target> [file]             Screenshot (default: screenshot-<target>.png in runtime dir); prints coordinate mapping
  html  <target> [selector]         Get HTML (full page or CSS selector)
  net   <target>                    Network performance entries

  Actions — each waits for the page to settle, then prints what changed
  (new page: full interactive snapshot; same page: added lines + removed count):
  nav     <target> <url>            Navigate to URL (waits for DOMContentLoaded)
  click   <target> <@ref|selector>  Click an element (real mouse events)
  fill    <target> <@ref|selector> <text>
                                    Replace a field's value; for <select>, pick option by value or label
  press   <target> <key>            Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp
  clickxy <target> <x> <y>          Click at CSS pixel coordinates (see coordinate note below)
  type    <target> <text>           Type text at current focus via Input.insertText
                                    Works in cross-origin iframes unlike eval-based approaches
  batch   <target> <json>           Run several actions in one call, observe once at the end
                                    e.g. batch <t> '[["fill","@e3","bob"],["fill","@e4","hi"],["click","@e5"]]'

  loadall <target> <selector> [ms]  Repeatedly click a "load more" button until it disappears
                                    Optional interval in ms between clicks (default 1500)
  evalraw <target> <method> [json]  Send a raw CDP command; returns JSON result
                                    e.g. evalraw <t> "DOM.getDocument" '{}'
  open  [url]                       Open a new tab (default: about:blank)
                                    Note: each new tab triggers a fresh "Allow debugging?" prompt
  stop  [target]                    Stop daemon(s)

<target> is a unique targetId prefix from "cdp list". If a prefix is ambiguous,
use more characters.

COORDINATE SYSTEM
  shot captures the viewport at the device's native resolution.
  The screenshot image size = CSS pixels × DPR (device pixel ratio).
  For CDP Input events (clickxy, etc.) you need CSS pixels, not image pixels.

    CSS pixels = screenshot image pixels / DPR

  shot prints the DPR and an example conversion for the current page.
  Typical Retina (DPR=2): CSS px ≈ screenshot px × 0.5
  If your viewer rescales the image further, account for that scaling too.

EVAL SAFETY NOTE
  Avoid index-based DOM selection (querySelectorAll(...)[i]) across multiple
  eval calls when the list can change between calls (e.g. after clicking
  "Ignore" buttons on a feed — indices shift). Prefer stable selectors or
  collect all data in a single eval.

DAEMON IPC (for advanced use / scripting)
  Each tab runs a persistent daemon at Unix socket in the runtime dir (see below).
  Protocol: newline-delimited JSON (one JSON object per line, UTF-8).
    Request:  {"id":<number>, "cmd":"<command>", "args":["arg1","arg2",...]}
    Response: {"id":<number>, "ok":true,  "result":"<string>"}
           or {"id":<number>, "ok":false, "error":"<message>"}
  Commands mirror the CLI: snap, eval, shot, html, nav, net, click, clickxy,
  fill, press, type, batch, loadall, evalraw, stop. Use evalraw to send arbitrary CDP methods.
  The socket disappears after 20 min of inactivity or when the tab closes.
`;

const NEEDS_TARGET = new Set([
  'snap','snapshot','eval','shot','screenshot','html','nav','navigate',
  'net','network','click','clickxy','type','loadall','evalraw','fill','press','batch',
]);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  // Daemon mode (internal)
  if (cmd === '_daemon') { await runDaemon(args[0]); return; }

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE); process.exit(0);
  }

  if (cmd === 'list' || cmd === 'ls') {
    const cdp = new CDP();
    await cdp.connect(getWsUrl());
    const pages = await getPages(cdp);
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    console.log(formatPageList(pages));
    setTimeout(() => process.exit(0), 100);
    return;
  }

  // Open new tab
  if (cmd === 'open') {
    const url = args[0] || 'about:blank';
    const cdp = new CDP();
    await cdp.connect(getWsUrl());
    const { targetId } = await cdp.send('Target.createTarget', { url });
    // Refresh cache; new tab may not appear in getTargets immediately, so add it manually
    const pages = await getPages(cdp);
    if (!pages.some(p => p.targetId === targetId)) {
      pages.push({ targetId, title: url, url });
    }
    cdp.close();
    writeFileSync(PAGES_CACHE, JSON.stringify(pages), { mode: 0o600 });
    console.log(`Opened new tab: ${targetId.slice(0, 8)}  ${url}`);
    console.log('Note: this tab will need "Allow debugging?" approval on first access.');
    return;
  }

  // Stop
  if (cmd === 'stop') {
    await stopDaemons(args[0]);
    return;
  }

  // Page commands — need target prefix
  if (!NEEDS_TARGET.has(cmd)) {
    console.error(`Unknown command: ${cmd}\n`);
    console.log(USAGE);
    process.exit(1);
  }

  const targetPrefix = args[0];
  if (!targetPrefix) {
    console.error('Error: target ID required. Run "cdp list" first.');
    process.exit(1);
  }

  // Resolve prefix → full targetId from pages cache
  if (!existsSync(PAGES_CACHE)) {
    console.error('No page list cached. Run "cdp list" first.');
    process.exit(1);
  }
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const targetId = resolvePrefix(targetPrefix, pages.map(p => p.targetId), 'target', 'Run "cdp list".');

  const conn = await getOrStartTabDaemon(targetId);

  const cmdArgs = args.slice(1);

  if (cmd === 'eval') {
    const expr = cmdArgs.join(' ');
    if (!expr) { console.error('Error: expression required'); process.exit(1); }
    cmdArgs[0] = expr;
  } else if (cmd === 'type' || cmd === 'batch') {
    // Join all remaining args (allows spaces)
    const text = cmdArgs.join(' ');
    if (!text) { console.error(`Error: ${cmd === 'batch' ? 'JSON steps' : 'text'} required`); process.exit(1); }
    cmdArgs.length = 0;
    cmdArgs.push(text);
  } else if (cmd === 'fill') {
    if (!cmdArgs[0]) { console.error('Error: @ref or selector required'); process.exit(1); }
    cmdArgs.splice(1, cmdArgs.length, cmdArgs.slice(1).join(' '));
  } else if (cmd === 'evalraw') {
    // args: [method, ...jsonParts] — join json parts in case of spaces
    if (!cmdArgs[0]) { console.error('Error: CDP method required'); process.exit(1); }
    if (cmdArgs.length > 2) cmdArgs[1] = cmdArgs.slice(1).join(' ');
  }

  if ((cmd === 'nav' || cmd === 'navigate') && !cmdArgs[0]) {
    console.error('Error: URL required');
    process.exit(1);
  }

  const response = await sendCommand(conn, { cmd, args: cmdArgs });

  if (response.ok) {
    if (response.result) console.log(response.result);
  } else {
    console.error('Error:', response.error);
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });

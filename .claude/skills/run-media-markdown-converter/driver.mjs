// REPL driver for media-markdown-converter (Electron desktop app).
// Run on a machine with a real or virtual X display.
// Designed for agents: wrap in tmux, send-keys commands, capture-pane output.
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

let app = null;
let page = null;

const electronBin = process.platform === 'darwin'
  ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(APP_DIR, 'node_modules/electron/dist/electron');

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    if (!fs.existsSync(path.join(APP_DIR, 'dist', 'index.html'))) {
      console.log('ERROR: dist/index.html missing — run the Build step first (tsc && vite build)');
      return;
    }
    app = await electron.launch({
      executablePath: electronBin,
      args: ['--no-sandbox', APP_DIR],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
      timeout: 30_000,
    });
    page = await app.firstWindow();
    // No splash screen / BrowserView in this app — firstWindow() is the
    // real UI. Still worth a settle delay: the renderer's useEffect config
    // load (loadConfig() over IPC) races the first paint.
    await page.waitForSelector('.top-bar', { timeout: 10_000 }).catch(() => {});
    console.log('launched.', app.windows().length, 'window(s):');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  // DOM click, not locator.click() — this app's window is a single
  // BrowserWindow with no overlay, so coordinate-based clicks would also
  // work here, but DOM click is more robust to layout/zoom and matches
  // what worked when this driver was built.
  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(t => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const el = els.find(e => e.textContent?.trim() === t)
              ?? els.find(e => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK: ' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
  },

  // Set a <select>'s value via the native setter + a real 'change' event —
  // React only picks up programmatic <select> changes this way, plain
  // .value = x does not fire its onChange handler.
  async select(args) {
    if (!page) return console.log('ERROR: launch first');
    const [sel, ...rest] = args.split(/\s+/);
    const value = rest.join(' ');
    const r = await page.evaluate(({ sel, value }) => {
      const el = document.querySelector(sel);
      if (!el) return 'NOT_FOUND';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'OK: ' + el.value;
    }, { sel, value });
    console.log('select', sel, value, '→', r);
  },

  async type(text)  { if (page) await page.keyboard.type(text, { delay: 30 }); },
  async press(key)  { if (page) await page.keyboard.press(key); },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try { await page.waitForSelector(sel, { timeout: 10_000 }); console.log('found:', sel); }
    catch { console.log('TIMEOUT:', sel); }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(
      s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null));
  },

  // Feed a file into react-dropzone's hidden <input type="file"> — this is
  // how to test the upload flow without real OS drag-drop, which Playwright
  // can't synthesize for _electron.
  async setfile(filePath) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.setInputFiles('input[type="file"]', filePath);
      console.log('setfile', filePath, '→ OK');
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(() => {}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

// Stop Electron from stealing stdin — use the raw fd.
const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async line => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '— try: help'); return rl.prompt(); }
  try { await fn(rest.join(' ')); } catch (e) { console.log('ERROR:', e.message); }
  if (cmd === 'quit') { rl.close(); process.exit(0); }
  rl.prompt();
});
rl.on('close', async () => { await COMMANDS.quit(); process.exit(0); });

console.log('media-markdown-converter driver — "help" for commands, "launch" to start');
rl.prompt();

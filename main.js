const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Renamed from Clio: merge the old ~/.clio data folder into ~/.sneakpeek before anything reads it.
// (Hooks may already have created ~/.sneakpeek, so move entry by entry instead of renaming the folder.)
(() => {
  const old = path.join(os.homedir(), '.clio'), dir = path.join(os.homedir(), '.sneakpeek');
  try {
    if (!fs.existsSync(old)) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(old)) { const to = path.join(dir, f); if (!fs.existsSync(to)) fs.renameSync(path.join(old, f), to); }
    fs.rmSync(old, { recursive: true, force: true });
  } catch {}
})();
const { getUsage, cachedUsage } = require('./usage');
const config = require('./config');
const integrations = require('./integrations');

// No settings file yet = first start on this computer: open Settings so integrations can be switched on.
const firstRun = !fs.existsSync(path.join(os.homedir(), '.sneakpeek', 'settings.json'));
let cfg = config.load();
// The page is laid out at 380x620 and zoomed by cfg.scale (Settings → Size).
// The page is laid out at a fixed size per style and zoomed by cfg.scale (Settings → Size):
// the edge tab is a tall strip on the right; Island / Notch is a wide area at the top centre.
const LAYOUT = { tab: [380, 620], island: [480, 460], notch: [480, 460] };
const size = () => { const [w, h] = LAYOUT[cfg.style] || LAYOUT.tab; return { w: Math.round(w * cfg.scale), h: Math.round(h * cfg.scale) }; };
const loadWidget = () => win.loadFile('index.html', { query: { style: cfg.style } });
const POLL_MS = 60_000;
// A session counts as working until its Stop hook, or this long after its last hook event
// (Stop doesn't fire when you interrupt Claude, so this is the safety net).
const STALE_MS = 3 * 60_000;
const ACTIVITY = path.join(os.homedir(), '.sneakpeek', 'activity.json');
// Approvals: ask.js (a PermissionRequest hook) drops <id>.json here and waits for <id>.answer.
const REQS = path.join(os.homedir(), '.sneakpeek', 'requests');
const PIDFILE = path.join(os.homedir(), '.sneakpeek', 'sneakpeek.pid');
const NOTIFY = path.join(os.homedir(), '.sneakpeek', 'notify');
function notes() {
  let files = [];
  try { files = fs.readdirSync(NOTIFY).filter((f) => f.endsWith('.json')).sort(); } catch { return; }
  for (const f of files) {
    const p = path.join(NOTIFY, f);
    let n = null;
    try { n = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    try { fs.unlinkSync(p); } catch {}
    if (n && typeof n.text === 'string' && Date.now() - (n.at || 0) < 120_000) send('note', { text: n.text.slice(0, 200) });
  }
}
let win, settingsWin, tray, last = null;
// Send to the widget window, unless it's gone (e.g. while quitting): sending to a destroyed window throws.
const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

// Start with Windows: a per-user startup entry that runs this same Electron with this app folder.
const LOGIN = { path: process.execPath, args: [path.resolve(__dirname)], name: 'SneakPeek' };
// openAtLogin isn't reliable for a named entry on Windows; the launchItems list is.
const hasStartupEntry = (name) => (app.getLoginItemSettings(LOGIN).launchItems || []).some((i) => i.name === name && i.enabled !== false);
const startsWithWindows = () => hasStartupEntry(LOGIN.name);
// The entry may start another SneakPeek copy (e.g. a git clone instead of this npm install): name that folder.
// Switching it on again rewrites the entry to start this copy.
const startupElsewhere = () => {
  const item = (app.getLoginItemSettings(LOGIN).launchItems || []).find((i) => i.name === LOGIN.name);
  const dir = item?.args?.[0] && path.resolve(String(item.args[0]).replace(/^"|"$/g, ''));
  return dir && dir.toLowerCase() !== path.resolve(__dirname).toLowerCase() ? dir.replace(/\\/g, '/') : null;
};
const setStartup = (on) => app.setLoginItemSettings({ ...LOGIN, openAtLogin: on });
// Renamed from Clio: swap the old "Clio" startup entry for a "SneakPeek" one, keeping whether it was on.
function migrateStartup() {
  const old = { ...LOGIN, name: 'Clio' };
  if (hasStartupEntry('Clio')) { app.setLoginItemSettings({ ...old, openAtLogin: false }); setStartup(true); }
}

// One copy at a time. Launching again opens Settings; launching with --quit (from `sneakpeek update`) closes it.
// A second copy only passes its arguments to the running one, then exits at once: it must not reach startup,
// which would overwrite the pid file (hooks would think SneakPeek isn't running) and clear waiting requests.
const primary = app.requestSingleInstanceLock();
if (!primary || process.argv.includes('--quit')) app.exit(0); // --quit with nothing running: nothing to close
app.on('second-instance', (_, argv) => (argv.includes('--quit') ? app.quit() : openSettings()));

// ---- Updates: compare our version with package.json on GitHub, a few times a day ----
const REPO_PKG = 'https://raw.githubusercontent.com/loyd000/sneakpeek/main/package.json';
const installedWithNpm = __dirname.split(path.sep).includes('node_modules'); // else: running from a git clone
let update = null; // newer version on GitHub, if any
const isNewer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkForUpdate() {
  try {
    const res = await fetch(REPO_PKG, { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!res.ok) return;
    const v = (await res.json()).version;
    update = typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) && isNewer(v, app.getVersion()) ? v : null;
    buildTray();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('cfg:changed');
  } catch {} // offline: try again later
}
// Runs `sneakpeek update` in its own window, so the npm output is visible; it closes and restarts this app.
function runUpdate() {
  if (!installedWithNpm) return;
  spawn('cmd.exe', ['/c', 'sneakpeek update || pause'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

// Docked to the right edge of the primary screen; Settings → Position moves it up or down.
function dock() {
  const a = screen.getPrimaryDisplay().workArea, { w, h } = size();
  if (cfg.style === 'tab') win.setBounds({ x: a.x + a.width - w, y: Math.round(a.y + (a.height - h) * cfg.offset / 100), width: w, height: h });
  else win.setBounds({ x: Math.round(a.x + (a.width - w) / 2), y: a.y, width: w, height: h }); // top centre
}

async function refresh() {
  last = await getUsage({ claude: cfg.claude, codex: cfg.codex });
  send('usage', last);
}

// Settings changed (from the Settings window): save, then apply what changed.
// Applied at once; written to disk at most every 300ms, so dragging a slider doesn't hammer the file.
let saveTimer = 0, saveError = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { config.save(cfg); saveError = null; } catch (e) { saveError = `Couldn't save settings (${e.code || e.message}). They'll reset when SneakPeek restarts.`; }
  }, 300);
}
app.on('will-quit', () => { if (saveTimer) { clearTimeout(saveTimer); try { config.save(cfg); } catch {} } });

function applySettings(next) {
  const prev = cfg;
  cfg = config.clean(next);
  saveSoon();
  if (prev.style !== cfg.style) { dock(); loadWidget(); } // new shape: reload the page in the new style (state is resent on load)
  else if (prev.scale !== cfg.scale || prev.offset !== cfg.offset) { dock(); win.webContents.setZoomFactor(cfg.scale); }
  if (prev.scale !== cfg.scale && lastArt) send('media', { artOnly: true, ...sizedArt(lastArt) }); // re-fit covers to the new size
  send('settings', cfg);
  if (prev.claude !== cfg.claude || prev.codex !== cfg.codex) { lastActivity = ''; activity(); refresh(); }
  if (prev.music !== cfg.music) cfg.music ? startMedia() : stopMedia();
  return cfg;
}

// ---- Music: media.ps1 reads Windows' now-playing and takes play/pause/skip commands ----
let media = null, mediaRetry = 0, lastArt = null;
// Covers arrive at ~300px but are drawn at ~26-43 device pixels; letting the GPU shrink them every frame
// while they spin looks blurry. So shrink once, high quality, to the exact drawn sizes (panel / tab).
function sizedArt(art) {
  if (!art) return { art: null, artSmall: null };
  try {
    const img = nativeImage.createFromDataURL(art), dpr = screen.getPrimaryDisplay().scaleFactor;
    const px = (css) => Math.max(16, Math.round(css * cfg.scale * dpr));
    return { art: img.resize({ width: px(64), height: px(64), quality: 'best' }).toDataURL(),
             artSmall: img.resize({ width: px(28), height: px(28), quality: 'best' }).toDataURL() };
  } catch { return { art, artSmall: art }; }
}
let lastMedia = null; // latest now-playing, art included, so a reloaded page can show it at once
function sendMedia(msg) {
  lastMedia = msg.none ? null : msg.artOnly ? lastMedia && { ...lastMedia, art: msg.art, artSmall: msg.artSmall } : { ...(lastMedia || {}), ...msg };
  if ('art' in msg) { lastArt = msg.art; Object.assign(msg, sizedArt(msg.art)); }
  if (lastMedia && 'art' in msg) Object.assign(lastMedia, { art: msg.art, artSmall: msg.artSmall });
  send('media', msg);
}
function startMedia() {
  if (media || !cfg.music) return;
  // -EncodedCommand runs our own script text directly, so no script file or execution-policy change is needed.
  const script = fs.readFileSync(path.join(__dirname, 'media.ps1'), 'utf8');
  media = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true });
  let buf = '';
  media.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('{')) continue;
      try { mediaRetry = 0; sendMedia(JSON.parse(line)); } catch {}
    }
  });
  media.on('exit', () => {
    media = null;
    send('media', { none: true });
    if (cfg.music) setTimeout(startMedia, Math.min(60_000, 2000 * 2 ** mediaRetry++)); // crashed: retry, backing off
  });
}
function stopMedia() { if (media) { const m = media; media = null; m.removeAllListeners('exit'); m.kill(); send('media', { none: true }); } }
ipcMain.on('media:cmd', (_, cmd) => { if (['toggle', 'next', 'prev'].includes(cmd)) media?.stdin.write(cmd + '\n'); });
app.on('will-quit', stopMedia);

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 460, height: 680, minWidth: 400, minHeight: 420, title: 'SneakPeek Settings', icon: path.join(__dirname, 'assets', 'sneakpeek.ico'),
    backgroundColor: '#0a0a0a', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js') },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
}

// Logo = the AI that's working now (most recent if both), else whichever was used last.
let lastActivity = '', wasWorking = null; // session -> working, as of the last read

function activity() {
  let f = {};
  try { f = JSON.parse(fs.readFileSync(ACTIVITY, 'utf8')); } catch {}
  let latest = null, busy = null, waiting = null;
  const now = new Map();
  for (const ai of ['claude', 'codex'].filter((x) => cfg[x])) for (const [sid, s] of Object.entries(f[ai] || {})) {
    now.set(ai + ':' + sid, s.working);
    // Was working at the last read, now stopped: tell the page it's done (toast + sound).
    if (wasWorking?.get(ai + ':' + sid) && !s.working) send('done', { ai, project: s.project || '', ranMs: s.at - (s.since ?? s.at) });
    if (!latest || s.at > latest.at) latest = { ai, at: s.at };
    if (s.working && Date.now() - s.at < STALE_MS && (!busy || s.at > busy.at)) busy = { ai, at: s.at, since: s.since || s.at };
    // Waiting for your reply (Claude's idle notification); forgotten after 3 hours.
    if (s.waiting && Date.now() - s.at < 3 * 3600_000 && (!waiting || s.at > waiting.at)) waiting = { ai, at: s.at, project: s.project || '' };
  }
  wasWorking = now;
  const a = { ai: (busy || latest)?.ai || (cfg.claude ? 'claude' : 'codex'), working: !!busy, since: busy?.since || 0,
    waiting: waiting && { ai: waiting.ai, project: waiting.project } };
  const key = JSON.stringify(a);
  if (key !== lastActivity) { lastActivity = key; send('activity', a); }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let reqTimer = 0;
function requests() {
  let list = [];
  try {
    for (const f of fs.readdirSync(REQS).filter((n) => n.endsWith('.json'))) {
      const p = path.join(REQS, f);
      let r = null;
      try { r = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
      // A hook that was killed (timeout, interrupted session) can't clean up on Windows: drop its card.
      if (r && alive(r.pid) && Date.now() - r.at < 120_000) list.push(r);
      else try { fs.unlinkSync(p); } catch {}
    }
  } catch {}
  list.sort((a, b) => a.at - b.at);
  send('requests', list);
  clearTimeout(reqTimer);
  if (list.length) reqTimer = setTimeout(requests, 2000); // keep checking while cards are up
}

app.whenReady().then(() => {
  if (!primary) return; // belt and braces: never run startup in a second copy
  migrateStartup();
  if (firstRun) { try { config.save(cfg); } catch {} setTimeout(openSettings, 1200); }
  fs.mkdirSync(REQS, { recursive: true });
  for (const f of fs.readdirSync(REQS)) try { fs.unlinkSync(path.join(REQS, f)); } catch {} // leftovers from a crash
  fs.writeFileSync(PIDFILE, String(process.pid)); // ask.js only waits for an answer while this process is alive
  if (process.argv.includes('--enable-startup')) setStartup(true); // one-time switch: npm start -- --enable-startup
  const { w, h } = size();
  win = new BrowserWindow({
    width: w, height: h, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, show: false, title: 'SneakPeek',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), autoplayPolicy: 'no-user-gesture-required' }, // chime without a click first
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true }); // transparent area clicks pass through to the desktop
  dock();
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(cfg.scale); send('settings', cfg); lastActivity = ''; activity(); requests();
    if (last) send('usage', last);            // after a style change the page reloads: show everything again at once
    if (lastMedia) send('media', lastMedia);
    notes();                                  // notes sent just before SneakPeek started
  });
  loadWidget();
  win.once('ready-to-show', () => {
    win.showInactive();
    const saved = cachedUsage(); // last session's numbers, shown at once while the fresh check runs
    if (saved) send('usage', saved);
    refresh();
    startMedia();
  });
  screen.on('display-metrics-changed', dock);

  tray = new Tray(path.join(__dirname, 'assets', 'sneakpeek.ico'));
  tray.on('click', openSettings);
  buildTray();
  setTimeout(checkForUpdate, 60_000); // a minute after start, then every 6 hours
  setInterval(checkForUpdate, 6 * 3600_000);
  setInterval(refresh, POLL_MS);
  setInterval(activity, 10_000); // expire stale "working" sessions

  // statusline.js rewrites the feed after every Claude Code reply; activity.js rewrites activity on every hook.
  let t, rt, nt;
  const watch = (dir, file, fn) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.watch(dir, (_, f) => { if (f === file) fn(); });
    } catch {}
  };
  watch(path.join(os.homedir(), '.claude'), 'ai-limits-feed.json', () => { clearTimeout(t); t = setTimeout(refresh, 500); });
  watch(path.dirname(ACTIVITY), 'activity.json', activity);
  try { fs.watch(REQS, () => { clearTimeout(rt); rt = setTimeout(requests, 50); }); } catch {}
  try { fs.mkdirSync(NOTIFY, { recursive: true }); fs.watch(NOTIFY, () => { clearTimeout(nt); nt = setTimeout(notes, 50); }); } catch {}
});

// Only a well-formed answer for a request that's still waiting gets written:
// 'allow' | 'deny' | 'skip', or { answers: { question: label } } for Claude's questions.
const okAnswers = (o) => o && typeof o.answers === 'object' && Object.keys(o.answers).length <= 10 &&
  Object.entries(o.answers).every(([k, v]) => typeof v === 'string' && k.length < 2000 && v.length < 2000);
ipcMain.on('answer', (_, id, decision) => {
  if (!/^[0-9a-f-]{36}$/.test(id) || !fs.existsSync(path.join(REQS, id + '.json'))) return;
  const text = ['allow', 'deny', 'skip'].includes(decision) ? decision : okAnswers(decision) ? JSON.stringify({ answers: decision.answers }) : null;
  if (!text) return;
  const f = path.join(REQS, id + '.answer');
  fs.writeFileSync(f + '.tmp', text);
  fs.renameSync(f + '.tmp', f);
});
app.on('will-quit', () => { try { fs.unlinkSync(PIDFILE); } catch {} });

ipcMain.on('interactive', (_, on) => win.setIgnoreMouseEvents(!on, { forward: true }));
ipcMain.on('refresh', () => { if (!last || Date.now() - last.at > 15_000) refresh(); });
ipcMain.on('menu', () =>
  Menu.buildFromTemplate([
    { label: 'Settings…', click: openSettings },
    { label: 'Refresh now', click: refresh },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]).popup({ window: win })
);

// Settings window API. Only the Settings window may call these.
const fromSettings = (e) => settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents;
function buildTray() {
  if (!tray) return;
  tray.setToolTip(update ? `SneakPeek: version ${update} is available` : 'SneakPeek');
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(update && installedWithNpm ? [{ label: `Update to ${update}`, click: runUpdate }, { type: 'separator' }] : []),
    { label: 'Settings…', click: openSettings },
    { label: 'Refresh now', click: refresh },
    { type: 'separator' },
    { label: 'Quit SneakPeek', click: () => app.quit() },
  ]));
}

const snapshot = () => ({ settings: cfg, integrations: integrations.state(), startup: startsWithWindows(), startupElsewhere: startupElsewhere(), version: app.getVersion(),
  update: { available: update, canInstall: installedWithNpm } });
// Every call answers with the real state afterwards, plus an error message if the change didn't happen.
const guarded = (e, fn) => {
  if (!fromSettings(e)) return null;
  try { fn(); return { ...snapshot(), error: saveError }; } catch (err) { return { ...snapshot(), error: err.message }; }
};
ipcMain.handle('cfg:get', (e) => guarded(e, () => {}));
ipcMain.handle('cfg:set', (e, patch) => guarded(e, () => { if (patch && typeof patch === 'object') applySettings({ ...cfg, ...patch }); }));
ipcMain.handle('int:set', (e, key, on) => guarded(e, () => { if (typeof key === 'string') integrations.set(key, !!on); }));
ipcMain.handle('int:removeAll', (e) => guarded(e, () => integrations.removeAll()));
ipcMain.handle('startup:set', (e, on) => guarded(e, () => setStartup(!!on)));
ipcMain.handle('update:check', async (e) => { if (fromSettings(e)) await checkForUpdate(); return guarded(e, () => {}); });
ipcMain.handle('update:run', (e) => guarded(e, runUpdate));

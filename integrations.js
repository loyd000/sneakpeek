// Turns SneakPeek's hooks and status line in Claude Code / Codex on and off.
// SneakPeek's entries are recognised by their command: `node "<folder>/<statusline|activity|ask>.js"` where <folder>
// is a SneakPeek install (this one, or another copy, e.g. a git clone next to the npm install). Anything else, like
// another tool's status line or hooks, is never touched.
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname).replace(/\\/g, '/');
const H = os.homedir();
const CLAUDE = path.join(H, '.claude', 'settings.json');
const CODEX = path.join(H, '.codex', 'hooks.json');

const run = (script, args) => `node "${ROOT}/${script}" ${args}`;

// Which SneakPeek install (folder, with forward slashes) a command belongs to, or null if it isn't SneakPeek's.
const CMD = /node "([^"]+)[\\/](statusline|activity|ask)\.js"/;
const isInstall = (dir) => {
  if (/sneakpeek/i.test(dir)) return true; // also covers a copy that has since been deleted
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'sneakpeek'; } catch { return false; }
};
function owner(command, script) {
  const m = typeof command === 'string' && command.match(CMD);
  return m && m[2] + '.js' === script && isInstall(m[1]) ? m[1].replace(/\\/g, '/') : null;
}
const same = (a, b) => a.toLowerCase() === b.toLowerCase(); // Windows paths ignore case
const ours = (script) => (h) => { const o = owner(h?.command, script); return !!o && same(o, ROOT); };
const anyCopy = (script) => (h) => !!owner(h?.command, script);
// The other SneakPeek folder that set up this switch's hooks, if it isn't this one.
const elsewhere = (cfg, spec) => {
  for (const [ev] of spec.hooks) for (const g of cfg?.hooks?.[ev] || []) for (const h of g.hooks || []) {
    const o = owner(h.command, spec.script); if (o && !same(o, ROOT)) return o;
  }
  return null;
};

// What each switch installs: [event, hook command args, matcher?]
const SPECS = {
  'claude.activity': { file: CLAUDE, script: 'activity.js', hooks: [['UserPromptSubmit', 'claude start'], ['PreToolUse', 'claude start', '*'], ['Stop', 'claude stop'], ['Notification', 'claude stop'], ['SessionEnd', 'claude end']], extra: { async: true } },
  'claude.ask': { file: CLAUDE, script: 'ask.js', hooks: [['PermissionRequest', 'claude', '*']], extra: { timeout: 90 } },
  'codex.activity': { file: CODEX, script: 'activity.js', hooks: [['UserPromptSubmit', 'codex start'], ['PreToolUse', 'codex start'], ['Stop', 'codex stop']], extra: { timeout: 5 }, windows: true },
  'codex.ask': { file: CODEX, script: 'ask.js', hooks: [['PermissionRequest', 'codex']], extra: { timeout: 90 }, windows: true },
};

const slash = (p) => p.replace(/\\/g, '/');
const tilde = (f) => slash(f).replace(slash(H), '~');
// A missing file is fine (SneakPeek creates it). A file SneakPeek can't read or parse is never written to:
// rewriting it would replace everything in it with SneakPeek's hooks alone.
function read(f) {
  if (!fs.existsSync(f)) return {};
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { throw new Error(`SneakPeek can't open ${tilde(f)} (${e.code || e.message}), so it left the file unchanged.`); }
  try { const j = JSON.parse(text); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch {}
  throw new Error(`${tilde(f)} isn't valid JSON, so SneakPeek left it unchanged. Fix the file, then try again.`);
}
const peek = (f) => { try { return { cfg: read(f), error: null }; } catch (e) { return { cfg: null, error: e.message }; } };
function write(f, obj) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak-sneakpeek'); // last good version, kept before every change
  fs.writeFileSync(f + '.tmp', JSON.stringify(obj, null, 2));
  fs.renameSync(f + '.tmp', f);
}

const hasHooks = (cfg, spec) => spec.hooks.every(([ev]) => (cfg?.hooks?.[ev] || []).some((g) => (g.hooks || []).some(ours(spec.script))));

function removeHooks(cfg, script) {
  for (const [ev, groups] of Object.entries(cfg.hooks || {})) {
    const kept = groups.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !anyCopy(script)(h)) })).filter((g) => g.hooks.length);
    if (kept.length) cfg.hooks[ev] = kept; else delete cfg.hooks[ev];
  }
  if (cfg.hooks && !Object.keys(cfg.hooks).length) delete cfg.hooks;
}

function addHooks(cfg, spec) {
  removeHooks(cfg, spec.script); // never add twice; also moves them here from another SneakPeek copy
  cfg.hooks ??= {};
  for (const [ev, args, matcher] of spec.hooks) {
    const cmd = run(spec.script, args);
    const hook = { type: 'command', command: cmd, ...(spec.windows && { commandWindows: cmd }), ...spec.extra };
    (cfg.hooks[ev] ??= []).push({ ...(matcher && { matcher }), hooks: [hook] });
  }
}

// Claude Code's status line feeds live usage. Replace it only when it's SneakPeek's (any copy), never someone else's.
const feedCmd = run('statusline.js', '').trim();
const feedOwner = (cfg) => owner(cfg?.statusLine?.command, 'statusline.js');
const isOurFeed = (cfg) => { const o = feedOwner(cfg); return !!o && same(o, ROOT); };

function state() {
  const c = peek(CLAUDE), x = peek(CODEX), claude = c.cfg, codex = x.cfg;
  return {
    'claude.feed': isOurFeed(claude),
    'claude.feed.blocked': !!claude?.statusLine && !feedOwner(claude), // another tool's status line is set
    'claude.feed.elsewhere': feedOwner(claude) && !isOurFeed(claude) ? feedOwner(claude) : null,
    'claude.activity.elsewhere': elsewhere(claude, SPECS['claude.activity']),
    'claude.ask.elsewhere': elsewhere(claude, SPECS['claude.ask']),
    'codex.activity.elsewhere': elsewhere(codex, SPECS['codex.activity']),
    'codex.ask.elsewhere': elsewhere(codex, SPECS['codex.ask']),
    root: ROOT,
    'claude.activity': hasHooks(claude, SPECS['claude.activity']),
    'claude.ask': hasHooks(claude, SPECS['claude.ask']),
    'codex.activity': hasHooks(codex, SPECS['codex.activity']),
    'codex.ask': hasHooks(codex, SPECS['codex.ask']),
    'claude.installed': fs.existsSync(path.dirname(CLAUDE)), 'codex.installed': fs.existsSync(path.dirname(CODEX)),
    'claude.error': c.error, 'codex.error': x.error, // file exists but can't be used: switches stay locked
  };
}

function set(key, on) {
  if (key === 'claude.feed') {
    const cfg = read(CLAUDE);
    if (on && cfg.statusLine && !feedOwner(cfg)) return state(); // another tool's status line: leave it alone
    if (on) cfg.statusLine = { type: 'command', command: feedCmd }; // new, or moved here from another SneakPeek copy
    else if (feedOwner(cfg)) delete cfg.statusLine;
    write(CLAUDE, cfg);
    return state();
  }
  const spec = SPECS[key];
  if (!spec) return state();
  const cfg = read(spec.file);
  if (on) addHooks(cfg, spec); else removeHooks(cfg, spec.script);
  write(spec.file, cfg);
  return state();
}

// Removes what it can; a file it can't touch doesn't stop the others. Reports every problem at the end.
function removeAll() {
  const errors = new Set();
  for (const key of ['claude.feed', ...Object.keys(SPECS)]) try { set(key, false); } catch (e) { errors.add(e.message); }
  if (errors.size) throw new Error([...errors].join(' '));
  return state();
}

module.exports = { state, set, removeAll };

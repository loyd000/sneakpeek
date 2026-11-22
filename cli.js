#!/usr/bin/env node
// The `sneakpeek` command (installed by `npm install -g github:loyd000/sneakpeek`).
//   sneakpeek           start SneakPeek (or open its Settings if it's already running)
//   sneakpeek update    install the latest version from GitHub and restart SneakPeek
//   sneakpeek notify "Tests done"   show a note in SneakPeek, e.g. at the end of a script: npm test; sneakpeek notify "Tests done"
//   sneakpeek --quiet   start without the spinning logo
//   sneakpeek --remove  take SneakPeek's hooks, status line and startup entry out of Claude Code, Codex and Windows.
//                       Run this before `npm uninstall -g sneakpeek`, or the hooks keep pointing at a deleted folder.
const { spawn, spawnSync, execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const REPO = 'github:loyd000/sneakpeek';
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
// The installed version, read fresh from disk (after `update`, this is the new one).
const version = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version; } catch { return ''; } };
const banner = () => (quiet ? Promise.resolve() : require('./banner').play(version()));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (args.includes('--help') || args.includes('-h')) {
  console.log([
    'sneakpeek           start SneakPeek (or open Settings if it is already running)',
    'sneakpeek update    install the latest version from GitHub and restart SneakPeek',
    'sneakpeek notify "Tests done"   show a note in SneakPeek (e.g. at the end of a script)',
    'sneakpeek --quiet   start without the spinning logo',
    'sneakpeek --remove  remove its hooks and startup entry before uninstalling',
  ].join('\n'));
  process.exit(0);
}

if (args.includes('--remove')) {
  let problems = 0;
  try { require('./integrations').removeAll(); console.log('Removed the hooks and status line from Claude Code and Codex.'); }
  catch (e) { problems++; console.error('Some integrations could not be removed: ' + e.message); }
  try {
    execFileSync('reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'SneakPeek', '/f'], { stdio: 'ignore' });
    console.log('Removed the "Start with Windows" entry.');
  } catch { /* no startup entry: nothing to remove */ }
  console.log(problems ? 'Fix the problem above, then run this again.' : 'Done. You can now run: npm uninstall -g sneakpeek');
  process.exit(problems ? 1 : 0);
}

if (args[0] === 'notify') {
  const text = args.slice(1).filter((a) => a !== '--quiet').join(' ').trim();
  if (!text) { console.error('Usage: sneakpeek notify "Tests done"'); process.exit(1); }
  let running = false;
  try { running = alive(Number(fs.readFileSync(path.join(os.homedir(), '.sneakpeek', 'sneakpeek.pid'), 'utf8'))); } catch {}
  // A small file SneakPeek picks up, shows and deletes (it ignores notes older than 2 minutes).
  const dir = path.join(os.homedir(), '.sneakpeek', 'notify'), f = path.join(dir, `${Date.now()}-${process.pid}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify({ text: text.slice(0, 200), at: Date.now() }));
  fs.renameSync(f + '.tmp', f);
  if (!running) console.log("SneakPeek isn't running, so this note shows only if it starts in the next 2 minutes.");
  process.exit(0);
}

(async () => {
if (args[0] === 'update') {
  // Windows won't let npm replace SneakPeek's files while it runs, so close it first.
  let pid = 0;
  try { pid = Number(fs.readFileSync(path.join(os.homedir(), '.sneakpeek', 'sneakpeek.pid'), 'utf8')); } catch {}
  const wasRunning = pid > 0 && alive(pid);
  if (wasRunning) {
    console.log('Closing SneakPeek...');
    spawnSync(require('electron'), [__dirname, '--quit']); // a second copy hands "--quit" to the running one
    for (let i = 0; i < 50 && alive(pid); i++) sleep(200);
    if (alive(pid)) { console.error("SneakPeek didn't close. Quit it from the tray icon, then run `sneakpeek update` again."); process.exit(1); }
    sleep(1500); // let its helper processes let go of the files
  }
  console.log('Installing the latest SneakPeek from GitHub...');
  const r = spawnSync('npm', ['install', '-g', REPO, '--no-audit', '--no-fund'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('The update failed (see above). Your current version is unchanged; try again, or run: npm install -g ' + REPO);
    process.exit(1);
  }
  if (wasRunning) spawn('sneakpeek', ['--quiet'], { shell: true, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  await banner(); // the new version's logo and credits
  console.log(wasRunning ? `Updated to ${version()}. SneakPeek is starting again.` : `Updated to ${version()}. Run \`sneakpeek\` to start it.`);
  process.exit(0);
}

// From Node, require('electron') gives the path to the Electron that npm installed with SneakPeek.
// (The first run after an install downloads Electron's program file once.)
const electron = require('electron');
const child = spawn(electron, [path.join(__dirname), ...args], { detached: true, stdio: 'ignore' });
child.unref();
await banner(); // plays while the app starts up, so it adds no wait
console.log('SneakPeek is starting. Look for its tab on the right edge of your screen, and its icon in the tray.');
})();

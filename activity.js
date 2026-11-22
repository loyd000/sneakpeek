// Hook for Claude Code and Codex: records when each one starts and stops working, for SneakPeek's logo.
// Usage: node activity.js <claude|codex> <start|stop|end>   (the hook's event JSON arrives on stdin; a Claude
// Notification event that isn't a permission prompt is recorded as "waiting for you")
const fs = require('fs'), os = require('os'), path = require('path');
const [ai, argWhat] = process.argv.slice(2);
const dir = path.join(os.homedir(), '.sneakpeek'), file = path.join(dir, 'activity.json');

// What Claude did in the turn that just ended, read from the end of its transcript (back to the prompt that started it):
// the files it edited, how many commands it ran, and whether one of them ran tests.
function summary(file) {
  try {
    const size = fs.statSync(file).size, n = Math.min(size, 2_000_000), buf = Buffer.alloc(n), fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, n, size - n); fs.closeSync(fd);
    const files = new Set(); let cmds = 0, tests = false;
    for (const line of buf.toString('utf8').split('\n').reverse()) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      const c = e.message?.content;
      if (e.type === 'user' && !e.isMeta && (typeof c === 'string' || (Array.isArray(c) && c.some((x) => x.type === 'text')))) break;
      if (e.type !== 'assistant' || !Array.isArray(c)) continue;
      for (const t of c) {
        if (t.type !== 'tool_use') continue;
        const f = t.input?.file_path || t.input?.notebook_path;
        if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(t.name) && f) files.add(path.basename(f));
        if (t.name === 'Bash') { cmds++; if (/\b(test|tests|jest|vitest|pytest|mocha|playwright)\b/.test(t.input?.command || '')) tests = true; }
      }
    }
    return files.size || cmds ? { files: [...files].slice(0, 20), cmds, tests } : null;
  } catch { return null; }
}

let input = '';
process.stdin.on('data', (d) => (input += d)).on('end', () => {
  let ev = {};
  try { ev = JSON.parse(input); } catch {}
  const sid = ev.session_id || ev.sessionId || 'default';
  // Claude Code's Notification hook fires when it's been waiting for your input: that's "waiting for you".
  // (Its permission prompts also notify, but those already show as approval cards.)
  let what = argWhat;
  if (ev.hook_event_name === 'Notification' && !/permission/i.test(ev.message || '')) what = 'wait';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const now = Date.now(), sessions = (state[ai] ??= {});
  for (const [id, s] of Object.entries(sessions)) if (now - s.at > 86400000) delete sessions[id]; // forget day-old sessions
  if (what === 'end') delete sessions[sid];
  else {
    const prev = sessions[sid], working = what === 'start';
    // since = when this stretch of work began (kept across heartbeats), so SneakPeek knows how long it ran.
    // did = what Claude did in the turn that just ended (kept while it waits for you; cleared by the next prompt)
    const did = what === 'stop' && ai === 'claude' && ev.transcript_path ? summary(ev.transcript_path) : what === 'wait' ? prev?.did : null;
    sessions[sid] = { working, at: now, since: working && prev?.working ? prev.since ?? now : working ? now : prev?.since ?? now,
      project: path.basename(ev.cwd || '') || prev?.project || '',
      ...(what === 'wait' && { waiting: true }), // cleared by the next prompt (start), stop or end
      ...(did && { did }) };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file); // atomic, so SneakPeek never reads a half-written file
  } catch {}
});

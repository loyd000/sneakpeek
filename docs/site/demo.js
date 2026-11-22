// Sample data for the landing page's live demo. It stands in for SneakPeek's background process (main.js), so the real
// widget runs in the browser: Claude and Codex take turns working, an approval card asks for an answer, and a song plays.
// Every name, number and lyric here is made up.
(() => {
  const h = {}, on = (k) => (f) => { h[k] = f; }, emit = (k, v) => h[k]?.(v);
  const style = new URLSearchParams(location.search).get('style') || 'tab';
  const cfg = { claude: true, codex: true, music: true, songNotes: false, coverBg: true, lyrics: true, beatPulse: true, shortcuts: false, sessions: true,
    sounds: false, doneNotes: true, doneMinSec: 5, alerts: false, alertLevels: [80, 90], waitNotes: true, paceNotes: false, resetNotes: false, style, scale: 1, offset: 50 };

  // Songs, with covers drawn here and lyrics timed every few seconds
  const cover = (paint) => { const c = document.createElement('canvas'); c.width = c.height = 160; paint(c.getContext('2d'), 160); return c.toDataURL(); };
  const SONGS = [
    { title: 'Low Sun', artist: 'Harbor Lights', dur: 96000, paint: (x, s) => {
        const g = x.createLinearGradient(0, 0, 0, s); g.addColorStop(0, '#1d1438'); g.addColorStop(.55, '#a8456b'); g.addColorStop(1, '#f29b5b');
        x.fillStyle = g; x.fillRect(0, 0, s, s); x.fillStyle = '#ffd28a'; x.beginPath(); x.arc(s / 2, s * .58, s * .21, 0, 7); x.fill();
        x.fillStyle = '#140f22'; x.fillRect(0, s * .66, s, s * .34); },
      words: ['The sun sits low on the harbor wall', 'and every light comes on at once', 'we count the boats that never call', 'and wait for the tide to turn',
        'Hold on, the evening is long', 'hold on, it was always this song'] },
    { title: 'Low Tide', artist: 'Blue Harbor', dur: 90000, paint: (x, s) => {
        x.fillStyle = '#071a2e'; x.fillRect(0, 0, s, s); x.fillStyle = '#1c6fb8'; x.fillRect(0, s * .45, s, s * .55);
        x.fillStyle = '#38c6d9'; for (let i = 0; i < 4; i++) x.fillRect(s * .1, s * (.52 + i * .11), s * .8, s * .035);
        x.fillStyle = '#e8f4ff'; x.beginPath(); x.arc(s * .72, s * .24, s * .09, 0, 7); x.fill(); },
      words: ['Blue lines on a quiet sea', 'the radio hums an old melody', 'nobody needs to be anywhere', 'so we stay right here', 'low tide, slow ride', 'low tide'] },
  ];
  let song = 0, playing = true, pos = 8000, at = Date.now();
  const now = () => playing ? Math.min(SONGS[song].dur, pos + Date.now() - at) : pos;
  function sendSong(withArt) {
    const s = SONGS[song];
    s.art ||= cover(s.paint);
    emit('media', { app: 'Spotify.exe', title: s.title, artist: s.artist, status: playing ? 'playing' : 'paused', pos: now(), dur: s.dur, at: Date.now(),
      ...(withArt && { art: s.art, artSmall: s.art }) });
    // A new line every 4 seconds, the verse sung twice
    if (withArt) emit('ly', { key: s.artist + '|' + s.title, lines: [...s.words, ...s.words].map((text, i) => ({ t: 3000 + i * 4000, text })) });
  }
  function nextSong(d) { pos = now(); song = (song + d + SONGS.length) % SONGS.length; pos = 0; at = Date.now(); playing = true; sendSong(true); }

  // Claude Code and Codex take turns; an approval card shows up now and then
  const usage = () => ({ at: Date.now() - 60000, claude: { ok: true, plan: 'pro', windows: [{ label: '5-hour', pct: 42, resetsAt: Date.now() + 2.6 * 3600e3 }, { label: 'Weekly', pct: 18, resetsAt: Date.now() + 4.2 * 86400e3 }] },
    codex: { ok: true, plan: 'plus', windows: [{ label: '5-hour', pct: 23, resetsAt: Date.now() + 3.1 * 3600e3 }, { label: 'Weekly', pct: 9, resetsAt: Date.now() + 5.5 * 86400e3 }] } });
  let sessions = { api: { ai: 'claude', project: 'api-server', since: Date.now() - 95000 }, web: { ai: 'claude', project: 'web-app', since: Date.now() - 600000 }, docs: { ai: 'codex', project: 'docs', since: Date.now() - 900000 } };
  const sendSessions = () => emit('ses', Object.entries(sessions).map(([id, s]) => ({ id, ai: s.ai, project: s.project, working: !!s.working, waiting: !!s.waiting,
    since: s.since, at: s.at || Date.now(), did: s.did || null })));
  const work = (id, ai) => { Object.assign(sessions[id], { working: true, waiting: false, since: Date.now(), at: Date.now() }); emit('act', { ai, working: true, since: Date.now(), waiting: null }); sendSessions(); };
  const finish = (id, ai, did) => {
    const s = sessions[id]; Object.assign(s, { working: false, at: Date.now(), did });
    emit('act', { ai, working: false, since: 0, waiting: null }); emit('done', { ai, project: s.project, ranMs: Date.now() - s.since, did }); sendSessions();
  };
  let card = null, cardTimer;
  const ask = () => {
    card = { id: 'demo-' + Date.now(), ai: 'claude', tool: 'Bash', verb: 'run', detail: 'npm test', project: 'api-server', at: Date.now(), pid: 1 };
    emit('req', [card]);
    cardTimer = setTimeout(() => { card = null; emit('req', []); }, 12000); // nobody answered: it goes away
  };
  const STEPS = [
    [0, () => work('api', 'claude')],
    [7000, () => finish('api', 'claude', { files: ['routes.ts', 'auth.ts', 'db.ts'], cmds: 2, tests: false })],
    [10000, ask],
    [24000, () => work('docs', 'codex')],
    [31000, () => finish('docs', 'codex', null)],
    [34000, () => { Object.assign(sessions.web, { waiting: true, at: Date.now() }); emit('act', { ai: 'claude', working: false, since: 0, waiting: { ai: 'claude', project: 'web-app' } }); sendSessions(); }],
    [40000, () => { sessions.web.waiting = false; emit('act', { ai: 'claude', working: false, since: 0, waiting: null }); sendSessions(); }],
  ];
  const loop = () => { for (const [t, f] of STEPS) setTimeout(f, t); setTimeout(loop, 44000); };

  window.widget = {
    onUsage: on('use'), onActivity: on('act'), onRequests: on('req'), onDone: on('done'), onNote: on('note'), onSettings: on('set'), onMedia: on('media'),
    onSessions: on('ses'), onKey: on('key'), onLyrics: on('ly'), onLevel: on('lvl'),
    mediaCmd(cmd) { if (cmd === 'toggle') { pos = now(); at = Date.now(); playing = !playing; sendSong(false); } else nextSong(cmd === 'next' ? 1 : -1); },
    answer(id, decision) { // Allow: Claude runs the tests and is done a few seconds later
      clearTimeout(cardTimer); card = null;
      setTimeout(() => emit('req', []), 350);
      if (decision === 'allow') { setTimeout(() => work('api', 'claude'), 600); setTimeout(() => finish('api', 'claude', { files: [], cmds: 1, tests: true }), 5000); }
    },
    refresh() {}, interactive() {}, menu() {},
  };

  addEventListener('load', () => {
    emit('set', cfg); emit('use', usage()); sendSong(true); sendSessions(); loop();
    setInterval(() => { if (playing && now() >= SONGS[song].dur) nextSong(1); else sendSong(false); }, 5000);
    // A steady beat for the music bars, about 120 a minute, with a little wobble
    setInterval(() => { if (!playing) return; const t = Date.now() / 1000;
      emit('lvl', .18 + .55 * Math.max(0, Math.sin(t * Math.PI * 2)) ** 3 + .12 * Math.random()); }, 50);
  });
})();

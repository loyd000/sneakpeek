<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/sneakpeek.svg">
    <img src="assets/sneakpeek-dark.svg" width="132" alt="SneakPeek logo: an abstract eye">
  </picture>
</p>

<h1 align="center">SneakPeek</h1>

<p align="center">A small tab that peeks out from the edge of your screen,<br>so you always know what your AI is up to.</p>

<p align="center">
  <img alt="Windows 10 and 11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-111111">
  <img alt="Node 18 or newer" src="https://img.shields.io/badge/node-%E2%89%A518-111111">
  <img alt="Latest version" src="https://img.shields.io/github/package-json/v/loyd000/sneakpeek?label=version&color=111111">
</p>

<p align="center">
  <img src="docs/demo.gif" width="300" alt="The SneakPeek tab sliding open into a panel with music and AI usage">
</p>

## What it does

Hover the tab and it opens into a panel showing:

- **Your AI usage.** How much of your Claude Code and ChatGPT/Codex limits you've used, and when they reset. An alert shows when a limit passes 80% or 90%.
- **Which AI is working.** Claude's spinner or ChatGPT's shimmer while it works, and a quiet "done" note when it finishes.
- **Approvals and questions.** When Claude Code or Codex asks permission, or Claude asks you a question, answer it right in the panel.
- **What's playing.** Song, spinning cover art and play/pause/skip for Spotify, YouTube, Apple Music and other players.

<p align="center">
  <img src="docs/panel.png" width="250" alt="The panel with music and Claude and ChatGPT usage">
  <img src="docs/approval.png" width="250" alt="An approval card: Claude wants to run npm run build, with Deny and Allow">
  <img src="docs/question.png" width="250" alt="A question card from Claude with three answers to pick from">
</p>

Windows 10 and 11 only, for now.

## Install

You need [Node.js](https://nodejs.org) 18 or newer, plus Claude Code and/or Codex signed in on this computer.

```
npm install -g github:loyd000/sneakpeek
sneakpeek
```

The first start downloads Electron (about 100 MB) once.

On the first start, SneakPeek opens its Settings. Switch on the integrations you want under **Claude Code integration** and **Codex integration**:
- **Claude Code:** start a new `claude` session afterwards. Running sessions don't pick up new hooks.
- **Codex:** it asks you to approve the new hooks. Type `/hooks` in Codex, approve the SneakPeek entries, then restart the Codex desktop app.

Turn on **Start with Windows** in Settings if you want SneakPeek to start with Windows.

## Using it

- **Pick a style** in Settings → Widget:
  - **Edge tab:** a tab on the right edge of the screen.
  - **Island:** a floating pill at the top centre.
  - **Notch:** a notch hanging from the top edge.

  In Island and Notch, the pill stays empty until something happens. Then it stretches to show the live activity: Claude or Codex working (with a timer), the song playing, or a "done" note.
- **Hover** the tab (or island) to open the panel. **Click** it to keep the panel open.
- **Right-click** the tab, or click the tray icon, for Settings, Refresh and Quit.
- Running `sneakpeek` again while it's running opens Settings.
- Every `sneakpeek` start plays a small spinning logo in the terminal. Add `--quiet` to skip it.

## Update

SneakPeek checks GitHub for a new version a few times a day. When one is out, the tray icon's menu shows **Update to x.y.z**, and Settings shows **Update now**. Either one closes SneakPeek, installs the new version and starts it again.

You can also update from a terminal at any time:

```
sneakpeek update
```

Your settings stay as they are, and so do the hooks: they point at the same install folder.

**Installed before version 0.2.0?** Those copies can't update themselves yet, so update once by hand. Quit SneakPeek from the tray icon, then run `npm install -g github:loyd000/sneakpeek` and `sneakpeek`. From then on, updates work as described above.

### Releasing a new version (for the maintainer)

SneakPeek only shows an update when the version on GitHub is higher than the one installed. So with every release, raise the version and push:

```
npm version patch     # or: minor, for new features
git push --follow-tags
```

`npm version` raises the number in `package.json` and commits it. Everyone's SneakPeek sees the new version within a few hours.

## Uninstall

Remove SneakPeek's hooks first. Otherwise Claude Code and Codex keep calling a script that no longer exists:

```
sneakpeek --remove
npm uninstall -g sneakpeek
```

`--remove` takes SneakPeek's hooks and status line out of Claude Code and Codex, and removes its startup entry. Your own settings and other hooks aren't touched.

## Your data

- **No accounts.** SneakPeek reuses the sign-ins Claude Code and Codex already store on your computer (`~/.claude/.credentials.json` and `~/.codex/auth.json`).
- **Where your tokens go.** They're only sent to Anthropic and OpenAI, to the same usage endpoints the CLIs use for `/usage` and `/status`. When Claude's token expires, SneakPeek refreshes it and saves the new one to the same file, as Claude Code does.
- **What SneakPeek stores.** Its own settings, cached usage and activity live in `~/.sneakpeek/`.
- **How it changes your config.** It only ever adds or removes its own entries in `~/.claude/settings.json` and `~/.codex/hooks.json`, and saves a backup (`.bak-sneakpeek`) next to the file before each change. It refuses to touch a file that isn't valid JSON.
- **Music.** It reads Windows' own "now playing" info, the same as the volume-key popup. No Spotify login is needed.
- **Updates.** A few times a day it reads this repo's `package.json` to see whether there's a newer version. That's the only other request it makes.

## How it works

| File | What it does |
|---|---|
| `main.js` | The app: the tab window, tray, Settings window, polling, update checks |
| `index.html` | The tab and panel |
| `settings.html` | The Settings window |
| `usage.js` | Reads Claude and ChatGPT usage, with backoff for rate limits and a saved cache |
| `statusline.js` | Claude Code status line: passes live usage to SneakPeek after every reply |
| `activity.js` | Hook: records when Claude Code / Codex start and stop working |
| `ask.js` | Hook: shows permission prompts and questions in SneakPeek and returns your answer |
| `media.ps1` | PowerShell helper that reads Windows' now-playing info |
| `integrations.js` | Adds and removes SneakPeek's hooks safely |
| `cli.js` | The `sneakpeek` command: start, `update`, `--remove` |
| `banner.js` | The spinning 3D ASCII logo shown in the terminal |

The usage endpoints are undocumented. If Anthropic or OpenAI change them, `usage.js` needs updating. To see what SneakPeek reads, without the UI, run `node usage.js` in the install folder.

Running from a clone instead: `git clone`, then `npm install`, then `npm start`.

## Credits

Built by **Loyd De Guzman** ([@loyd000](https://github.com/loyd000)).

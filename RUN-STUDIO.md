# Run Motion Studio

## First time (once per Mac)
1. Install [Node.js](https://nodejs.org) 20 or newer, Google Chrome, ffmpeg and yt-dlp (`brew install ffmpeg yt-dlp`;
   yt-dlp downloads videos for References from a link).
2. Get the project and its libraries:
   ```bash
   git clone https://github.com/ishantperiwal/motionStudio.git
   cd motionStudio
   npm install
   npm run build
   ```
   (`npm run build` compiles the Lottie tools; run it again after pulling changes to `src/`.)

## Keep your films outside the studio (recommended)
Your scenes, notes and exports can live in their own folder next to the studio, so the studio stays just the tool
(safe to delete and clone again) and your films can go in your project's own git repository:
```
my-project/
  motion-studio/   ← the studio, cloned as above
  film/            ← your films: scenes/, notes/, out/
```
Tell the studio where the films are, once per copy:
```bash
cd motionStudio
echo ../film > project.txt
```
(The path is relative to the studio folder.) The first new scene you create there also writes a `RUN-STUDIO.md` into
that folder, with the exact commands for that project. Every command then uses that folder: the editor, exports, renders,
new scenes and the notes watcher. Without `project.txt` everything stays inside the studio folder, as before.
For a one-off you can also pass `--project <folder>` to any command (`npm run dev -- --project ../film`) or set
`MOTION_PROJECT=<folder>`. When the studio starts it prints the project it's using.

## Every time
1. Start it:
   ```bash
   cd motionStudio
   npm run dev
   ```
2. Start the notes watcher, so **▶ Send to Claude** works: in a Claude Code session opened in this folder, say
   > Start the notes watcher.

   (Claude runs `node tools/wait-for-notes.mjs` in the background. If Claude is the one starting the studio,
   it starts the watcher too, without being asked.) See [Working with Claude](#working-with-claude).
3. Open **http://localhost:5173/editor/** and pick a scene at the top.
4. Leave the terminal window open while you work. Stop it with `Ctrl+C`.

## Working with Claude
The **▶ Send to Claude** button only works while a Claude session is running the *notes watcher*
(`tools/wait-for-notes.mjs`). It isn't started by `npm run dev`; you start it from Claude.

The picker next to Send can send notes to another agent instead (Antigravity, Codex). That agent's session runs its
own watcher, `node tools/wait-for-notes.mjs --agent antigravity` (or `--agent codex`), and works only the notes sent
to it. A note already with one agent stays with it: sending again to another agent doesn't take it over.

1. Open a Claude Code session in the `motionStudio` folder and say:
   > Start the notes watcher.
2. In the editor, leave notes (press **S** and draw a box, or hold **⇧** while scrubbing for a span).
3. Press **▶ Send to Claude**. Claude works the notes, checks the result in rendered frames, and lists
   what changed under **To check**. It then starts the watcher again for your next round.

Claude follows the motion-design principles in [skills/motion-principles/SKILL.md](skills/motion-principles/SKILL.md)
by default (it's referenced from `CLAUDE.md`). They're defaults: tell Claude to skip any of them for a shot, a scene or
the session, and it will.

Good to know:
- **Watcher not running?** Pressing the button still saves your notes and the request waits. Nothing
  happens until a watcher starts; then Claude picks the notes up straight away. Nothing is lost.
- **It lasts as long as the Claude session.** Close or restart the session and you need to ask for the
  watcher again.
- **One watcher at a time.** Starting the watcher in a new chat replaces the one in an older chat (Claude says so),
  so Send always reaches the chat that started it last: normally the one where you started the studio.
- **Check if it's running:**
  ```bash
  pgrep -fl wait-for-notes
  ```
  No output means it's not running. If you have more than one copy of the studio, make sure one is
  running for *this* folder: `pgrep -fl wait-for-notes` lists every copy's watcher, and
  `lsof -p <pid> | grep cwd` shows which folder a watcher belongs to.

## Borrow from another video, or use your own files
Motion Studio menu → **References** (or **R**): a panel over the editor.
- **References tab:** paste a link (or drop a video), click it, then mark the moments you like (drag a span, box what
  matters, name it, **◆ Save**). Each one is saved with its frames and measurements at once.
- **Files tab:** your own footage, screenshots, icons and fonts.

In your film, a note's **+ reference** points at a moment ("make the card land like this"), and **+ media**, or
dropping a file onto the note, attaches a file as A1, A2… ("use A1 as the background"). Then **▶ Send to Claude**.
All of it stays in your project folder, never in the studio's git.

## Export a video
Press **⤓ Export MP4** in the editor. When it's done, press **Download**. Files are also saved in `out/` (in your
films folder, if you set one).

## New scene
```bash
npm run new-scene -- my-film
```
It's created in `scenes/` (in your films folder, if you set one). Then open it from the scene picker in the editor.

## Lottie animations
For animations that ship inside iOS, Android or web apps (icons, badges, coins, celebrations) rather than as videos.
They open in the same editor and take notes the same way; the editor shows a health check and **⤓ Export .lottie**
in place of Export MP4.
1. Make one:
   ```bash
   npm run new-lottie -- my-badge
   ```
   (Options: `--size 512x512`, `--fps 60`, `--frames 90`. It starts as a flipping coin; ask Claude to turn it into what
   you want, or give it an SVG.)
2. Leave notes and **▶ Send to Claude** as usual. Claude checks every change on a contact sheet of key frames before
   listing it under **To check**. To look at that sheet yourself:
   ```bash
   npm run verify-lottie -- my-badge
   ```
   It's saved as `out/my-badge-sheet.png`.
3. Press **⤓ Export .lottie**: `out/` gets `my-badge.json` and `my-badge.lottie`, ready for the app's Lottie player.

**Optional: Lottie tools for Claude (MCP).** The same pipeline is available to Claude as tools. Register it once, from
the studio folder:
```bash
claude mcp add motion-studio-lottie -- node dist/mcp/index.js
```

## If something's off
- **Editor won't load:** make sure `npm run dev` is still running in a terminal.
- **A scene is missing from the picker:** check the project the studio printed when it started; the scene's folder
  must be in that project's `scenes/`.
- **"Port in use":** another copy is already running — use that one, or close it and start again.
- **Send to Claude does nothing:** the watcher isn't running. Ask Claude to start the notes watcher; your
  waiting notes get picked up as soon as it does.
- **Export fails:** check that Chrome and ffmpeg are installed (`ffmpeg -version`).

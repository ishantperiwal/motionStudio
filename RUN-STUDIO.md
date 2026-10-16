# Run Motion Studio

## First time (once per Mac)
1. Install [Node.js](https://nodejs.org) 20 or newer, Google Chrome, and ffmpeg (`brew install ffmpeg`).
2. Get the project and its libraries:
   ```bash
   git clone https://github.com/ishantperiwal/motionStudio.git
   cd motionStudio
   npm install
   ```

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
- **Check if it's running:**
  ```bash
  pgrep -fl wait-for-notes
  ```
  No output means it's not running. If you have more than one copy of the studio, make sure one is
  running for *this* folder: `pgrep -fl wait-for-notes` lists every copy's watcher, and
  `lsof -p <pid> | grep cwd` shows which folder a watcher belongs to.

## Export a video
Press **⤓ Export MP4** in the editor. When it's done, press **Download**. Files are also saved in `out/`.

## New scene
```bash
npm run new-scene -- my-film
```
Then open it from the scene picker in the editor.

## If something's off
- **Editor won't load:** make sure `npm run dev` is still running in a terminal.
- **"Port in use":** another copy is already running — use that one, or close it and start again.
- **Send to Claude does nothing:** the watcher isn't running. Ask Claude to start the notes watcher; your
  waiting notes get picked up as soon as it does.
- **Export fails:** check that Chrome and ffmpeg are installed (`ffmpeg -version`).

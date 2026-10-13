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
2. Open **http://localhost:5173/editor/** and pick a scene at the top.
3. Leave the terminal window open while you work. Stop it with `Ctrl+C`.

## Working with Claude
1. Open a Claude Code session in the `motionStudio` folder and say:
   > Start the notes watcher.
2. In the editor, leave notes (press **S** and draw a box, or hold **⇧** while scrubbing for a span).
3. Press **▶ Send to Claude**. Claude works the notes; what changed shows up under **To check**.

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
- **Send to Claude does nothing:** the Claude session isn't watching — ask it to start the notes watcher again.
- **Export fails:** check that Chrome and ffmpeg are installed (`ffmpeg -version`).

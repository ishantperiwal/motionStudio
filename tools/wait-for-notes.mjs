// Blocks until the editor's "Send to Claude" button is pressed, then prints which scene and exits.
// Claude runs this in the background; its exit is what wakes the session to work the notes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const flag = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'notes', '_go.json');
for (;;) {
  if (fs.existsSync(flag)) {
    const go = JSON.parse(fs.readFileSync(flag, 'utf8'));
    fs.rmSync(flag);
    console.log(`NOTES SENT · scene=${go.scene} · at=${go.at}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

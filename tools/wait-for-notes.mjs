// Blocks until the editor's "Send to <Agent>" button is pressed, then prints which scene and exits.
// An agent runs this in the background; its exit is what wakes the session to work the notes.
// `--agent <id>` picks whose Send to wait for (claude by default; antigravity, codex).
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT } from '../server/project.mjs';

const AGENTS = ['claude', 'antigravity', 'codex'];
const i = process.argv.indexOf('--agent');
const agent = i > 1 ? (process.argv[i + 1] || '').toLowerCase() : 'claude';
if (!AGENTS.includes(agent)) {
  console.error(`Unknown agent "${process.argv[i + 1] || ''}": use --agent ${AGENTS.join(' | ')}`);
  process.exit(1);
}
const flag = path.join(PROJECT, 'notes', agent === 'claude' ? '_go.json' : `_go.${agent}.json`);   // written by /api/go

for (;;) {
  if (fs.existsSync(flag)) {
    const go = JSON.parse(fs.readFileSync(flag, 'utf8'));
    fs.rmSync(flag);
    console.log(`NOTES SENT · agent=${go.agent || agent} · scene=${go.scene} · at=${go.at}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

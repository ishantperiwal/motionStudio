// Blocks until the editor's "Send to <Agent>" button is pressed, then prints which scene and exits.
// An agent runs this in the background; its exit is what wakes the session to work the notes.
// `--agent <id>` picks whose Send to wait for (claude by default; antigravity, codex).
//
// One watcher per project and agent: starting one replaces any earlier one (from another chat, say), so Send always
// reaches the session that started it last. Its first line says whether it replaced one. A replaced watcher exits
// with "WATCHER REPLACED" (code 3): its session must not start it again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECT } from '../server/project.mjs';

const AGENTS = ['claude', 'antigravity', 'codex'];
const i = process.argv.indexOf('--agent');
const agent = i > 1 ? (process.argv[i + 1] || '').toLowerCase() : 'claude';
if (!AGENTS.includes(agent)) {
  console.error(`Unknown agent "${process.argv[i + 1] || ''}": use --agent ${AGENTS.join(' | ')}`);
  process.exit(1);
}
const flag = path.join(PROJECT, 'notes', agent === 'claude' ? '_go.json' : `_go.${agent}.json`);   // written by /api/go

// who is watching: a small lock file per project + agent, outside the project (it isn't the film's business)
const lockDir = path.join(os.tmpdir(), 'motion-studio-watchers');
const lock = path.join(lockDir, `${crypto.createHash('sha1').update(PROJECT).digest('hex').slice(0, 12)}-${agent}.json`);
const readLock = () => { try { return JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
fs.mkdirSync(lockDir, { recursive: true });
const prev = readLock();
const me = { pid: process.pid, startedAt: new Date().toISOString(), project: PROJECT, agent };
fs.writeFileSync(lock, JSON.stringify(me));
const ours = () => readLock()?.pid === process.pid;
const stamp = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
if (prev && prev.pid !== process.pid && alive(prev.pid)) {
  try { process.kill(prev.pid, 'SIGTERM'); } catch {}   // it also notices the lock changed, within a second
  console.log(`WATCHING · agent=${agent} · replaced an earlier watcher (pid ${prev.pid}, started ${stamp(prev.startedAt)}): Send now comes to this session`);
} else console.log(`WATCHING · agent=${agent} · project=${PROJECT}`);

const replaced = () => {
  console.log(`WATCHER REPLACED · another session now takes "${agent}" notes for this project · don't start this watcher again`);
  process.exit(3);
};
process.on('SIGTERM', () => { if (!ours()) replaced(); fs.rmSync(lock, { force: true }); process.exit(0); });   // replaced, or just stopped

for (;;) {
  if (!ours()) replaced();
  if (fs.existsSync(flag)) {
    const go = JSON.parse(fs.readFileSync(flag, 'utf8'));
    fs.rmSync(flag);
    fs.rmSync(lock, { force: true });
    console.log(`NOTES SENT · agent=${go.agent || agent} · scene=${go.scene} · at=${go.at}`);
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

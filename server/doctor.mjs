// What Motion Studio needs to run, checked in one place: `npm run doctor` reports it, `--fix` installs what's
// missing, `npm install` sets up the npm-side pieces after itself, and the dev server warns on start.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, PROJECT } from './project.mjs';
import { CHROME } from './chrome.mjs';

const require = createRequire(path.join(ROOT, 'package.json'));
const OS = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';

// first line of a tool's version output, or null when it isn't on the PATH
const version = (cmd, flag = '-version') => {
  const r = spawnSync(cmd, [flag], { encoding: 'utf8', shell: OS === 'win' });
  return r.status === 0 ? (r.stdout || r.stderr).split('\n')[0].trim() : null;
};
const newestIn = (dir) => {
  let t = 0;
  if (!fs.existsSync(dir)) return t;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestIn(p) : fs.statSync(p).mtimeMs);
  }
  return t;
};
// system tools: how to install them on each OS (winget and brew run by --fix; apt needs sudo, so it's printed)
const SYSTEM = {
  ffmpeg: { win: 'winget install --id Gyan.FFmpeg -e', mac: 'brew install ffmpeg', linux: 'sudo apt install ffmpeg' },
  'yt-dlp': { win: 'winget install --id yt-dlp.yt-dlp -e', mac: 'brew install yt-dlp', linux: 'sudo apt install yt-dlp' },
};

/** Every check: { id, label, ok, detail, fix (a command), auto (--fix may run it), required (things break without it) }. */
export function checks() {
  const out = [];
  const node = +process.versions.node.split('.')[0];
  out.push({ id: 'node', label: 'Node.js 20+', ok: node >= 20, detail: process.versions.node, fix: 'install Node.js 20 or newer (https://nodejs.org)', required: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const missing = names.filter((n) => !fs.existsSync(path.join(ROOT, 'node_modules', ...n.split('/'), 'package.json')));
  out.push({ id: 'packages', label: 'npm packages', ok: !missing.length, detail: missing.length ? `missing: ${missing.join(', ')}` : `${names.length} installed`, fix: 'npm install', auto: true, required: true });

  // the Lottie compiler (src/ → dist/): every Lottie tool loads it from dist/
  const built = fs.existsSync(path.join(ROOT, 'dist', 'compiler', 'index.js')) ? newestIn(path.join(ROOT, 'dist')) : 0;
  const stale = built && newestIn(path.join(ROOT, 'src')) > built;
  out.push({ id: 'build', label: 'Lottie compiler', ok: !!built && !stale, detail: !built ? 'not built' : stale ? 'out of date: src/ changed since the last build' : 'built', fix: 'npm run build', auto: true, required: true });

  // Playwright's own Chromium, the exact build its version expects (headless runs use its headless shell)
  let exe = null;
  try { exe = require('playwright').chromium.executablePath(); } catch {}
  const rev = exe?.match(/chromium-(\d+)/)?.[1];
  const shell = rev ? path.join(exe.split(`chromium-${rev}`)[0], `chromium_headless_shell-${rev}`) : null;
  const browserOk = !!exe && fs.existsSync(exe) && (!shell || fs.existsSync(shell));
  const standIn = CHROME.executablePath ? path.basename(CHROME.executablePath) : null;
  out.push({ id: 'browser', label: 'Render browser', ok: browserOk,
    detail: browserOk ? `Playwright Chromium ${rev}` : `Playwright Chromium ${rev ?? ''} missing${standIn ? ` · ${standIn} stands in for now` : ''}`,
    fix: 'npx playwright install chromium', auto: true, required: !standIn });

  const ff = version('ffmpeg'), fp = version('ffprobe');
  out.push({ id: 'ffmpeg', label: 'ffmpeg + ffprobe', ok: !!(ff && fp), detail: ff && fp ? ff.replace(/ Copyright.*/, '') : `${ff ? '' : 'ffmpeg '}${fp ? '' : 'ffprobe '}missing · renders, exports and reference clips need it`, fix: SYSTEM.ffmpeg[OS], system: 'ffmpeg', required: true });

  const yt = version('yt-dlp', '--version');
  out.push({ id: 'yt-dlp', label: 'yt-dlp', ok: !!yt, detail: yt ? yt : 'missing · only needed to add references from a link', fix: SYSTEM['yt-dlp'][OS], system: 'yt-dlp', required: false });

  out.push({ id: 'project', label: 'Project folder', ok: fs.existsSync(PROJECT), detail: PROJECT, fix: `create ${PROJECT}, or point project.txt / --project at the right folder`, required: true });
  return out;
}

/** Runs one check's fix. npm-side fixes always run; system installs only where winget (Windows) or brew (macOS) is there. */
export function runFix(c) {
  if (c.system) {
    const manager = OS === 'win' ? 'winget' : OS === 'mac' ? 'brew' : null;
    if (!manager || !version(manager, '--version')) return false;
  } else if (!c.auto) return false;
  const r = spawnSync(c.fix, { stdio: 'inherit', shell: true, cwd: ROOT });
  return r.status === 0;
}

/** One line for the dev server's start: what's missing and what to run, or nothing when all is well. */
export function startupWarning() {
  const bad = checks().filter((c) => !c.ok);
  if (!bad.length) return null;
  return `Setup: ${bad.map((c) => c.label).join(', ')} ${bad.length === 1 ? 'needs' : 'need'} attention → npm run doctor`;
}

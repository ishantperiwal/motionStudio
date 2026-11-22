// The browser for capturing frames: Playwright's own Chromium (npx playwright install chromium), never the user's Google
// Chrome app. A hidden instance of the real Chrome app takes its place on macOS: with the user's Chrome closed, clicking
// Chrome just wakes the invisible one and no window opens. Chromium can't decode H.264, so videos in scenes are WebM.
// On Windows, Edge (or Chrome) stands in, so captures work even when Playwright's Chromium build isn't installed.
// Its default GPU memory limit is too small for heavy 3D scenes: past it, frames quietly skip drawing parts (layers come
// out blank) even in screenshots. A higher limit keeps every frame complete.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './project.mjs';

// Playwright's Chromium (and the headless shell it launches by default) for this Playwright version, if installed
const playwrightBrowser = (() => {
  try {
    const exe = createRequire(path.join(ROOT, 'package.json'))('playwright').chromium.executablePath();
    const rev = exe.match(/chromium-(\d+)/)?.[1];
    return fs.existsSync(exe) && (!rev || fs.existsSync(path.join(exe.split(`chromium-${rev}`)[0], `chromium_headless_shell-${rev}`)));
  } catch { return false; }
})();
const FALLBACK_BROWSER = process.platform === 'win32' && !playwrightBrowser
  ? ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p))
  : undefined;
export const CHROME = {
  args: ['--force-gpu-mem-available-mb=8192', '--force-gpu-mem-discardable-limit-mb=4096'],
  ...(FALLBACK_BROWSER ? { executablePath: FALLBACK_BROWSER } : {}),
};

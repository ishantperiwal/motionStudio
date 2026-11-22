import fs from 'node:fs';
import type { Browser, LaunchOptions } from 'playwright';

const WIN_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const LINUX_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/microsoft-edge',
];

export function findSystemBrowser(): string | undefined {
  if (process.env.MOTION_CHROME_PATH && fs.existsSync(process.env.MOTION_CHROME_PATH)) {
    return process.env.MOTION_CHROME_PATH;
  }
  const candidates =
    process.platform === 'win32'
      ? WIN_CANDIDATES
      : process.platform === 'linux'
        ? LINUX_CANDIDATES
        : [];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Launches Playwright Chromium if installed, cleanly falling back to system Edge/Chrome
 * on Windows/Linux so visual rendering, hit-testing, and Filter-to-Raster baking work out of the box.
 */
export async function launchHeadlessBrowser(extraArgs: string[] = []): Promise<Browser> {
  const { chromium } = await import('playwright');
  const baseArgs = ['--no-sandbox', '--disable-setuid-sandbox', ...extraArgs];
  const opts: LaunchOptions = { headless: true, args: baseArgs };

  try {
    return await chromium.launch(opts);
  } catch (err) {
    const sys = findSystemBrowser();
    if (!sys) throw err;
    return chromium.launch({ ...opts, executablePath: sys });
  }
}

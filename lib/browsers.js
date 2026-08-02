import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/**
 * Use Playwright's shared default cache (same as `npx playwright install`).
 * Do not force a project-local `.playwright/` folder — that caused a second download.
 */
export function applyBrowsersPath(env = process.env) {
  delete env.PLAYWRIGHT_BROWSERS_PATH;
  return getBrowsersDir();
}

/** Resolved cache root, e.g. %LOCALAPPDATA%\\ms-playwright */
export function getBrowsersDir() {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright-core');
  // .../ms-playwright/chromium-XXXX/chrome-win64/chrome.exe → ms-playwright
  return path.resolve(path.dirname(chromium.executablePath()), '..', '..');
}

/** @deprecated Prefer getBrowsersDir() — kept as alias for existing imports. */
export const browsersDir = getBrowsersDir;

export function getToolsStatus() {
  applyBrowsersPath();
  const require = createRequire(import.meta.url);
  const { chromium, firefox, webkit } = require('playwright-core');

  const browsers = [
    { id: 'chromium', label: 'Chromium', executable: chromium.executablePath() },
    { id: 'firefox', label: 'Firefox', executable: firefox.executablePath() },
    { id: 'webkit', label: 'WebKit', executable: webkit.executablePath() },
  ].map((browser) => ({
    ...browser,
    installed: fs.existsSync(browser.executable),
  }));

  const missing = browsers.filter((b) => !b.installed).map((b) => b.label);
  const installed = missing.length === 0;
  const dir = getBrowsersDir();

  return {
    installed,
    browsersDir: dir,
    browsers,
    missing,
    message: installed
      ? `Browsers ready at ${dir}`
      : `Missing: ${missing.join(', ')}. Install once via the console or npx playwright install.`,
  };
}

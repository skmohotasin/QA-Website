import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Playwright browsers live inside the repo (gitignored). */
export const browsersDir = path.join(root, '.playwright');

// Must be set before playwright-core is loaded.
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;

const require = createRequire(import.meta.url);
const { chromium, firefox, webkit } = require('playwright-core');

export function applyBrowsersPath(env = process.env) {
  env.PLAYWRIGHT_BROWSERS_PATH = browsersDir;
  return browsersDir;
}

export function getToolsStatus() {
  applyBrowsersPath();

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

  return {
    installed,
    browsersDir,
    browsers,
    missing,
    message: installed
      ? `Browsers ready in ${browsersDir}`
      : `Missing: ${missing.join(', ')}. Install them into this repo to run tests.`,
  };
}

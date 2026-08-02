import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { applyBrowsersPath, browsersDir } from '../lib/browsers.js';
import { readSiteUrls, slugFromUrl } from '../lib/site-urls.js';
import { writeClientReports } from '../reporters/client-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(root, 'reports');
const tempRoot = path.join(root, 'data', 'temp');
const tempRuns = path.join(tempRoot, 'runs');

applyBrowsersPath();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(root, '.env'));

function clearTemp() {
  if (fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function playwrightCli() {
  const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
  if (fs.existsSync(cli)) {
    return { command: process.execPath, argsPrefix: [cli] };
  }
  return { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', argsPrefix: ['playwright'] };
}

function runPlaywright(testArgs, env) {
  const { command, argsPrefix } = playwrightCli();
  const args = [...argsPrefix, 'test', ...testArgs, '--project=chromium'];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onSignal = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);

    for (const stream of ['stdout', 'stderr']) {
      child[stream].on('data', (chunk) => {
        process.stdout.write(chunk);
      });
    }

    child.on('close', (code) => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve(code ?? 1);
    });

    child.on('error', (err) => {
      console.error(err);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolve(1);
    });
  });
}

function mergeReports(pageReports, website, suiteLabel) {
  const startedAt =
    pageReports.map((p) => p.startedAt).sort()[0] || new Date().toISOString();
  const endedAt = new Date().toISOString();
  const results = [];
  const bugs = [];
  const pages = [];

  for (const page of pageReports) {
    pages.push({
      url: page.website,
      overall: page.overall,
      totals: page.totals,
    });

    for (const item of page.results || []) {
      results.push({
        ...item,
        pageUrl: page.website,
        title: item.title,
        suite: `${suiteLabel} · ${page.website}`,
      });
    }

    for (const bug of page.bugs || []) {
      bugs.push({
        ...bug,
        website: page.website,
        id: `BUG-${String(bugs.length + 1).padStart(3, '0')}`,
      });
    }
  }

  const totals = {
    total: results.length,
    passed: results.filter((r) => r.status === 'passed').length,
    failed: results.filter((r) =>
      ['failed', 'timedOut', 'interrupted'].includes(r.status),
    ).length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    bugs: bugs.length,
  };

  return {
    website,
    suite: suiteLabel,
    pageCount: pages.length,
    pages,
    startedAt,
    endedAt,
    overall: totals.failed === 0 ? 'Passed' : 'Needs attention',
    totals,
    results,
    bugs,
  };
}

async function main() {
  const suiteKey = process.argv[2] || 'smoke';
  const testPaths = process.argv.slice(3);
  const paths = testPaths.length ? testPaths : ['tests/smoke'];
  const suiteLabel = suiteKey.charAt(0).toUpperCase() + suiteKey.slice(1);
  const scope = process.env.SITE_RUN_SCOPE === 'all' ? 'all' : 'current';

  const list = readSiteUrls();
  const fallback = (process.env.BASE_URL || 'https://example.com').replace(/\/$/, '');
  const website = list?.website || fallback;
  let urls;
  if (scope === 'all' && list?.urls?.length) {
    urls = [...list.urls];
  } else {
    const single = fallback.endsWith('/') ? fallback : `${fallback}/`;
    urls = [single];
  }
  const maxUrls = Number(process.env.SITE_MULTI_MAX_URLS) || 0;
  if (maxUrls > 0) urls = urls.slice(0, maxUrls);

  console.log(`${suiteLabel} · scope=${scope} · ${urls.length} URL(s)`);
  console.log(`Website: ${website}`);
  console.log(`Temp: ${tempRuns}`);

  clearTemp();
  fs.mkdirSync(tempRuns, { recursive: true });

  const pageReports = [];
  let failedRuns = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const slug = slugFromUrl(url, i);
    const outDir = path.join(tempRuns, slug);
    fs.mkdirSync(outDir, { recursive: true });

    console.log(`\n[${i + 1}/${urls.length}] ${suiteLabel} → ${url}`);

    const env = {
      ...process.env,
      BASE_URL: website.replace(/\/$/, '') || website,
      PAGE_URL: url,
      CLIENT_REPORT_DIR: outDir,
      PLAYWRIGHT_BROWSERS_PATH: browsersDir,
      NODE_NO_WARNINGS: '1',
    };
    delete env.NO_COLOR;
    delete env.FORCE_COLOR;
    delete env.npm_config_devdir;
    delete env.NPM_CONFIG_DEVDIR;

    const code = await runPlaywright(paths, env);
    const jsonPath = path.join(outDir, 'client-report.json');

    if (!fs.existsSync(jsonPath)) {
      console.log(`  no report written (exit ${code})`);
      failedRuns += 1;
      pageReports.push({
        website: url,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        overall: 'Needs attention',
        totals: { total: 0, passed: 0, failed: 1, skipped: 0, bugs: 1 },
        results: [
          {
            suite: suiteLabel,
            title: `${suiteLabel} run failed to produce a report`,
            meaning: 'The automated run did not finish cleanly for this URL.',
            technicalTitle: 'runner-error',
            project: 'chromium',
            status: 'failed',
            durationMs: 0,
            shortError: `Playwright exited with code ${code}`,
            pageUrl: url,
          },
        ],
        bugs: [
          {
            id: 'BUG-TMP',
            title: `${suiteLabel} run failed`,
            severity: 'Critical',
            website: url,
            browser: 'chromium',
            steps: `1. Open ${url}\n2. Run ${suiteLabel}.`,
            expected: 'Suite completes and writes a report.',
            actual: `Playwright exited with code ${code}`,
            suite: suiteLabel,
            date: new Date().toISOString(),
          },
        ],
      });
      continue;
    }

    const pageSummary = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    pageSummary.website = url;
    for (const bug of pageSummary.bugs || []) {
      bug.website = url;
    }
    pageReports.push(pageSummary);
    console.log(
      `  → ${pageSummary.overall} · ${pageSummary.totals.passed}/${pageSummary.totals.total} checks · saved ${path.relative(root, outDir)}`,
    );
    if (code !== 0) failedRuns += 1;
  }

  const merged = mergeReports(pageReports, website, suiteLabel);
  writeClientReports(merged, reportsDir);

  console.log('\nCombined report written');
  console.log(`Pages: ${merged.pageCount}`);
  console.log(`Checks: ${merged.totals.passed}/${merged.totals.total} passed`);
  console.log(`Bugs: ${merged.totals.bugs}`);
  console.log(`Overall: ${merged.overall}`);
  console.log('Saved: reports/client-report.html + bug-reports.html');

  clearTemp();
  console.log('Temp data cleared.');

  process.exit(failedRuns > 0 || merged.totals.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  try {
    clearTemp();
  } catch {
    // ignore
  }
  process.exit(1);
});

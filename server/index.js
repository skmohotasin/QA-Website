import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import {
  applyBrowsersPath,
  browsersDir,
  getToolsStatus,
} from '../lib/browsers.js';
import { getSiteUrlsStatus, siteUrlsPath } from '../lib/site-urls.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const reportsDir = path.join(root, 'reports');
const envPath = path.join(root, '.env');
const PORT = Number(process.env.PORT) || 4173;

applyBrowsersPath();

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let activeRun = null;
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

const SUITES = {
  smoke: {
    label: 'Smoke',
    args: ['test', 'tests/smoke', '--project=chromium'],
  },
  functional: {
    label: 'Functional',
    args: ['test', 'tests/functional', '--project=chromium'],
  },
  uiux: {
    label: 'UI / UX',
    args: ['test', 'tests/ui', 'tests/a11y', '--project=chromium'],
  },
  a11y: {
    label: 'A11y',
    args: ['test', 'tests/a11y', '--project=chromium'],
  },
  api: {
    label: 'API / Network',
    args: ['test', 'tests/api', '--project=chromium'],
  },
  regression: {
    label: 'Regression',
    args: [
      'test',
      'tests/smoke',
      'tests/functional',
      'tests/ui',
      'tests/a11y',
      'tests/api',
      '--project=chromium',
    ],
  },
  lighthouse: {
    label: 'Lighthouse',
    runner: 'lighthouse',
    args: [path.join(root, 'scripts', 'run-lighthouse.mjs')],
  },
  'discover-urls': {
    label: 'Find all URLs',
    runner: 'discover-urls',
    args: [path.join(root, 'scripts', 'discover-urls.mjs')],
  },
  'site-audit': {
    label: 'Audit entire site',
    runner: 'site-audit',
    args: [path.join(root, 'scripts', 'audit-site.mjs')],
  },
  all: {
    label: 'All suites',
    args: ['test', '--project=chromium'],
  },
  headed: {
    label: 'All (headed)',
    args: ['test', '--project=chromium', '--headed'],
  },
  browsers: {
    label: 'All browsers',
    args: ['test'],
  },
};

function readBaseUrl() {
  try {
    if (!fs.existsSync(envPath)) return 'https://example.com';
    const match = fs.readFileSync(envPath, 'utf8').match(/^BASE_URL=(.*)$/m);
    return match ? match[1].trim() : 'https://example.com';
  } catch {
    return 'https://example.com';
  }
}

function writeBaseUrl(url) {
  const normalized = url.trim().replace(/\/$/, '');
  let next = `BASE_URL=${normalized}\n`;
  if (fs.existsSync(envPath)) {
    const current = fs.readFileSync(envPath, 'utf8');
    next = /^BASE_URL=/m.test(current)
      ? current.replace(/^BASE_URL=.*$/m, `BASE_URL=${normalized}`)
      : `${current.trimEnd()}\nBASE_URL=${normalized}\n`;
  }
  fs.writeFileSync(envPath, next.endsWith('\n') ? next : `${next}\n`, 'utf8');
  return normalized;
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    }[ext] || 'application/octet-stream'
  );
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function getClientReport() {
  const html = path.join(reportsDir, 'client-report.html');
  const json = path.join(reportsDir, 'client-report.json');
  const bugsHtml = path.join(reportsDir, 'bug-reports.html');
  const bugsMd = path.join(reportsDir, 'bug-reports.md');
  const lighthouseSummary = path.join(reportsDir, 'lighthouse-summary.html');
  const lighthouseFull = path.join(reportsDir, 'lighthouse-full.html');
  const lighthouseJson = path.join(reportsDir, 'lighthouse.json');
  const siteSummary = path.join(reportsDir, 'site-audit-summary.html');
  const siteFull = path.join(reportsDir, 'site-audit-full.html');
  const siteJson = path.join(reportsDir, 'site-audit.json');

  const hasClient = fs.existsSync(html);
  const hasLighthouse = fs.existsSync(lighthouseSummary);
  const hasSiteAudit = fs.existsSync(siteSummary);

  if (!hasClient && !hasLighthouse && !hasSiteAudit) {
    return { available: false };
  }

  let summary = null;
  if (hasClient && fs.existsSync(json)) {
    try {
      summary = JSON.parse(fs.readFileSync(json, 'utf8'));
    } catch {
      summary = null;
    }
  }

  let lighthouse = null;
  if (hasLighthouse && fs.existsSync(lighthouseJson)) {
    try {
      lighthouse = JSON.parse(fs.readFileSync(lighthouseJson, 'utf8'));
    } catch {
      lighthouse = null;
    }
  }

  let siteAudit = null;
  if (hasSiteAudit && fs.existsSync(siteJson)) {
    try {
      siteAudit = JSON.parse(fs.readFileSync(siteJson, 'utf8'));
    } catch {
      siteAudit = null;
    }
  }

  const clientMtime = hasClient ? fs.statSync(html).mtimeMs : 0;
  const lighthouseMtime = hasLighthouse ? fs.statSync(lighthouseSummary).mtimeMs : 0;
  const siteMtime = hasSiteAudit ? fs.statSync(siteSummary).mtimeMs : 0;
  const newest = Math.max(clientMtime, lighthouseMtime, siteMtime);
  let latestKind = 'client';
  if (newest === siteMtime && hasSiteAudit) latestKind = 'site-audit';
  else if (newest === lighthouseMtime && hasLighthouse) latestKind = 'lighthouse';
  else if (hasClient) latestKind = 'client';
  else if (hasSiteAudit) latestKind = 'site-audit';
  else latestKind = 'lighthouse';

  return {
    available: true,
    latestKind,
    htmlUrl: hasClient ? '/reports/client-report.html' : null,
    mdUrl: hasClient ? '/reports/client-report.md' : null,
    jsonUrl: hasClient ? '/reports/client-report.json' : null,
    bugsHtmlUrl: fs.existsSync(bugsHtml) ? '/reports/bug-reports.html' : null,
    bugsMdUrl: fs.existsSync(bugsMd) ? '/reports/bug-reports.md' : null,
    lighthouseSummaryUrl: hasLighthouse ? '/reports/lighthouse-summary.html' : null,
    lighthouseFullUrl: fs.existsSync(lighthouseFull)
      ? '/reports/lighthouse-full.html'
      : null,
    siteAuditSummaryUrl: hasSiteAudit ? '/reports/site-audit-summary.html' : null,
    siteAuditFullUrl: fs.existsSync(siteFull) ? '/reports/site-audit-full.html' : null,
    bugCount:
      latestKind === 'site-audit'
        ? siteAudit?.totals?.issues ?? 0
        : summary?.totals?.bugs ?? summary?.bugs?.length ?? 0,
    summary,
    lighthouse,
    siteAudit,
    updatedAt: new Date(newest).toISOString(),
  };
}

function serveFile(res, filePath, downloadName) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  const headers = {
    'Content-Type': contentType(filePath),
    'Cache-Control': 'no-store',
  };
  if (downloadName) {
    headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(publicDir, rel));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
}

function playwrightCommand() {
  const cli = path.join(
    root,
    'node_modules',
    '@playwright',
    'test',
    'cli.js',
  );
  return { command: process.execPath, argsPrefix: [cli] };
}

function filterLogNoise(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      if (!line) return true;
      if (line.includes("NO_COLOR' env is ignored")) return false;
      if (line.includes('NO_COLOR env is ignored')) return false;
      if (line.includes('Use `node --trace-warnings')) return false;
      if (line.includes('injected env')) return false;
      if (line.includes('npm warn Unknown env config "devdir"')) return false;
      if (line.includes('npm notice run')) return false;
      return true;
    })
    .join('\n');
}

function spawnPlaywright(args, { baseURL, label, suiteKey, kind, runner }) {
  if (activeRun) {
    return { ok: false, error: 'Another task is already in progress' };
  }

  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersDir,
  };
  // Cursor/sandbox may inject this; npm warns on unknown config "devdir".
  delete env.npm_config_devdir;
  delete env.NPM_CONFIG_DEVDIR;
  // Avoid Node's "NO_COLOR ignored because FORCE_COLOR is set" worker warning.
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  // Keep worker startup quiet in the web console.
  env.NODE_NO_WARNINGS = '1';
  if (baseURL) env.BASE_URL = baseURL;

  fs.mkdirSync(browsersDir, { recursive: true });

  let command;
  let commandArgs;
  if (runner === 'lighthouse' || runner === 'site-audit' || runner === 'discover-urls') {
    command = process.execPath;
    commandArgs = args;
  } else {
    const { command: pwCommand, argsPrefix } = playwrightCommand();
    command = pwCommand;
    commandArgs = [...argsPrefix, ...args];
  }

  const child = spawn(command, commandArgs, {
    cwd: root,
    env,
  });

  activeRun = child;
  broadcast('run-start', {
    suite: suiteKey,
    label,
    kind,
    baseURL: baseURL || readBaseUrl(),
  });

  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (chunk) => {
      const text = filterLogNoise(chunk.toString());
      if (text) broadcast('log', { stream, text });
    });
  }

  child.on('close', (code) => {
    activeRun = null;
    const tools = getToolsStatus();
    // Small delay so reporters can finish writing files.
    setTimeout(() => {
      const report =
        kind === 'test' ||
        kind === 'lighthouse' ||
        kind === 'site-audit' ||
        kind === 'discover-urls'
          ? getClientReport()
          : { available: false };
      broadcast('run-end', {
        suite: suiteKey,
        label,
        kind,
        code: code ?? 1,
        ok: code === 0,
        tools,
        report,
        siteUrls: getSiteUrlsStatus(),
      });
      if (kind === 'install') {
        broadcast('tools', tools);
      }
    }, 150);
  });

  child.on('error', (err) => {
    activeRun = null;
    broadcast('log', { stream: 'stderr', text: String(err) });
    broadcast('run-end', {
      suite: suiteKey,
      label,
      kind,
      code: 1,
      ok: false,
      tools: getToolsStatus(),
      report: { available: false },
    });
  });

  return { ok: true, suite: suiteKey, label, kind };
}

function runSuite(suiteKey) {
  const suite = SUITES[suiteKey];
  if (!suite) {
    return { ok: false, error: 'Unknown suite' };
  }

  const tools = getToolsStatus();
  const chromium = tools.browsers.find((b) => b.id === 'chromium');
  if (
    suite.runner === 'lighthouse' ||
    suite.runner === 'site-audit' ||
    suite.runner === 'discover-urls'
  ) {
    if (!chromium?.installed) {
      return {
        ok: false,
        error:
          'Chromium is not installed in this repo yet. Use Install browsers first.',
        tools,
      };
    }
  } else if (!tools.installed) {
    return {
      ok: false,
      error:
        'Playwright browsers are not installed in this repo yet. Use Install browsers first.',
      tools,
    };
  }

  if (suite.runner === 'site-audit') {
    const urls = getSiteUrlsStatus();
    if (!urls.available) {
      return {
        ok: false,
        error:
          'No URL list yet. Click "Find all URLs" first to crawl and save data/site-urls.json.',
        tools,
        siteUrls: urls,
      };
    }
  }

  return spawnPlaywright(suite.args, {
    baseURL: readBaseUrl(),
    label: suite.label,
    suiteKey,
    kind:
      suite.runner === 'lighthouse'
        ? 'lighthouse'
        : suite.runner === 'site-audit'
          ? 'site-audit'
          : suite.runner === 'discover-urls'
            ? 'discover-urls'
            : 'test',
    runner: suite.runner,
  });
}

function installTools() {
  return spawnPlaywright(['install'], {
    label: 'Install browsers',
    suiteKey: 'install',
    kind: 'install',
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/config') {
    const tools = getToolsStatus();
    return sendJson(res, 200, {
      baseURL: readBaseUrl(),
      suites: Object.entries(SUITES)
        .filter(([id]) => id !== 'discover-urls')
        .map(([id, s]) => ({
          id,
          label: s.label,
        })),
      running: Boolean(activeRun),
      tools,
      report: getClientReport(),
      siteUrls: getSiteUrlsStatus(),
    });
  }

  if (req.method === 'GET' && pathname === '/api/site-urls') {
    return sendJson(res, 200, getSiteUrlsStatus());
  }

  if (req.method === 'GET' && pathname === '/data/site-urls.json') {
    if (!fs.existsSync(siteUrlsPath)) {
      return sendJson(res, 404, { error: 'URL list not found. Run Find all URLs first.' });
    }
    const download = url.searchParams.get('download') === '1';
    return serveFile(
      res,
      siteUrlsPath,
      download ? 'site-urls.json' : undefined,
    );
  }

  if (req.method === 'GET' && pathname === '/api/tools') {
    return sendJson(res, 200, getToolsStatus());
  }

  if (
    req.method === 'GET' &&
    (pathname === '/reports/client-report.html' ||
      pathname === '/reports/client-report.md' ||
      pathname === '/reports/client-report.json' ||
      pathname === '/reports/bug-reports.html' ||
      pathname === '/reports/bug-reports.md' ||
      pathname === '/reports/lighthouse-summary.html' ||
      pathname === '/reports/lighthouse-summary.md' ||
      pathname === '/reports/lighthouse-full.html' ||
      pathname === '/reports/lighthouse-full.md' ||
      pathname === '/reports/lighthouse.json' ||
      pathname === '/reports/site-audit-summary.html' ||
      pathname === '/reports/site-audit-summary.md' ||
      pathname === '/reports/site-audit-full.html' ||
      pathname === '/reports/site-audit-full.md' ||
      pathname === '/reports/site-audit.json')
  ) {
    const name = path.basename(pathname);
    const download = url.searchParams.get('download') === '1';
    return serveFile(
      res,
      path.join(reportsDir, name),
      download ? name : undefined,
    );
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    const body = await readBody(req);
    if (!body.url || !isValidHttpUrl(body.url)) {
      return sendJson(res, 400, {
        error: 'Enter a valid http(s) URL, e.g. https://example.com',
      });
    }
    const baseURL = writeBaseUrl(body.url);
    broadcast('config', { baseURL });
    return sendJson(res, 200, { baseURL });
  }

  if (req.method === 'POST' && pathname === '/api/install-tools') {
    const result = installTools();
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  if (req.method === 'POST' && pathname === '/api/run') {
    const body = await readBody(req);
    if (body.url) {
      if (!isValidHttpUrl(body.url)) {
        return sendJson(res, 400, { error: 'Invalid URL' });
      }
      writeBaseUrl(body.url);
    }
    const result = runSuite(body.suite || 'all');
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  if (req.method === 'POST' && pathname === '/api/stop') {
    if (!activeRun) {
      return sendJson(res, 200, { ok: true, stopped: false });
    }
    activeRun.kill();
    activeRun = null;
    broadcast('run-end', {
      suite: 'stopped',
      label: 'Stopped',
      kind: 'stop',
      code: 1,
      ok: false,
      tools: getToolsStatus(),
    });
    return sendJson(res, 200, { ok: true, stopped: true });
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(
      `event: hello\ndata: ${JSON.stringify({
        baseURL: readBaseUrl(),
        tools: getToolsStatus(),
      })}\n\n`,
    );
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET') {
    return serveStatic(req, res, pathname);
  }

  res.writeHead(405).end('Method not allowed');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the other process, or run with PORT=4174 npm start`,
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const tools = getToolsStatus();
  console.log(`QA Website console → http://localhost:${PORT}`);
  console.log(
    tools.installed
      ? `Browsers: ready (${browsersDir})`
      : `Browsers: missing — open the console and click Install browsers`,
  );
});

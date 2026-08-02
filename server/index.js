import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const envPath = path.join(root, '.env');
const PORT = Number(process.env.PORT) || 4173;

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let activeRun = null;
/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

const SUITES = {
  smoke: {
    label: 'Smoke',
    args: ['test', 'tests/smoke', '--project=chromium'],
  },
  a11y: {
    label: 'A11y',
    args: ['test', 'tests/a11y', '--project=chromium'],
  },
  api: {
    label: 'API / Network',
    args: ['test', 'tests/api', '--project=chromium'],
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

function runSuite(suiteKey) {
  const suite = SUITES[suiteKey];
  if (!suite) {
    return { ok: false, error: 'Unknown suite' };
  }
  if (activeRun) {
    return { ok: false, error: 'A test run is already in progress' };
  }

  const baseURL = readBaseUrl();
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npx, ['playwright', ...suite.args], {
    cwd: root,
    env: { ...process.env, BASE_URL: baseURL, FORCE_COLOR: '0' },
    shell: process.platform === 'win32',
  });

  activeRun = child;
  broadcast('run-start', { suite: suiteKey, label: suite.label, baseURL });

  const forward = (stream) => {
    child[stream].on('data', (chunk) => {
      broadcast('log', { stream, text: chunk.toString() });
    });
  };
  forward('stdout');
  forward('stderr');

  child.on('close', (code) => {
    activeRun = null;
    broadcast('run-end', {
      suite: suiteKey,
      label: suite.label,
      code: code ?? 1,
      ok: code === 0,
    });
  });

  child.on('error', (err) => {
    activeRun = null;
    broadcast('log', { stream: 'stderr', text: String(err) });
    broadcast('run-end', {
      suite: suiteKey,
      label: suite.label,
      code: 1,
      ok: false,
    });
  });

  return { ok: true, suite: suiteKey, label: suite.label, baseURL };
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
    return sendJson(res, 200, {
      baseURL: readBaseUrl(),
      suites: Object.entries(SUITES).map(([id, s]) => ({
        id,
        label: s.label,
      })),
      running: Boolean(activeRun),
    });
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
    broadcast('run-end', { suite: 'stopped', label: 'Stopped', code: 1, ok: false });
    return sendJson(res, 200, { ok: true, stopped: true });
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ baseURL: readBaseUrl() })}\n\n`);
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
  console.log(`QA Website console → http://localhost:${PORT}`);
});

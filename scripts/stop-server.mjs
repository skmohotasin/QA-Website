import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pidPath = path.join(root, '.qa-server.pid');
const PORT = Number(process.env.PORT) || 4173;

function readPid() {
  try {
    if (!fs.existsSync(pidPath)) return null;
    const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function killPid(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

function killPortListeners(port) {
  if (process.platform !== 'win32') {
    try {
      execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
    return;
  }

  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
      { encoding: 'utf8' },
    );
    for (const line of out.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (pid > 0) killPid(pid);
    }
  } catch {
    // ignore
  }
}

const pid = readPid();
let stopped = false;

if (pid) {
  stopped = killPid(pid) || stopped;
  console.log(stopped ? `Stopped QA server PID ${pid}` : `PID ${pid} was not running`);
}

killPortListeners(PORT);

try {
  if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
} catch {
  // ignore
}

console.log(`Port ${PORT} cleared. Safe to close VS Code or run npm start again.`);

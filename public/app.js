const urlInput = document.querySelector('#base-url');
const urlForm = document.querySelector('#url-form');
const urlStatus = document.querySelector('#url-status');
const suiteGrid = document.querySelector('#suite-grid');
const logEl = document.querySelector('#log');
const stopBtn = document.querySelector('#stop-run');
const clearBtn = document.querySelector('#clear-log');

const DESCRIPTIONS = {
  smoke: 'Page load & basic content',
  a11y: 'axe WCAG critical / serious',
  api: 'HTTP health of the base URL',
  all: 'Smoke + a11y + API (Chromium)',
  headed: 'Watch the browser while testing',
  browsers: 'Chromium, Firefox, WebKit, mobile',
};

let running = false;

function setStatus(message, kind = '') {
  urlStatus.textContent = message;
  urlStatus.className = `status-line${kind ? ` ${kind}` : ''}`;
}

function appendLog(text, className = '') {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(isRunning, activeId = null) {
  running = isRunning;
  stopBtn.disabled = !isRunning;
  for (const btn of suiteGrid.querySelectorAll('.btn-suite')) {
    btn.disabled = isRunning;
    btn.classList.toggle('is-running', isRunning && btn.dataset.suite === activeId);
  }
  document.querySelector('#save-url').disabled = isRunning;
  urlInput.disabled = isRunning;
}

function renderSuites(suites) {
  suiteGrid.innerHTML = '';
  for (const suite of suites) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-suite';
    btn.dataset.suite = suite.id;
    btn.innerHTML = `<strong>${suite.label}</strong><span>${DESCRIPTIONS[suite.id] || 'Playwright suite'}</span>`;
    btn.addEventListener('click', () => runSuite(suite.id));
    suiteGrid.appendChild(btn);
  }
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const data = await res.json();
  urlInput.value = data.baseURL || '';
  renderSuites(data.suites || []);
  setRunning(Boolean(data.running));
  setStatus(data.baseURL ? `Ready · ${data.baseURL}` : 'Add a website URL to begin');
}

async function saveUrl(event) {
  event.preventDefault();
  const url = urlInput.value.trim();
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) {
    setStatus(data.error || 'Could not save URL', 'err');
    return;
  }
  urlInput.value = data.baseURL;
  setStatus(`Saved · ${data.baseURL}`, 'ok');
  appendLog(`\n▸ URL saved: ${data.baseURL}\n`, 'meta');
}

async function runSuite(suite) {
  if (running) return;
  const url = urlInput.value.trim();
  setRunning(true, suite);
  appendLog(`\n▸ Starting ${suite}…\n`, 'meta');

  const res = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suite, url }),
  });
  const data = await res.json();
  if (!res.ok) {
    appendLog(`${data.error || 'Failed to start'}\n`, 'err');
    setRunning(false);
    setStatus(data.error || 'Failed to start', 'err');
  }
}

async function stopRun() {
  await fetch('/api/stop', { method: 'POST' });
}

function connectEvents() {
  const source = new EventSource('/api/events');

  source.addEventListener('log', (event) => {
    const data = JSON.parse(event.data);
    appendLog(data.text, data.stream === 'stderr' ? 'err' : '');
  });

  source.addEventListener('run-start', (event) => {
    const data = JSON.parse(event.data);
    setRunning(true, data.suite);
    setStatus(`Running ${data.label} on ${data.baseURL}`);
  });

  source.addEventListener('run-end', (event) => {
    const data = JSON.parse(event.data);
    setRunning(false);
    if (data.ok) {
      appendLog(`\n✓ ${data.label} finished successfully\n`, 'ok');
      setStatus(`${data.label} passed`, 'ok');
    } else {
      appendLog(`\n✗ ${data.label} finished with code ${data.code}\n`, 'err');
      setStatus(`${data.label} failed`, 'err');
    }
  });

  source.addEventListener('config', (event) => {
    const data = JSON.parse(event.data);
    urlInput.value = data.baseURL;
  });

  source.onerror = () => {
    // Browser will retry EventSource automatically.
  };
}

urlForm.addEventListener('submit', saveUrl);
stopBtn.addEventListener('click', stopRun);
clearBtn.addEventListener('click', () => {
  logEl.textContent = '';
});

await loadConfig();
connectEvents();

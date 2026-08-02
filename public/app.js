const urlInput = document.querySelector('#base-url');
const urlForm = document.querySelector('#url-form');
const urlStatus = document.querySelector('#url-status');
const suiteGrid = document.querySelector('#suite-grid');
const logEl = document.querySelector('#log');
const stopBtn = document.querySelector('#stop-run');
const clearBtn = document.querySelector('#clear-log');
const toolsPanel = document.querySelector('#tools-panel');
const toolsMessage = document.querySelector('#tools-message');
const toolsHeading = document.querySelector('#tools-heading');
const installBtn = document.querySelector('#install-tools');
const reportPanel = document.querySelector('#report-panel');
const reportSummary = document.querySelector('#report-summary');
const downloadReportBtn = document.querySelector('#download-report');
const downloadReportTopBtn = document.querySelector('#download-report-top');
const downloadMdBtn = document.querySelector('#download-md');
const downloadBugsBtn = document.querySelector('#download-bugs');
const openReportLink = document.querySelector('#open-report');

const DESCRIPTIONS = {
  smoke: 'Page load & basic content',
  functional: 'Forms, auth, nav, search, cart, filters',
  uiux: 'Responsive layout + accessibility',
  a11y: 'axe WCAG critical / serious',
  api: 'HTTP health of the base URL',
  regression: 'Full retest of all key suites',
  lighthouse: 'Performance, SEO, a11y, best practices',
  all: 'Everything on Chromium',
  headed: 'Watch the browser run',
  browsers: 'All engines + mobile',
};

let running = false;
let toolsReady = false;
let latestKind = 'client';

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
  installBtn.disabled = isRunning;
  for (const btn of suiteGrid.querySelectorAll('.btn-suite')) {
    btn.disabled = isRunning || !toolsReady;
    btn.classList.toggle('is-running', isRunning && btn.dataset.suite === activeId);
  }
  document.querySelector('#save-url').disabled = isRunning;
  urlInput.disabled = isRunning;
}

function downloadFile(url, filename) {
  const stamp = Date.now();
  const link = document.createElement('a');
  link.href = `${url}${url.includes('?') ? '&' : '?'}download=1&t=${stamp}`;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function setDownloadEnabled(report) {
  const ready = Boolean(report?.available);
  const kind = report?.latestKind || latestKind;
  const bugCount = report?.bugCount ?? 0;
  const isLighthouse = kind === 'lighthouse';

  latestKind = kind;

  if (downloadReportBtn) {
    downloadReportBtn.disabled = !ready;
    downloadReportBtn.textContent = isLighthouse
      ? 'Download Lighthouse reports'
      : 'Download report';
  }
  if (downloadReportTopBtn) {
    downloadReportTopBtn.disabled = !ready;
    downloadReportTopBtn.classList.toggle('is-ready', ready);
    downloadReportTopBtn.textContent = isLighthouse
      ? 'Download Lighthouse'
      : 'Download report';
  }
  if (downloadMdBtn) {
    downloadMdBtn.disabled = !ready || isLighthouse;
    downloadMdBtn.hidden = isLighthouse;
  }
  if (downloadBugsBtn) {
    const showBugs = ready && !isLighthouse;
    downloadBugsBtn.hidden = isLighthouse;
    downloadBugsBtn.disabled = !(showBugs && bugCount > 0);
    downloadBugsBtn.textContent =
      bugCount > 0 ? `Download bug tickets (${bugCount})` : 'Download bug tickets';
  }
}

function downloadLatestReport() {
  if (latestKind === 'lighthouse') {
    downloadFile('/reports/lighthouse-summary.html', 'lighthouse-summary.html');
    setTimeout(() => {
      downloadFile('/reports/lighthouse-full.html', 'lighthouse-full.html');
    }, 400);
    return;
  }
  downloadFile('/reports/client-report.html', 'website-qa-report.html');
}

async function refreshReport({ highlight = false, retries = 8 } = {}) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`/api/report?t=${Date.now()}`);
      const report = await res.json();
      if (report?.available) {
        updateReportUi(report, { highlight });
        return report;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  updateReportUi({ available: false });
  return null;
}

function updateReportUi(report, { highlight = false } = {}) {
  const ready = Boolean(report?.available);
  setDownloadEnabled(report || { available: false });

  if (!ready) {
    reportPanel.hidden = true;
    return;
  }

  reportPanel.hidden = false;
  const kind = report.latestKind || latestKind;
  const s = report.summary;
  const lh = report.lighthouse;
  const bugCount = report.bugCount ?? 0;

  if (kind === 'lighthouse' && lh) {
    const scores = Object.values(lh.categories || {})
      .map((c) => `${c.title} ${c.score ?? 'n/a'}`)
      .join(' · ');
    reportSummary.textContent = `Lighthouse · ${lh.website} · ${scores}`;
  } else if (s) {
    const bugText = bugCount ? ` · ${bugCount} bug ticket(s)` : '';
    reportSummary.textContent = `${s.overall} · ${s.website} · ${s.totals.passed}/${s.totals.total} checks passed${bugText} · ${new Date(s.endedAt).toLocaleString()}`;
  } else {
    reportSummary.textContent = 'Your report is ready. Use Download report / Open in browser.';
  }

  if (openReportLink) {
    if (kind === 'lighthouse') {
      openReportLink.href = `/reports/lighthouse-full.html?t=${Date.now()}`;
      openReportLink.textContent = 'Open in browser';
    } else {
      openReportLink.href = `/reports/client-report.html?t=${Date.now()}`;
      openReportLink.textContent = 'Open in browser';
    }
  }

  if (highlight) {
    reportPanel.classList.remove('is-new');
    void reportPanel.offsetWidth;
    reportPanel.classList.add('is-new');
    reportPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function updateToolsUi(tools) {
  toolsReady = Boolean(tools?.installed);
  if (!tools) return;

  if (toolsReady) {
    toolsPanel.hidden = false;
    toolsPanel.classList.add('is-ready');
    toolsHeading.textContent = 'Browsers ready';
    toolsMessage.textContent = `Installed in this repo: ${tools.browsersDir}`;
    installBtn.textContent = 'Reinstall browsers';
  } else {
    toolsPanel.hidden = false;
    toolsPanel.classList.remove('is-ready');
    toolsHeading.textContent = 'Browsers not installed';
    toolsMessage.textContent =
      tools.message ||
      'Playwright browsers must be installed into this repo before tests can run.';
    installBtn.textContent = 'Install browsers';
  }

  setRunning(running);
}

function renderSuites(suites) {
  suiteGrid.innerHTML = '';
  for (const suite of suites) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-suite';
    btn.dataset.suite = suite.id;
    btn.disabled = !toolsReady || running;
    btn.innerHTML = `<strong>${suite.label}</strong><span>${DESCRIPTIONS[suite.id] || 'Playwright suite'}</span>`;
    btn.addEventListener('click', () => runSuite(suite.id));
    suiteGrid.appendChild(btn);
  }
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const data = await res.json();
  urlInput.value = data.baseURL || '';
  updateToolsUi(data.tools);
  await refreshReport();
  renderSuites(data.suites || []);
  setRunning(Boolean(data.running));
  if (!data.tools?.installed) {
    setStatus('Install browsers into this repo before running tests', 'err');
  } else {
    setStatus(data.baseURL ? `Ready · ${data.baseURL}` : 'Add a website URL to begin');
  }
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
  if (!toolsReady) {
    setStatus('Install browsers first', 'err');
    return;
  }
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
    if (data.tools) updateToolsUi(data.tools);
    setRunning(false);
    setStatus(data.error || 'Failed to start', 'err');
  }
}

async function installTools() {
  if (running) return;
  setRunning(true, 'install');
  appendLog(`\n▸ Installing Playwright browsers into .playwright/ …\n`, 'meta');

  const res = await fetch('/api/install-tools', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    appendLog(`${data.error || 'Failed to start install'}\n`, 'err');
    setRunning(false);
    setStatus(data.error || 'Failed to start install', 'err');
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
    if (data.kind === 'install') {
      setStatus('Installing browsers into this repo…');
    } else {
      setStatus(`Running ${data.label} on ${data.baseURL}`);
    }
  });

  source.addEventListener('run-end', async (event) => {
    const data = JSON.parse(event.data);
    if (data.tools) updateToolsUi(data.tools);
    setRunning(false);

    if (data.kind === 'test' || data.kind === 'lighthouse') {
      const report = await refreshReport({ highlight: true });
      if (data.ok) {
        appendLog(`\n✓ ${data.label} finished successfully\n`, 'ok');
        setStatus(
          data.kind === 'lighthouse'
            ? 'Lighthouse report ready — download below'
            : report?.available
              ? `${data.label} passed — download report is ready`
              : `${data.label} passed`,
          'ok',
        );
        if (data.kind === 'lighthouse') {
          appendLog('▸ Lighthouse summary + full report saved\n', 'meta');
        } else if (report?.available) {
          appendLog('▸ Report ready — click Download report\n', 'meta');
        }
      } else {
        appendLog(`\n✗ ${data.label} finished with code ${data.code}\n`, 'err');
        setStatus(`${data.label} failed`, 'err');
        if (report?.available) {
          appendLog('▸ Report ready with failure details — click Download report\n', 'meta');
        }
      }
      return;
    }

    if (data.ok) {
      appendLog(`\n✓ ${data.label} finished successfully\n`, 'ok');
      setStatus(
        data.kind === 'install' ? 'Browsers installed — tests are ready' : `${data.label} passed`,
        'ok',
      );
    } else {
      appendLog(`\n✗ ${data.label} finished with code ${data.code}\n`, 'err');
      setStatus(`${data.label} failed`, 'err');
    }
  });

  source.addEventListener('tools', (event) => {
    updateToolsUi(JSON.parse(event.data));
  });

  source.addEventListener('config', (event) => {
    const data = JSON.parse(event.data);
    urlInput.value = data.baseURL;
  });

  source.addEventListener('hello', (event) => {
    const data = JSON.parse(event.data);
    if (data.tools) updateToolsUi(data.tools);
  });

  source.onerror = () => {
    // Browser will retry EventSource automatically.
  };
}

urlForm.addEventListener('submit', saveUrl);
stopBtn.addEventListener('click', stopRun);
installBtn.addEventListener('click', installTools);
clearBtn.addEventListener('click', () => {
  logEl.textContent = '';
});
downloadReportBtn.addEventListener('click', downloadLatestReport);
downloadReportTopBtn?.addEventListener('click', downloadLatestReport);
downloadMdBtn.addEventListener('click', () => {
  downloadFile('/reports/client-report.md', 'website-qa-report.md');
});
downloadBugsBtn?.addEventListener('click', () => {
  downloadFile('/reports/bug-reports.html', 'website-qa-bug-tickets.html');
});

await loadConfig();
connectEvents();

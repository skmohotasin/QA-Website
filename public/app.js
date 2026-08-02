const urlInput = document.querySelector('#base-url');
const urlForm = document.querySelector('#url-form');
const urlStatus = document.querySelector('#url-status');
const urlListBar = document.querySelector('#url-list-bar');
const urlListStatus = document.querySelector('#url-list-status');
const findUrlsBtn = document.querySelector('#find-urls');
const downloadUrlListBtn = document.querySelector('#download-url-list');
const openUrlListBtn = document.querySelector('#open-url-list');
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
const downloadReportTopBtn = document.querySelector('#download-report-top');
const reportHeading = document.querySelector('#report-heading');

const DESCRIPTIONS = {
  smoke: 'Page load & basic content',
  functional: 'Forms, auth, nav, search, cart, filters',
  uiux: 'Responsive layout + accessibility',
  a11y: 'axe WCAG critical / serious',
  api: 'HTTP health of the base URL',
  regression: 'Full retest of all key suites',
  lighthouse: 'Performance, SEO, a11y, best practices',
  'site-audit': 'Audit saved URL list one by one',
  all: 'Everything on Chromium',
  headed: 'Watch the browser run',
  browsers: 'All engines + mobile',
};

let running = false;
let toolsReady = false;
let latestKind = 'client';
let latestReport = null;
let siteUrls = null;

function actionEl(name) {
  return document.querySelector(`[data-report-action="${name}"]`);
}

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
  if (findUrlsBtn) findUrlsBtn.disabled = isRunning || !toolsReady;
  for (const btn of suiteGrid.querySelectorAll('.btn-suite')) {
    const needsUrlList = btn.dataset.suite === 'site-audit';
    btn.disabled =
      isRunning || !toolsReady || (needsUrlList && !siteUrls?.available);
    btn.classList.toggle('is-running', isRunning && btn.dataset.suite === activeId);
  }
  document.querySelector('#save-url').disabled = isRunning;
  urlInput.disabled = isRunning;
}

function updateSiteUrlsUi(next) {
  siteUrls = next || null;
  if (!urlListBar || !urlListStatus) return;

  if (siteUrls?.available) {
    urlListBar.hidden = false;
    const when = siteUrls.discoveredAt
      ? ` · ${new Date(siteUrls.discoveredAt).toLocaleString()}`
      : '';
    urlListStatus.innerHTML = `URL list ready: <strong>${siteUrls.count}</strong> page(s)${when}`;
    if (openUrlListBtn) openUrlListBtn.href = `/data/site-urls.json?t=${Date.now()}`;
    if (downloadUrlListBtn) downloadUrlListBtn.disabled = false;
  } else {
    urlListBar.hidden = false;
    urlListStatus.textContent =
      'No URL list yet. Click Find all URLs after saving the site.';
    if (downloadUrlListBtn) downloadUrlListBtn.disabled = true;
  }

  setRunning(running);
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

function reportTargets(kind) {
  if (kind === 'lighthouse') {
    return {
      summaryHtml: '/reports/lighthouse-summary.html',
      summaryName: 'lighthouse-summary.html',
      summaryMd: '/reports/lighthouse-summary.md',
      summaryMdName: 'lighthouse-summary.md',
      fullHtml: '/reports/lighthouse-full.html',
      fullName: 'lighthouse-full.html',
      fullMd: '/reports/lighthouse-full.md',
      fullMdName: 'lighthouse-full.md',
      bugsHtml: null,
      bugsMd: null,
    };
  }

  if (kind === 'site-audit') {
    return {
      summaryHtml: '/reports/site-audit-summary.html',
      summaryName: 'site-audit-summary.html',
      summaryMd: '/reports/site-audit-summary.md',
      summaryMdName: 'site-audit-summary.md',
      fullHtml: '/reports/site-audit-full.html',
      fullName: 'site-audit-full.html',
      fullMd: '/reports/site-audit-full.md',
      fullMdName: 'site-audit-full.md',
      bugsHtml: '/reports/site-audit-full.html',
      bugsMd: '/reports/site-audit-full.md',
    };
  }

  return {
    summaryHtml: '/reports/client-report.html',
    summaryName: 'website-qa-summary.html',
    summaryMd: '/reports/client-report.md',
    summaryMdName: 'website-qa-summary.md',
    fullHtml: '/reports/bug-reports.html',
    fullName: 'website-qa-full-bugs.html',
    fullMd: '/reports/bug-reports.md',
    fullMdName: 'website-qa-full-bugs.md',
    bugsHtml: '/reports/bug-reports.html',
    bugsMd: '/reports/bug-reports.md',
  };
}

function setActionEnabled(el, enabled) {
  if (!el) return;
  if (el.tagName === 'A') {
    el.classList.toggle('is-disabled', !enabled);
    el.style.pointerEvents = enabled ? '' : 'none';
    el.style.opacity = enabled ? '' : '0.45';
    if (!enabled) el.removeAttribute('href');
  } else {
    el.disabled = !enabled;
  }
}

function wireReportActions(report) {
  const ready = Boolean(report?.available);
  const kind = report?.latestKind || latestKind;
  const bugCount = report?.bugCount ?? 0;
  const targets = reportTargets(kind);
  const stamp = Date.now();

  latestKind = kind;
  latestReport = report;

  const hasBugs =
    (kind === 'site-audit' && bugCount > 0) ||
    (kind !== 'lighthouse' && kind !== 'site-audit' && bugCount > 0);
  const hasSummaryMd = Boolean(targets.summaryMd);
  const hasFullMd =
    Boolean(targets.fullMd) &&
    (kind === 'lighthouse' || kind === 'site-audit' || hasBugs);
  const hasFullHtml =
    kind === 'lighthouse' || kind === 'site-audit'
      ? true
      : hasBugs || Boolean(targets.summaryHtml);

  if (downloadReportTopBtn) {
    downloadReportTopBtn.disabled = !ready;
    downloadReportTopBtn.classList.toggle('is-ready', ready);
  }

  if (reportHeading) {
    reportHeading.textContent =
      kind === 'lighthouse'
        ? 'Lighthouse report ready'
        : kind === 'site-audit'
          ? 'Full site audit ready'
          : 'Client report ready';
  }

  // Summary set
  setActionEnabled(actionEl('summary-download'), ready);
  setActionEnabled(actionEl('summary-open'), ready);
  setActionEnabled(actionEl('summary-md'), ready && hasSummaryMd);
  setActionEnabled(actionEl('summary-bugs'), ready && hasBugs);
  if (actionEl('summary-bugs')) {
    actionEl('summary-bugs').textContent = hasBugs
      ? `Download bug tickets (${bugCount})`
      : 'Download bug tickets';
  }
  if (actionEl('summary-open') && ready) {
    actionEl('summary-open').href = `${targets.summaryHtml}?t=${stamp}`;
  }

  // Full set
  setActionEnabled(actionEl('full-download'), ready && hasFullHtml);
  setActionEnabled(actionEl('full-open'), ready && hasFullHtml);
  setActionEnabled(actionEl('full-md'), ready && hasFullMd);
  setActionEnabled(actionEl('full-bugs'), ready && hasBugs);
  if (actionEl('full-bugs')) {
    actionEl('full-bugs').textContent = hasBugs
      ? `Download bug tickets (${bugCount})`
      : 'Download bug tickets';
  }
  if (actionEl('full-open') && ready && hasFullHtml) {
    const fullUrl =
      kind === 'lighthouse' || kind === 'site-audit' || hasBugs
        ? targets.fullHtml
        : targets.summaryHtml;
    actionEl('full-open').href = `${fullUrl}?t=${stamp}`;
  }
}

function downloadLatestReport() {
  const targets = reportTargets(latestKind);
  if (latestKind === 'lighthouse' || latestKind === 'site-audit') {
    downloadFile(targets.summaryHtml, targets.summaryName);
    setTimeout(() => downloadFile(targets.fullHtml, targets.fullName), 400);
    return;
  }
  downloadFile(targets.summaryHtml, targets.summaryName);
  if ((latestReport?.bugCount ?? 0) > 0) {
    setTimeout(() => downloadFile(targets.fullHtml, targets.fullName), 400);
  }
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
  wireReportActions(report || { available: false });

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
  } else if (kind === 'site-audit' && report.siteAudit) {
    const a = report.siteAudit;
    reportSummary.textContent = `${a.overall} · ${a.website} · ${a.totals.pages} pages · ${a.totals.passed} passed · ${a.totals.issues} issue(s) · ${a.date}`;
  } else if (s) {
    const bugText = bugCount ? ` · ${bugCount} bug ticket(s)` : '';
    reportSummary.textContent = `${s.overall} · ${s.website} · ${s.totals.passed}/${s.totals.total} checks passed${bugText} · ${new Date(s.endedAt).toLocaleString()}`;
  } else {
    reportSummary.textContent = 'Report ready. Use Summary or Full actions below.';
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
  updateSiteUrlsUi(data.siteUrls);
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
    return null;
  }
  urlInput.value = data.baseURL;
  setStatus(`Saved · ${data.baseURL}`, 'ok');
  appendLog(`\n▸ URL saved: ${data.baseURL}\n`, 'meta');
  return data.baseURL;
}

async function findAllUrls() {
  if (running) return;
  if (!toolsReady) {
    setStatus('Install browsers first', 'err');
    return;
  }

  const saved = await saveUrl({ preventDefault() {} });
  if (!saved) return;

  await runSuite('discover-urls');
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
    } else if (data.kind === 'discover-urls') {
      setStatus(`Finding all URLs on ${data.baseURL}`);
    } else {
      setStatus(`Running ${data.label} on ${data.baseURL}`);
    }
  });

  source.addEventListener('run-end', async (event) => {
    const data = JSON.parse(event.data);
    if (data.tools) updateToolsUi(data.tools);
    if (data.siteUrls) updateSiteUrlsUi(data.siteUrls);
    setRunning(false);

    if (data.kind === 'discover-urls') {
      let urls = data.siteUrls || null;
      try {
        const res = await fetch(`/api/site-urls?t=${Date.now()}`);
        urls = await res.json();
      } catch {
        // keep previous
      }
      updateSiteUrlsUi(urls);
      if (data.ok) {
        appendLog(`\n✓ ${data.label} finished — URL list saved to data/site-urls.json\n`, 'ok');
        setStatus(
          urls?.available
            ? `Found ${urls.count} URL(s) — ready for Audit entire site`
            : 'URL list saved — ready for Audit entire site',
          'ok',
        );
      } else {
        appendLog(`\n✗ ${data.label} finished with code ${data.code}\n`, 'err');
        setStatus(`${data.label} failed`, 'err');
      }
      return;
    }

    if (data.kind === 'test' || data.kind === 'lighthouse' || data.kind === 'site-audit') {
      const report = await refreshReport({ highlight: true });
      if (data.ok) {
        appendLog(`\n✓ ${data.label} finished successfully\n`, 'ok');
        setStatus(
          data.kind === 'lighthouse'
            ? 'Lighthouse report ready — download below'
            : data.kind === 'site-audit'
              ? 'Full site audit ready — download below'
              : report?.available
                ? `${data.label} passed — download report is ready`
                : `${data.label} passed`,
          'ok',
        );
        if (data.kind === 'lighthouse') {
          appendLog('▸ Lighthouse summary + full report saved\n', 'meta');
        } else if (data.kind === 'site-audit') {
          appendLog('▸ Per-URL reports + site audit summary saved\n', 'meta');
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
findUrlsBtn?.addEventListener('click', findAllUrls);
downloadUrlListBtn?.addEventListener('click', () => {
  if (!siteUrls?.available) return;
  downloadFile('/data/site-urls.json', 'site-urls.json');
});
stopBtn.addEventListener('click', stopRun);
installBtn.addEventListener('click', installTools);
clearBtn.addEventListener('click', () => {
  logEl.textContent = '';
});
downloadReportTopBtn?.addEventListener('click', downloadLatestReport);

reportPanel?.addEventListener('click', (event) => {
  const el = event.target.closest('[data-report-action]');
  if (!el || el.disabled || el.classList.contains('is-disabled')) return;

  const action = el.dataset.reportAction;
  const targets = reportTargets(latestKind);
  const bugCount = latestReport?.bugCount ?? 0;

  if (action === 'summary-download') {
    downloadFile(targets.summaryHtml, targets.summaryName);
  } else if (action === 'summary-md' && targets.summaryMd) {
    downloadFile(targets.summaryMd, targets.summaryMdName || 'website-qa-summary.md');
  } else if (action === 'summary-bugs' && targets.bugsHtml && bugCount > 0) {
    downloadFile(
      targets.bugsHtml,
      latestKind === 'site-audit' ? 'site-audit-full.html' : 'website-qa-bug-tickets.html',
    );
  } else if (action === 'full-download') {
    if (latestKind === 'lighthouse' || latestKind === 'site-audit') {
      downloadFile(targets.fullHtml, targets.fullName);
    } else if (bugCount > 0) {
      downloadFile(targets.fullHtml, targets.fullName);
    } else {
      downloadFile(targets.summaryHtml, targets.summaryName);
    }
  } else if (action === 'full-md' && targets.fullMd) {
    if (latestKind === 'lighthouse' || latestKind === 'site-audit' || bugCount > 0) {
      downloadFile(targets.fullMd, targets.fullMdName || 'website-qa-full.md');
    }
  } else if (action === 'full-bugs' && targets.bugsHtml && bugCount > 0) {
    downloadFile(
      targets.bugsHtml,
      latestKind === 'site-audit' ? 'site-audit-full.html' : 'website-qa-bug-tickets.html',
    );
  }
});

await loadConfig();
connectEvents();

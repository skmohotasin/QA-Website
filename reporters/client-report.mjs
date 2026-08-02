import fs from 'node:fs';
import path from 'node:path';

const REPORT_DIR = path.resolve('reports');
const HTML_FILE = path.join(REPORT_DIR, 'client-report.html');
const MD_FILE = path.join(REPORT_DIR, 'client-report.md');
const JSON_FILE = path.join(REPORT_DIR, 'client-report.json');
const BUGS_MD = path.join(REPORT_DIR, 'bug-reports.md');
const BUGS_HTML = path.join(REPORT_DIR, 'bug-reports.html');

const PLAIN = {
  'loads and returns a successful response': {
    title: 'Homepage opens correctly',
    meaning: 'Visitors can reach the site and the server responds successfully.',
  },
  'has a visible main landmark or body content': {
    title: 'Homepage content is visible',
    meaning: 'The main page content appears on screen and is not blank.',
  },
  'homepage has no critical axe violations': {
    title: 'Accessibility check',
    meaning: 'No serious accessibility problems were found on the homepage.',
  },
  'base URL responds with HTTP 2xx': {
    title: 'Website is reachable',
    meaning: 'The website server answered with a healthy response.',
  },
  'primary navigation links open without server errors': {
    title: 'Navigation links work',
    meaning: 'Main menu links open pages without server errors.',
  },
  'forms are present and usable when the site has forms': {
    title: 'Forms are usable',
    meaning: 'Visible forms include fields and a way to submit.',
  },
  'search field accepts input when search exists': {
    title: 'Search accepts input',
    meaning: 'The search box can receive typed queries.',
  },
  'login / account entry point is available when offered': {
    title: 'Login / account entry works',
    meaning: 'Sign-in or account entry opens a usable auth screen.',
  },
  'cart or add-to-cart controls exist on commerce sites': {
    title: 'Cart / checkout controls present',
    meaning: 'Commerce controls such as cart or add-to-cart are available.',
  },
  'filter controls are interactive when present': {
    title: 'Filters are interactive',
    meaning: 'Filter controls are visible and enabled when the site offers them.',
  },
  'layout is usable on mobile': {
    title: 'Mobile layout is usable',
    meaning: 'On a phone-sized screen, content is visible without horizontal scrolling.',
  },
  'layout is usable on tablet': {
    title: 'Tablet layout is usable',
    meaning: 'On a tablet-sized screen, content is visible without horizontal scrolling.',
  },
  'layout is usable on desktop': {
    title: 'Desktop layout is usable',
    meaning: 'On a desktop screen, content is visible without horizontal scrolling.',
  },
  'clickable controls are large enough to tap on mobile': {
    title: 'Tap targets are large enough',
    meaning: 'Buttons and links are big enough for touch use on mobile.',
  },
  'images that convey meaning expose alternative text': {
    title: 'Images have alternative text',
    meaning: 'Images include alt text for accessibility and clarity.',
  },
  'text content does not overflow its viewport width': {
    title: 'No content overflow on mobile',
    meaning: 'Page elements do not stick out wider than the screen.',
  },
};

function plainLanguage(testTitle) {
  const key = Object.keys(PLAIN).find((k) => testTitle.includes(k));
  if (key) return PLAIN[key];
  return {
    title: testTitle,
    meaning: 'Automated quality check for this page or feature.',
  };
}

function annotationMap(test) {
  const map = {};
  for (const item of test.annotations || []) {
    map[item.type] = item.description;
  }
  return map;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function statusLabel(status) {
  if (status === 'passed') return { word: 'Passed', tone: 'pass' };
  if (status === 'failed') return { word: 'Failed', tone: 'fail' };
  if (status === 'timedOut') return { word: 'Timed out', tone: 'fail' };
  if (status === 'skipped') return { word: 'Skipped', tone: 'skip' };
  return { word: status, tone: 'skip' };
}

/**
 * Playwright reporter that writes client summary + bug tickets.
 */
export default class ClientReportReporter {
  constructor() {
    this.baseURL = process.env.BASE_URL || 'Not set';
    this.startedAt = new Date();
    this.results = [];
    this.bugs = [];
  }

  onBegin() {
    this.startedAt = new Date();
    this.results = [];
    this.bugs = [];
  }

  onTestEnd(test, result) {
    const title = test.title;
    const plain = plainLanguage(title);
    const project = test.parent?.project()?.name || 'default';
    const notes = annotationMap(test);
    const error = result.errors?.[0];
    const shortError = error
      ? String(error.message || error)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)[0]
      : null;

    const entry = {
      suite: test.parent?.title || 'Checks',
      title: plain.title,
      meaning: plain.meaning,
      technicalTitle: title,
      project,
      status: result.status,
      durationMs: result.duration,
      shortError,
      severity: notes.severity || 'Medium',
      steps: notes.steps || `1. Open ${this.baseURL}\n2. Run check: ${plain.title}`,
      expected: notes.expected || plain.meaning,
    };

    this.results.push(entry);

    if (['failed', 'timedOut', 'interrupted'].includes(result.status)) {
      this.bugs.push({
        id: `BUG-${String(this.bugs.length + 1).padStart(3, '0')}`,
        title: plain.title,
        severity: entry.severity,
        website: this.baseURL,
        browser: project,
        steps: entry.steps,
        expected: entry.expected,
        actual: shortError || 'Check failed during automated run.',
        suite: entry.suite,
        date: new Date().toISOString(),
      });
    }
  }

  onEnd(result) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });

    const endedAt = new Date();
    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) =>
      ['failed', 'timedOut', 'interrupted'].includes(r.status),
    ).length;
    const skipped = this.results.filter((r) => r.status === 'skipped').length;
    const total = this.results.length;
    const overall =
      result.status === 'passed' && failed === 0 ? 'Passed' : 'Needs attention';
    const overallTone = overall === 'Passed' ? 'pass' : 'fail';

    const summary = {
      website: this.baseURL,
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      overall,
      totals: { total, passed, failed, skipped, bugs: this.bugs.length },
      results: this.results,
      bugs: this.bugs,
    };

    fs.writeFileSync(JSON_FILE, JSON.stringify(summary, null, 2), 'utf8');
    fs.writeFileSync(MD_FILE, renderMarkdown(summary), 'utf8');
    fs.writeFileSync(HTML_FILE, renderHtml(summary, overallTone), 'utf8');
    fs.writeFileSync(BUGS_MD, renderBugsMarkdown(summary), 'utf8');
    fs.writeFileSync(BUGS_HTML, renderBugsHtml(summary), 'utf8');
  }
}

function renderBugsMarkdown(summary) {
  if (!summary.bugs.length) {
    return [
      '# Bug Reports',
      '',
      `**Website:** ${summary.website}`,
      `**Date:** ${new Date(summary.endedAt).toLocaleString()}`,
      '',
      'No bugs were found in this run.',
      '',
    ].join('\n');
  }

  const lines = [
    '# Bug Reports',
    '',
    `**Website:** ${summary.website}`,
    `**Date:** ${new Date(summary.endedAt).toLocaleString()}`,
    `**Bugs found:** ${summary.bugs.length}`,
    '',
  ];

  for (const bug of summary.bugs) {
    lines.push(`## ${bug.id}: ${bug.title}`);
    lines.push('');
    lines.push(`- **Severity:** ${bug.severity}`);
    lines.push(`- **Browser / device:** ${bug.browser}`);
    lines.push(`- **Suite:** ${bug.suite}`);
    lines.push('');
    lines.push('### Steps to reproduce');
    lines.push('');
    lines.push(bug.steps);
    lines.push('');
    lines.push('### Expected result');
    lines.push('');
    lines.push(bug.expected);
    lines.push('');
    lines.push('### Actual result');
    lines.push('');
    lines.push(bug.actual);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function renderBugsHtml(summary) {
  const body = summary.bugs.length
    ? summary.bugs
        .map(
          (bug) => `
      <article class="bug">
        <h2>${escapeHtml(bug.id)}: ${escapeHtml(bug.title)}</h2>
        <p><strong>Severity:</strong> ${escapeHtml(bug.severity)} ·
           <strong>Browser:</strong> ${escapeHtml(bug.browser)}</p>
        <h3>Steps to reproduce</h3>
        <pre>${escapeHtml(bug.steps)}</pre>
        <h3>Expected result</h3>
        <p>${escapeHtml(bug.expected)}</p>
        <h3>Actual result</h3>
        <p class="actual">${escapeHtml(bug.actual)}</p>
      </article>`,
        )
        .join('')
    : '<p>No bugs were found in this run.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bug Reports</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, sans-serif; margin: 0; background: #eef2f4; color: #12202b; }
    main { max-width: 860px; margin: 2rem auto; background: #fffdf8; padding: 2rem; border-radius: 16px; border: 1px solid #d7dde3; }
    h1 { margin-top: 0; }
    .bug { border-top: 1px solid #d7dde3; padding-top: 1rem; margin-top: 1rem; }
    pre { white-space: pre-wrap; background: #f5f7f8; padding: 0.8rem; border-radius: 8px; }
    .actual { color: #b42318; }
    @media print { body { background: #fff; } main { box-shadow: none; border: none; } }
  </style>
</head>
<body>
  <main>
    <h1>Bug Reports</h1>
    <p>${escapeHtml(summary.website)} · ${escapeHtml(new Date(summary.endedAt).toLocaleString())} · ${summary.bugs.length} bug(s)</p>
    ${body}
  </main>
</body>
</html>`;
}

function renderMarkdown(summary) {
  const lines = [
    '# Website QA Report',
    '',
    `**Website:** ${summary.website}`,
    `**Date:** ${new Date(summary.endedAt).toLocaleString()}`,
    `**Overall result:** ${summary.overall}`,
    '',
    '## Summary',
    '',
    `| Total checks | Passed | Failed | Skipped | Bugs |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${summary.totals.total} | ${summary.totals.passed} | ${summary.totals.failed} | ${summary.totals.skipped} | ${summary.totals.bugs} |`,
    '',
    '## What we checked',
    '',
  ];

  for (const item of summary.results) {
    const status = statusLabel(item.status).word;
    lines.push(`### ${item.title}`);
    lines.push('');
    lines.push(`- **Result:** ${status}`);
    lines.push(`- **What this means:** ${item.meaning}`);
    lines.push(`- **Browser / device:** ${item.project}`);
    lines.push(`- **Time taken:** ${formatDuration(item.durationMs)}`);
    if (item.shortError) {
      lines.push(`- **Issue found:** ${item.shortError}`);
    }
    lines.push('');
  }

  if (summary.bugs.length) {
    lines.push('## Bug tickets');
    lines.push('');
    lines.push('See `bug-reports.md` / `bug-reports.html` for full tickets (steps, expected, actual, severity).');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('_Generated by QA Website automation._');
  lines.push('');
  return lines.join('\n');
}

function renderHtml(summary, overallTone) {
  const rows = summary.results
    .map((item) => {
      const status = statusLabel(item.status);
      const issue = item.shortError
        ? item.shortError.length > 180
          ? `${item.shortError.slice(0, 180)}…`
          : item.shortError
        : '';
      return `
        <tr>
          <td>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="meaning">${escapeHtml(item.meaning)}</div>
            ${
              issue
                ? `<div class="issue">Issue: ${escapeHtml(issue)}</div>`
                : ''
            }
          </td>
          <td><span class="badge ${status.tone}">${status.word}</span></td>
          <td>${escapeHtml(item.project)}</td>
          <td>${formatDuration(item.durationMs)}</td>
        </tr>`;
    })
    .join('');

  const bugsNote = summary.bugs.length
    ? `<p class="footer"><strong>${summary.bugs.length} bug ticket(s)</strong> were generated. Open <code>bug-reports.html</code> for steps / expected / actual / severity.</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Website QA Report</title>
  <style>
    :root {
      --ink: #12202b;
      --muted: #5a6b78;
      --line: #d7dde3;
      --pass: #16794c;
      --fail: #b42318;
      --skip: #6b7280;
      --pass-bg: #e8f7ef;
      --fail-bg: #fdecec;
      --skip-bg: #f3f4f6;
      --paper: #fffdf8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      color: var(--ink);
      background: #eef2f4;
      line-height: 1.5;
    }
    .page {
      max-width: 920px;
      margin: 2rem auto;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 2rem;
      box-shadow: 0 18px 40px rgba(18, 32, 43, 0.08);
      overflow: hidden;
    }
    h1 { margin: 0 0 0.35rem; font-size: 1.9rem; }
    .sub { color: var(--muted); margin: 0 0 1.5rem; }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      align-items: center;
      padding: 1rem 1.1rem;
      border-radius: 12px;
      border: 1px solid var(--line);
      margin-bottom: 1.25rem;
    }
    .hero.pass { background: var(--pass-bg); }
    .hero.fail { background: var(--fail-bg); }
    .hero strong { font-size: 1.25rem; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
    .meta div {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 0.8rem 0.9rem;
      background: #fff;
    }
    .meta span { display: block; color: var(--muted); font-size: 0.85rem; }
    .meta b { font-size: 1.15rem; }
    .table-wrap {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      text-align: left;
      padding: 0.85rem 0.6rem;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    th { color: var(--muted); font-size: 0.85rem; font-weight: 600; }
    th:nth-child(1), td:nth-child(1) { width: 52%; }
    th:nth-child(2), td:nth-child(2) { width: 16%; }
    th:nth-child(3), td:nth-child(3) { width: 18%; }
    th:nth-child(4), td:nth-child(4) { width: 14%; }
    .meaning { color: var(--muted); font-size: 0.92rem; margin-top: 0.2rem; }
    .issue {
      color: var(--fail);
      font-size: 0.9rem;
      margin-top: 0.35rem;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .badge {
      display: inline-block;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge.pass { background: var(--pass-bg); color: var(--pass); }
    .badge.fail { background: var(--fail-bg); color: var(--fail); }
    .badge.skip { background: var(--skip-bg); color: var(--skip); }
    .footer { margin-top: 1.5rem; color: var(--muted); font-size: 0.9rem; }
    @media print {
      body { background: #fff; }
      .page { box-shadow: none; border: none; margin: 0; max-width: none; overflow: visible; }
    }
  </style>
</head>
<body>
  <main class="page">
    <h1>Website QA Report</h1>
    <p class="sub">A plain-language summary of automated checks for your website.</p>

    <div class="hero ${overallTone}">
      <div>
        <div>Overall result</div>
        <strong>${escapeHtml(summary.overall)}</strong>
      </div>
      <div>${escapeHtml(summary.website)}</div>
    </div>

    <div class="meta">
      <div><span>Date</span><b>${escapeHtml(new Date(summary.endedAt).toLocaleString())}</b></div>
      <div><span>Total checks</span><b>${summary.totals.total}</b></div>
      <div><span>Passed</span><b>${summary.totals.passed}</b></div>
      <div><span>Failed</span><b>${summary.totals.failed}</b></div>
      <div><span>Bugs</span><b>${summary.totals.bugs}</b></div>
    </div>

    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Check</th>
          <th>Result</th>
          <th>Browser</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    </div>

    ${bugsNote}
    <p class="footer">Generated by QA Website automation. Print or save as PDF with Ctrl+P.</p>
  </main>
</body>
</html>`;
}

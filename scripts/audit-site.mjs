import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { applyBrowsersPath, browsersDir } from '../lib/browsers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(root, 'reports');
const MAX_PAGES = Number(process.env.SITE_AUDIT_MAX_PAGES) || 30;
const MAX_DEPTH = Number(process.env.SITE_AUDIT_MAX_DEPTH) || 3;

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

function normalizeUrl(href, base) {
  try {
    const url = new URL(href, base);
    url.hash = '';
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url;
  } catch {
    return null;
  }
}

function isCrawlable(url, origin) {
  if (!url || url.origin !== origin) return false;
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const pathName = url.pathname.toLowerCase();
  if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|exe|dmg|mp4|mp3|css|js|woff2?|ico)$/i.test(pathName)) {
    return false;
  }
  if (pathName.includes('/wp-admin') || pathName.includes('/cdn-cgi/')) return false;
  return true;
}

async function collectLinks(page, baseUrl) {
  return page.$$eval('a[href]', (anchors) =>
    anchors.map((a) => a.getAttribute('href') || '').filter(Boolean),
  );
}

async function auditPage(page, url) {
  const started = Date.now();
  const result = {
    url,
    status: 0,
    title: '',
    ok: false,
    loadMs: 0,
    a11yIssues: [],
    overflowMobile: false,
    error: null,
  };

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    result.status = response?.status() ?? 0;
    result.title = (await page.title().catch(() => '')) || '(no title)';
    result.loadMs = Date.now() - started;
    result.ok = result.status >= 200 && result.status < 400;

    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    result.a11yIssues = axe.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes?.length || 0,
      }));

    await page.setViewportSize({ width: 375, height: 812 });
    result.overflowMobile = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 1;
    });
    await page.setViewportSize({ width: 1280, height: 800 });
  } catch (err) {
    result.error = String(err?.message || err);
    result.loadMs = Date.now() - started;
  }

  return result;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildSummary(pages, website) {
  const passed = pages.filter((p) => p.ok && !p.a11yIssues.length && !p.overflowMobile && !p.error);
  const failed = pages.filter((p) => !p.ok || p.error);
  const a11yPages = pages.filter((p) => p.a11yIssues.length);
  const overflowPages = pages.filter((p) => p.overflowMobile);
  const issues = [];

  for (const page of pages) {
    if (page.error) {
      issues.push({
        severity: 'Critical',
        page: page.url,
        title: 'Page failed to load',
        detail: page.error,
      });
    } else if (!page.ok) {
      issues.push({
        severity: 'High',
        page: page.url,
        title: `HTTP ${page.status}`,
        detail: `Page responded with status ${page.status}.`,
      });
    }
    for (const issue of page.a11yIssues) {
      issues.push({
        severity: issue.impact === 'critical' ? 'Critical' : 'High',
        page: page.url,
        title: issue.help,
        detail: `${issue.id} (${issue.nodes} element(s))`,
      });
    }
    if (page.overflowMobile) {
      issues.push({
        severity: 'Medium',
        page: page.url,
        title: 'Horizontal overflow on mobile',
        detail: 'Content is wider than a phone-sized screen.',
      });
    }
  }

  return {
    website,
    date: new Date().toLocaleString(),
    fetchedAt: new Date().toISOString(),
    totals: {
      pages: pages.length,
      passed: passed.length,
      failed: failed.length,
      a11yPages: a11yPages.length,
      overflowPages: overflowPages.length,
      issues: issues.length,
    },
    overall: issues.length === 0 ? 'Passed' : 'Needs attention',
    pages,
    issues,
  };
}

function renderSummaryHtml(summary) {
  const rows = summary.pages
    .map((p) => {
      const status =
        p.error || !p.ok
          ? 'Failed'
          : p.a11yIssues.length || p.overflowMobile
            ? 'Issues'
            : 'Passed';
      const tone =
        status === 'Passed' ? 'pass' : status === 'Issues' ? 'warn' : 'fail';
      return `<tr>
        <td><a href="${escapeHtml(p.url)}">${escapeHtml(p.url)}</a><div class="muted">${escapeHtml(p.title)}</div></td>
        <td><span class="badge ${tone}">${status}</span></td>
        <td>${p.status || '-'}</td>
        <td>${p.a11yIssues.length}</td>
        <td>${p.overflowMobile ? 'Yes' : 'No'}</td>
        <td>${p.loadMs} ms</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Full Site Audit Summary</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #eef2f4; color: #12202b; }
    main { max-width: 980px; margin: 2rem auto; background: #fffdf8; border: 1px solid #d7dde3; border-radius: 16px; padding: 2rem; overflow: hidden; }
    h1 { margin: 0 0 0.35rem; }
    .sub { color: #5a6b78; margin: 0 0 1rem; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
    .meta div { border: 1px solid #d7dde3; border-radius: 10px; padding: 0.75rem; background: #fff; }
    .meta span { display: block; color: #5a6b78; font-size: 0.85rem; }
    .table-wrap { width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { text-align: left; padding: 0.75rem 0.5rem; border-bottom: 1px solid #d7dde3; vertical-align: top; overflow-wrap: anywhere; }
    .muted { color: #5a6b78; font-size: 0.85rem; margin-top: 0.2rem; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 700; font-size: 0.85rem; }
    .pass { background: #e8f7ef; color: #16794c; }
    .warn { background: #fff7ed; color: #b45309; }
    .fail { background: #fdecec; color: #b42318; }
  </style>
</head>
<body>
  <main>
    <h1>Full Site Audit</h1>
    <p class="sub">${escapeHtml(summary.website)} · ${escapeHtml(summary.date)} · Overall: <strong>${escapeHtml(summary.overall)}</strong></p>
    <div class="meta">
      <div><span>Pages</span><b>${summary.totals.pages}</b></div>
      <div><span>Passed</span><b>${summary.totals.passed}</b></div>
      <div><span>Failed</span><b>${summary.totals.failed}</b></div>
      <div><span>A11y pages</span><b>${summary.totals.a11yPages}</b></div>
      <div><span>Issues</span><b>${summary.totals.issues}</b></div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Page</th><th>Result</th><th>HTTP</th><th>A11y</th><th>Overflow</th><th>Load</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted">See site-audit-full.html / .md for issue details developers can fix.</p>
  </main>
</body>
</html>`;
}

function renderFullHtml(summary) {
  const issueBlocks = summary.issues.length
    ? summary.issues
        .map(
          (issue, index) => `
      <article class="issue">
        <h2>ISSUE-${String(index + 1).padStart(3, '0')}: ${escapeHtml(issue.title)}</h2>
        <p><strong>Severity:</strong> ${escapeHtml(issue.severity)} · <strong>Page:</strong> <a href="${escapeHtml(issue.page)}">${escapeHtml(issue.page)}</a></p>
        <h3>Steps to reproduce</h3>
        <pre>1. Open ${escapeHtml(issue.page)}
2. Observe the reported problem.</pre>
        <h3>Expected</h3>
        <p>Page loads cleanly with no serious accessibility or layout problems.</p>
        <h3>Actual</h3>
        <p class="actual">${escapeHtml(issue.detail)}</p>
      </article>`,
        )
        .join('')
    : '<p>No issues found across crawled pages.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Full Site Audit Details</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #eef2f4; color: #12202b; }
    main { max-width: 900px; margin: 2rem auto; background: #fffdf8; border: 1px solid #d7dde3; border-radius: 16px; padding: 2rem; }
    .issue { border-top: 1px solid #d7dde3; padding-top: 1rem; margin-top: 1rem; }
    pre { white-space: pre-wrap; background: #f5f7f8; padding: 0.8rem; border-radius: 8px; }
    .actual { color: #b42318; }
  </style>
</head>
<body>
  <main>
    <h1>Full Site Audit — Details</h1>
    <p>${escapeHtml(summary.website)} · ${escapeHtml(summary.date)} · ${summary.issues.length} issue(s)</p>
    ${issueBlocks}
  </main>
</body>
</html>`;
}

function renderSummaryMarkdown(summary) {
  const lines = [
    '# Full Site Audit Summary',
    '',
    `**Website:** ${summary.website}`,
    `**Date:** ${summary.date}`,
    `**Overall:** ${summary.overall}`,
    '',
    `| Pages | Passed | Failed | A11y pages | Issues |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${summary.totals.pages} | ${summary.totals.passed} | ${summary.totals.failed} | ${summary.totals.a11yPages} | ${summary.totals.issues} |`,
    '',
    '## Pages checked',
    '',
  ];

  for (const page of summary.pages) {
    const status =
      page.error || !page.ok
        ? 'Failed'
        : page.a11yIssues.length || page.overflowMobile
          ? 'Issues'
          : 'Passed';
    lines.push(`- **${status}** · ${page.url} · HTTP ${page.status || 'n/a'} · a11y ${page.a11yIssues.length}`);
  }

  lines.push('', 'See `site-audit-full.md` for developer issue details.', '');
  return lines.join('\n');
}

function renderFullMarkdown(summary) {
  const lines = [
    '# Full Site Audit — Developer Details',
    '',
    `**Website:** ${summary.website}`,
    `**Date:** ${summary.date}`,
    `**Issues:** ${summary.issues.length}`,
    '',
  ];

  if (!summary.issues.length) {
    lines.push('No issues found across crawled pages.', '');
    return lines.join('\n');
  }

  summary.issues.forEach((issue, index) => {
    lines.push(`## ISSUE-${String(index + 1).padStart(3, '0')}: ${issue.title}`);
    lines.push('');
    lines.push(`- **Severity:** ${issue.severity}`);
    lines.push(`- **Page:** ${issue.page}`);
    lines.push('');
    lines.push('### Steps to reproduce');
    lines.push('');
    lines.push(`1. Open ${issue.page}`);
    lines.push('2. Observe the reported problem.');
    lines.push('');
    lines.push('### Expected');
    lines.push('');
    lines.push('Page loads cleanly with no serious accessibility or layout problems.');
    lines.push('');
    lines.push('### Actual');
    lines.push('');
    lines.push(issue.detail);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

async function main() {
  const website = (process.env.BASE_URL || 'https://example.com').replace(/\/$/, '');
  const start = normalizeUrl(website, website);
  if (!start) {
    console.error('Invalid BASE_URL');
    process.exit(1);
  }

  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright-core');
  const executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath)) {
    console.error(`Chromium not found at ${executablePath}`);
    process.exit(1);
  }

  console.log(`Full site audit → ${website}`);
  console.log(`Max pages: ${MAX_PAGES}, max depth: ${MAX_DEPTH}`);
  console.log(`Browsers: ${browsersDir}`);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const queue = [{ url: start.href, depth: 0 }];
  const seen = new Set();
  const pages = [];

  try {
    while (queue.length && pages.length < MAX_PAGES) {
      const next = queue.shift();
      if (!next || seen.has(next.url)) continue;
      seen.add(next.url);

      console.log(`[${pages.length + 1}/${MAX_PAGES}] Auditing ${next.url}`);
      const result = await auditPage(page, next.url);
      pages.push(result);

      if (next.depth >= MAX_DEPTH || !result.ok) continue;

      const hrefs = await collectLinks(page, next.url).catch(() => []);
      for (const href of hrefs) {
        const candidate = normalizeUrl(href, next.url);
        if (!isCrawlable(candidate, start.origin)) continue;
        const key = candidate.href;
        if (seen.has(key) || queue.some((q) => q.url === key)) continue;
        queue.push({ url: key, depth: next.depth + 1 });
      }
    }
  } finally {
    await browser.close();
  }

  const summary = buildSummary(pages, website);
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'site-audit.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-summary.html'), renderSummaryHtml(summary));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-full.html'), renderFullHtml(summary));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-summary.md'), renderSummaryMarkdown(summary));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-full.md'), renderFullMarkdown(summary));

  console.log('\nAudit complete');
  console.log(`Pages: ${summary.totals.pages}`);
  console.log(`Passed: ${summary.totals.passed}`);
  console.log(`Issues: ${summary.totals.issues}`);
  console.log(`Overall: ${summary.overall}`);
  console.log('\nSaved:');
  console.log('- reports/site-audit-summary.html / .md');
  console.log('- reports/site-audit-full.html / .md');
  console.log('- reports/site-audit.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

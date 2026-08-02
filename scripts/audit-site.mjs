import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { applyBrowsersPath, browsersDir } from '../lib/browsers.js';
import { readSiteUrls, slugFromUrl } from '../lib/site-urls.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(root, 'reports');
const pagesDir = path.join(reportsDir, 'pages');
const cacheDir = path.join(reportsDir, '.cache');

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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function clearProjectCache() {
  clearDir(cacheDir);
  clearDir(path.join(root, 'test-results'));
  clearDir(path.join(root, 'playwright-report'));
  clearDir(path.join(root, 'blob-report'));
  fs.mkdirSync(cacheDir, { recursive: true });
}

async function freshPage(browser) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  return { context, page };
}

async function closeSession(session) {
  if (!session) return;
  try {
    await session.context.clearCookies();
  } catch {
    // ignore
  }
  try {
    await session.context.close();
  } catch {
    // ignore
  }
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

    if (result.ok) {
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
    }
  } catch (err) {
    result.error = String(err?.message || err);
    result.loadMs = Date.now() - started;
  }

  return result;
}

function pageIssues(page) {
  const issues = [];
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
  return issues;
}

function renderPageHtml(pageResult, issues) {
  const status =
    pageResult.error || !pageResult.ok
      ? 'Failed'
      : issues.length
        ? 'Issues'
        : 'Passed';
  const issueBlocks = issues.length
    ? issues
        .map(
          (issue, index) => `
      <article class="issue">
        <h2>ISSUE-${String(index + 1).padStart(3, '0')}: ${escapeHtml(issue.title)}</h2>
        <p><strong>Severity:</strong> ${escapeHtml(issue.severity)}</p>
        <p class="actual">${escapeHtml(issue.detail)}</p>
      </article>`,
        )
        .join('')
    : '<p>No issues found on this page.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Page audit · ${escapeHtml(pageResult.url)}</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #eef2f4; color: #12202b; }
    main { max-width: 860px; margin: 2rem auto; background: #fffdf8; border: 1px solid #d7dde3; border-radius: 16px; padding: 2rem; }
    .actual { color: #b42318; }
    .issue { border-top: 1px solid #d7dde3; padding-top: 1rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <main>
    <h1>Page audit</h1>
    <p><strong>URL:</strong> <a href="${escapeHtml(pageResult.url)}">${escapeHtml(pageResult.url)}</a></p>
    <p><strong>Title:</strong> ${escapeHtml(pageResult.title || '-')}</p>
    <p><strong>Result:</strong> ${status} · HTTP ${pageResult.status || 'n/a'} · ${pageResult.loadMs} ms</p>
    ${issueBlocks}
  </main>
</body>
</html>`;
}

function savePageReport(pageResult, index) {
  const slug = slugFromUrl(pageResult.url, index);
  const dir = path.join(pagesDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const issues = pageIssues(pageResult);
  const payload = {
    ...pageResult,
    slug,
    index: index + 1,
    issues,
    auditedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'page-audit.json'), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(dir, 'page-audit.html'), renderPageHtml(pageResult, issues));
  return payload;
}

function buildSummary(pages, website, sourceList) {
  const passed = pages.filter(
    (p) => p.ok && !p.a11yIssues.length && !p.overflowMobile && !p.error,
  );
  const failed = pages.filter((p) => !p.ok || p.error);
  const a11yPages = pages.filter((p) => p.a11yIssues.length);
  const overflowPages = pages.filter((p) => p.overflowMobile);
  const issues = pages.flatMap((p) => pageIssues(p));

  return {
    website,
    date: new Date().toLocaleString(),
    fetchedAt: new Date().toISOString(),
    sourceList: {
      count: sourceList?.count ?? pages.length,
      discoveredAt: sourceList?.discoveredAt ?? null,
      path: 'data/site-urls.json',
    },
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
    <p class="muted">Per-URL reports are in reports/pages/. See site-audit-full.html for issue details.</p>
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
    : '<p>No issues found across audited pages.</p>';

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
    `**URL list:** data/site-urls.json (${summary.sourceList.count} URLs)`,
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
    lines.push(
      `- **${status}** · ${page.url} · HTTP ${page.status || 'n/a'} · a11y ${page.a11yIssues.length}`,
    );
  }

  lines.push('', 'See `site-audit-full.md` and `reports/pages/` for details.', '');
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
    lines.push('No issues found across audited pages.', '');
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

function writeAggregate(summary) {
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'site-audit.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-summary.html'), renderSummaryHtml(summary));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-full.html'), renderFullHtml(summary));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-summary.md'), renderSummaryMarkdown(summary));
  fs.writeFileSync(path.join(reportsDir, 'site-audit-full.md'), renderFullMarkdown(summary));
}

async function main() {
  const scope = process.env.SITE_RUN_SCOPE === 'current' ? 'current' : 'all';
  const list = readSiteUrls();
  const fallback = (process.env.BASE_URL || 'https://example.com').replace(/\/$/, '');
  const website = list?.website || fallback;

  let urls;
  if (scope === 'current') {
    urls = [fallback.endsWith('/') ? fallback : `${fallback}/`];
  } else {
    if (!list?.urls?.length) {
      console.error(
        'No URL list found. Click "Find all URLs" first (saves data/site-urls.json), or choose Current URL.',
      );
      process.exit(1);
    }
    urls = list.urls;
  }

  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright-core');
  const executablePath = chromium.executablePath();
  if (!fs.existsSync(executablePath)) {
    console.error(`Chromium not found at ${executablePath}`);
    process.exit(1);
  }

  console.log(`Site audit · scope=${scope} → ${website}`);
  console.log(`URLs: ${urls.length}`);
  if (scope === 'all') {
    console.log(`Source: data/site-urls.json (${list.discoveredAt || 'unknown date'})`);
  }
  console.log(`Browsers: ${browsersDir}`);

  clearDir(pagesDir);
  clearProjectCache();
  fs.mkdirSync(pagesDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });

  const pages = [];

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] Auditing ${url}`);

      let session = null;
      try {
        session = await freshPage(browser);
        const result = await auditPage(session.page, url);
        pages.push(result);
        const saved = savePageReport(result, i);
        console.log(
          `  → ${result.ok ? 'HTTP ' + result.status : 'FAILED'} · ${saved.issues.length} issue(s) · saved reports/pages/${saved.slug}/`,
        );
      } catch (err) {
        const failed = {
          url,
          status: 0,
          title: '',
          ok: false,
          loadMs: 0,
          a11yIssues: [],
          overflowMobile: false,
          error: String(err?.message || err),
        };
        pages.push(failed);
        const saved = savePageReport(failed, i);
        console.log(`  → ERROR · saved reports/pages/${saved.slug}/`);
      } finally {
        await closeSession(session);
        clearProjectCache();
        console.log('  → cache cleared, moving to next URL');
      }

      // Keep aggregate fresh so a long run still has a usable report if stopped.
      writeAggregate(buildSummary(pages, website, {
        count: urls.length,
        discoveredAt: list?.discoveredAt ?? null,
      }));
    }
  } finally {
    await browser.close();
  }

  const summary = buildSummary(pages, website, {
    count: urls.length,
    discoveredAt: list?.discoveredAt ?? null,
  });
  writeAggregate(summary);

  console.log('\nAudit complete');
  console.log(`Pages: ${summary.totals.pages}`);
  console.log(`Passed: ${summary.totals.passed}`);
  console.log(`Issues: ${summary.totals.issues}`);
  console.log(`Overall: ${summary.overall}`);
  console.log('\nSaved:');
  console.log('- reports/site-audit-summary.html / .md');
  console.log('- reports/site-audit-full.html / .md');
  console.log('- reports/site-audit.json');
  console.log('- reports/pages/<url>/page-audit.html + .json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

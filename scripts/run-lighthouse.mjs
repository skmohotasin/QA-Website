import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import { applyBrowsersPath, browsersDir } from '../lib/browsers.js';
import { getSuiteMeta } from '../lib/suite-meta.js';
import { readSiteUrls, slugFromUrl } from '../lib/site-urls.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = path.join(root, 'reports');
const pagesDir = path.join(reportsDir, 'lighthouse-pages');

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

function chromePath() {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright-core');
  return chromium.executablePath();
}

function scoreOf(category) {
  if (!category || category.score == null) return null;
  return Math.round(category.score * 100);
}

function toneFor(score) {
  if (score == null) return 'ok';
  if (score >= 90) return 'good';
  if (score >= 50) return 'ok';
  return 'poor';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const HINTS = {
  performance: 'How fast the page feels to load and become usable.',
  accessibility: 'How usable the page is for people with disabilities.',
  'best-practices': 'Modern web quality and security basics.',
  seo: 'How well the page can be found and understood by search engines.',
  pwa: 'Progressive Web App readiness (if applicable).',
};

function categoriesFromLhr(lhr) {
  const categories = {};
  for (const [id, category] of Object.entries(lhr.categories || {})) {
    const score = scoreOf(category);
    categories[id] = {
      title: category.title,
      score,
      tone: toneFor(score),
      hint: HINTS[id] || 'Lighthouse category score (0–100).',
    };
  }
  return categories;
}

function averageCategories(pageResults) {
  const keys = ['performance', 'accessibility', 'best-practices', 'seo'];
  const averages = {};
  for (const key of keys) {
    const scores = pageResults
      .map((p) => p.categories?.[key]?.score)
      .filter((s) => s != null);
    const score = scores.length
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
    averages[key] = {
      title:
        pageResults[0]?.categories?.[key]?.title ||
        key.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      score,
      tone: toneFor(score),
      hint: HINTS[key] || 'Average score across audited pages.',
    };
  }
  return averages;
}

function collectFailedAudits(lhr, limit = 20) {
  const audits = lhr.audits || {};
  const failed = Object.values(audits).filter(
    (audit) =>
      audit &&
      audit.score !== null &&
      audit.score < 1 &&
      audit.scoreDisplayMode !== 'informative' &&
      audit.scoreDisplayMode !== 'manual' &&
      audit.scoreDisplayMode !== 'notApplicable',
  );
  failed.sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
  return failed.slice(0, limit).map((audit) => ({
    id: audit.id,
    title: audit.title,
    score: audit.score == null ? null : Math.round(audit.score * 100),
    description: audit.description
      ? audit.description.replace(/\s+/g, ' ').trim()
      : '',
    displayValue: audit.displayValue || '',
  }));
}

function renderSummaryHtml(summary) {
  const avgRows = Object.values(summary.categories)
    .map(
      (value) => `
      <tr>
        <td><strong>${escapeHtml(value.title)}</strong><div class="hint">${escapeHtml(value.hint)}</div></td>
        <td><span class="score ${value.tone}">${value.score ?? 'n/a'}</span></td>
      </tr>`,
    )
    .join('');

  const pageRows = (summary.pages || [])
    .map((page) => {
      const cells = ['performance', 'accessibility', 'best-practices', 'seo']
        .map((key) => {
          const item = page.categories?.[key];
          return `<td><span class="score ${item?.tone || 'ok'}">${item?.score ?? 'n/a'}</span></td>`;
        })
        .join('');
      return `<tr>
        <td><a href="${escapeHtml(page.url)}">${escapeHtml(page.url)}</a></td>
        ${cells}
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lighthouse Summary</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, sans-serif; margin: 0; background: #eef2f4; color: #12202b; }
    main { max-width: 960px; margin: 2rem auto; background: #fffdf8; border: 1px solid #d7dde3; border-radius: 16px; padding: 2rem; overflow: hidden; }
    h1 { margin: 0 0 0.35rem; }
    h2 { margin: 1.5rem 0 0.75rem; font-size: 1.15rem; }
    .sub { color: #5a6b78; margin: 0 0 1.25rem; }
    .suite { border: 1px solid #d7dde3; border-radius: 12px; padding: 0.9rem 1rem; margin: 0 0 1rem; background: #fff; }
    .suite span { display: block; color: #5a6b78; font-size: 0.85rem; }
    .suite strong { font-size: 1.15rem; }
    .suite p { margin: 0.35rem 0 0; color: #5a6b78; }
    .table-wrap { width: 100%; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { text-align: left; padding: 0.85rem 0.5rem; border-bottom: 1px solid #d7dde3; vertical-align: top; overflow-wrap: anywhere; }
    .hint { color: #5a6b78; font-size: 0.9rem; margin-top: 0.2rem; }
    .score { display: inline-block; min-width: 3rem; font-weight: 800; font-size: 1.05rem; }
    .score.good { color: #16794c; }
    .score.ok { color: #b45309; }
    .score.poor { color: #b42318; }
    .footer { margin-top: 1.25rem; color: #5a6b78; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main>
    <h1>Lighthouse Report</h1>
    <div class="suite">
      <span>Test suite</span>
      <strong>${escapeHtml(summary.suite || 'Lighthouse')}</strong>
      <p>${escapeHtml(summary.suiteDescription || '')}</p>
      <p>Scope: ${escapeHtml(summary.scopeLabel || 'Current URL')}</p>
    </div>
    <p class="sub">${escapeHtml(summary.website)} · ${escapeHtml(summary.date)} · ${summary.pageCount || 1} page(s)</p>

    <h2>Average scores</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Category</th><th>Score</th></tr></thead>
        <tbody>${avgRows}</tbody>
      </table>
    </div>

    ${
      summary.pages?.length
        ? `<h2>Pages</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>URL</th><th>Performance</th><th>Accessibility</th><th>Best Practices</th><th>SEO</th>
          </tr>
        </thead>
        <tbody>${pageRows}</tbody>
      </table>
    </div>`
        : ''
    }

    <p class="footer">Full detail: lighthouse-full.html · Generated by QA Website</p>
  </main>
</body>
</html>`;
}

function renderSummaryMarkdown(summary) {
  const lines = [
    '# Lighthouse Summary',
    '',
    `**Test:** ${summary.suite || 'Lighthouse'}`,
    `**About this test:** ${summary.suiteDescription || ''}`,
    `**Scope:** ${summary.scopeLabel || 'Current URL'}`,
    `**Website:** ${summary.website}`,
    `**Date:** ${summary.date}`,
    `**Pages:** ${summary.pageCount || 1}`,
    '',
    '## Average scores',
    '',
    '| Category | Score | What it means |',
    '| --- | --- | --- |',
  ];

  for (const item of Object.values(summary.categories)) {
    lines.push(`| ${item.title} | ${item.score ?? 'n/a'} | ${item.hint} |`);
  }

  if (summary.pages?.length) {
    lines.push('', '## Pages', '');
    for (const page of summary.pages) {
      const scores = ['performance', 'accessibility', 'best-practices', 'seo']
        .map((key) => `${page.categories?.[key]?.title || key}: ${page.categories?.[key]?.score ?? 'n/a'}`)
        .join(' · ');
      lines.push(`- ${page.url} — ${scores}`);
    }
  }

  lines.push('');
  lines.push('See `lighthouse-full.md` / `lighthouse-full.html` for detailed findings.');
  lines.push('');
  return lines.join('\n');
}

function renderFullHtml(summary) {
  const pageBlocks = (summary.pages || [])
    .map((page) => {
      const scoreRow = Object.values(page.categories || {})
        .map(
          (c) =>
            `<li><strong>${escapeHtml(c.title)}:</strong> <span class="score ${c.tone}">${c.score ?? 'n/a'}</span></li>`,
        )
        .join('');
      const issues = (page.issues || [])
        .map(
          (issue) => `
        <article class="issue">
          <h3>${escapeHtml(issue.title)}</h3>
          <p><strong>Score:</strong> ${issue.score ?? 'n/a'} · <strong>ID:</strong> ${escapeHtml(issue.id)}</p>
          <p>${escapeHtml(issue.description || '')}</p>
          ${issue.displayValue ? `<p><strong>Value:</strong> ${escapeHtml(issue.displayValue)}</p>` : ''}
        </article>`,
        )
        .join('');
      return `
      <section class="page-block">
        <h2>${escapeHtml(page.url)}</h2>
        <ul class="scores">${scoreRow}</ul>
        ${page.reportFile ? `<p><a href="${escapeHtml(page.reportFile)}">Open interactive Lighthouse HTML</a></p>` : ''}
        <h3>Top issues</h3>
        ${issues || '<p>No failed audits reported.</p>'}
      </section>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lighthouse Full Report</title>
  <style>
    body { font-family: "Segoe UI", Tahoma, sans-serif; margin: 0; background: #eef2f4; color: #12202b; }
    main { max-width: 960px; margin: 2rem auto; background: #fffdf8; border: 1px solid #d7dde3; border-radius: 16px; padding: 2rem; }
    h1 { margin: 0 0 0.35rem; }
    h2 { margin: 1.5rem 0 0.5rem; font-size: 1.1rem; overflow-wrap: anywhere; }
    h3 { margin: 1rem 0 0.4rem; font-size: 1rem; }
    .suite { border: 1px solid #d7dde3; border-radius: 12px; padding: 0.9rem 1rem; margin: 0 0 1rem; background: #fff; }
    .suite span { display: block; color: #5a6b78; font-size: 0.85rem; }
    .suite strong { font-size: 1.15rem; }
    .suite p { margin: 0.35rem 0 0; color: #5a6b78; }
    .page-block { border-top: 1px solid #d7dde3; padding-top: 1rem; margin-top: 1rem; }
    .scores { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem; }
    .score.good { color: #16794c; font-weight: 800; }
    .score.ok { color: #b45309; font-weight: 800; }
    .score.poor { color: #b42318; font-weight: 800; }
    .issue { margin: 0.75rem 0; padding: 0.75rem; background: #fff; border: 1px solid #d7dde3; border-radius: 10px; }
  </style>
</head>
<body>
  <main>
    <h1>Lighthouse Full Report</h1>
    <div class="suite">
      <span>Test suite</span>
      <strong>${escapeHtml(summary.suite || 'Lighthouse')}</strong>
      <p>${escapeHtml(summary.suiteDescription || '')}</p>
      <p>Scope: ${escapeHtml(summary.scopeLabel || 'Current URL')}</p>
    </div>
    <p>${escapeHtml(summary.website)} · ${escapeHtml(summary.date)} · ${summary.pageCount || 1} page(s)</p>
    ${pageBlocks}
  </main>
</body>
</html>`;
}

function renderFullMarkdown(summary) {
  const lines = [
    '# Lighthouse Full Report',
    '',
    `**Test:** ${summary.suite || 'Lighthouse'}`,
    `**About this test:** ${summary.suiteDescription || ''}`,
    `**Scope:** ${summary.scopeLabel || 'Current URL'}`,
    `**Website:** ${summary.website}`,
    `**Date:** ${summary.date}`,
    `**Pages:** ${summary.pageCount || 1}`,
    '',
    '## Average scores',
    '',
    '| Category | Score |',
    '| --- | --- |',
  ];

  for (const item of Object.values(summary.categories)) {
    lines.push(`| ${item.title} | ${item.score ?? 'n/a'} |`);
  }

  for (const page of summary.pages || []) {
    lines.push('', `## ${page.url}`, '');
    for (const item of Object.values(page.categories || {})) {
      lines.push(`- **${item.title}:** ${item.score ?? 'n/a'}`);
    }
    if (page.reportFile) lines.push('', `[Interactive HTML](${page.reportFile})`, '');
    lines.push('', '### Top issues', '');
    if (!page.issues?.length) {
      lines.push('No failed audits reported.', '');
    } else {
      for (const issue of page.issues) {
        lines.push(`#### ${issue.title}`);
        lines.push('');
        lines.push(`- **ID:** ${issue.id}`);
        lines.push(`- **Score:** ${issue.score ?? 'n/a'}`);
        if (issue.description) lines.push(`- **Details:** ${issue.description}`);
        if (issue.displayValue) lines.push(`- **Value:** ${issue.displayValue}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

async function auditOneUrl(chromePort, url) {
  const result = await lighthouse(url, {
    port: chromePort,
    output: ['html', 'json'],
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  });
  const lhr = result.lhr;
  const htmlReport = Array.isArray(result.report) ? result.report[0] : result.report;
  return {
    url,
    finalUrl: lhr.finalUrl,
    categories: categoriesFromLhr(lhr),
    issues: collectFailedAudits(lhr),
    htmlReport,
  };
}

async function main() {
  const scope = process.env.SITE_RUN_SCOPE === 'all' ? 'all' : 'current';
  const list = readSiteUrls();
  const fallback = (process.env.BASE_URL || 'https://example.com').replace(/\/$/, '');
  const website = list?.website || fallback;

  let urls;
  if (scope === 'all') {
    if (!list?.urls?.length) {
      console.error(
        'No URL list found. Click "Find all URLs" first, or choose Current URL.',
      );
      process.exit(1);
    }
    urls = [...list.urls];
  } else {
    urls = [fallback.endsWith('/') ? fallback : `${fallback}/`];
  }

  const maxUrls = Number(process.env.SITE_MULTI_MAX_URLS) || 0;
  if (maxUrls > 0) urls = urls.slice(0, maxUrls);

  const executablePath = chromePath();
  if (!fs.existsSync(executablePath)) {
    console.error(`Chromium not found at ${executablePath}`);
    console.error('Install browsers from the console first.');
    process.exit(1);
  }

  const meta = getSuiteMeta('lighthouse');
  console.log(`Lighthouse · scope=${scope} · ${urls.length} URL(s)`);
  console.log(`Website: ${website}`);
  console.log(`Using Chromium: ${executablePath}`);
  console.log(`Browsers dir: ${browsersDir}`);

  fs.mkdirSync(reportsDir, { recursive: true });
  if (fs.existsSync(pagesDir)) fs.rmSync(pagesDir, { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });

  const chrome = await chromeLauncher.launch({
    chromePath: executablePath,
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
  });

  const pageResults = [];

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`\n[${i + 1}/${urls.length}] Lighthouse → ${url}`);
      try {
        const page = await auditOneUrl(chrome.port, url);
        const slug = slugFromUrl(url, i);
        const reportFile = `lighthouse-pages/${slug}.html`;
        fs.writeFileSync(path.join(pagesDir, `${slug}.html`), page.htmlReport, 'utf8');
        pageResults.push({
          url: page.url,
          finalUrl: page.finalUrl,
          categories: page.categories,
          issues: page.issues,
          reportFile,
        });
        const scores = Object.values(page.categories)
          .map((c) => `${c.title} ${c.score ?? 'n/a'}`)
          .join(' · ');
        console.log(`  → ${scores}`);
      } catch (err) {
        console.log(`  → failed: ${err?.message || err}`);
        pageResults.push({
          url,
          finalUrl: url,
          categories: {
            performance: { title: 'Performance', score: null, tone: 'poor', hint: HINTS.performance },
            accessibility: {
              title: 'Accessibility',
              score: null,
              tone: 'poor',
              hint: HINTS.accessibility,
            },
            'best-practices': {
              title: 'Best Practices',
              score: null,
              tone: 'poor',
              hint: HINTS['best-practices'],
            },
            seo: { title: 'SEO', score: null, tone: 'poor', hint: HINTS.seo },
          },
          issues: [
            {
              id: 'lighthouse-run-failed',
              title: 'Lighthouse run failed',
              score: 0,
              description: String(err?.message || err),
              displayValue: '',
            },
          ],
          reportFile: null,
        });
      }
    }
  } finally {
    try {
      await chrome.kill();
    } catch (err) {
      console.warn(`Chrome cleanup warning: ${err?.message || err}`);
    }
  }

  const summary = {
    website,
    suite: meta.label,
    suiteDescription: meta.description,
    suiteKey: 'lighthouse',
    scope,
    scopeLabel: scope === 'all' ? 'All URLs' : 'Current URL',
    date: new Date().toLocaleString(),
    fetchedAt: new Date().toISOString(),
    pageCount: pageResults.length,
    pages: pageResults,
    categories: averageCategories(pageResults),
    finalUrl: pageResults[0]?.finalUrl || website,
  };

  fs.writeFileSync(
    path.join(reportsDir, 'lighthouse.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'lighthouse-summary.html'),
    renderSummaryHtml(summary),
    'utf8',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'lighthouse-summary.md'),
    renderSummaryMarkdown(summary),
    'utf8',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'lighthouse-full.html'),
    renderFullHtml(summary),
    'utf8',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'lighthouse-full.md'),
    renderFullMarkdown(summary),
    'utf8',
  );

  console.log('\nAverage scores:');
  for (const item of Object.values(summary.categories)) {
    console.log(`- ${item.title}: ${item.score ?? 'n/a'}`);
  }
  console.log('\nSaved:');
  console.log('- reports/lighthouse-summary.html / .md');
  console.log('- reports/lighthouse-full.html / .md');
  console.log('- reports/lighthouse.json');
  console.log('- reports/lighthouse-pages/*.html');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

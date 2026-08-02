import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { applyBrowsersPath, browsersDir } from '../lib/browsers.js';
import {
  isCrawlable,
  normalizeUrl,
  writeSiteUrls,
} from '../lib/site-urls.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PAGES = Number(process.env.SITE_DISCOVER_MAX_PAGES) || 200;
const MAX_DEPTH = Number(process.env.SITE_DISCOVER_MAX_DEPTH) || 5;

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

async function collectLinks(page) {
  return page.$$eval('a[href]', (anchors) =>
    anchors.map((a) => a.getAttribute('href') || '').filter(Boolean),
  );
}

async function fetchSitemapUrls(origin) {
  const found = new Set();
  const queue = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const seenMaps = new Set();

  while (queue.length && found.size < MAX_PAGES) {
    const mapUrl = queue.shift();
    if (!mapUrl || seenMaps.has(mapUrl)) continue;
    seenMaps.add(mapUrl);

    try {
      const res = await fetch(mapUrl, {
        headers: { Accept: 'application/xml,text/xml,*/*' },
        redirect: 'follow',
      });
      if (!res.ok) continue;
      const text = await res.text();
      const locs = [...text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) =>
        m[1].trim(),
      );
      for (const loc of locs) {
        if (/\.xml($|\?)/i.test(loc)) {
          queue.push(loc);
          continue;
        }
        const url = normalizeUrl(loc, origin);
        if (isCrawlable(url, origin)) found.add(url.href);
        if (found.size >= MAX_PAGES) break;
      }
    } catch {
      // sitemap optional
    }
  }

  return [...found];
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

  console.log(`Find all URLs → ${website}`);
  console.log(`Max pages: ${MAX_PAGES}, max depth: ${MAX_DEPTH}`);
  console.log(`Browsers: ${browsersDir}`);

  const urls = new Set([start.href]);
  const queue = [{ url: start.href, depth: 0 }];
  const visited = new Set();

  console.log('Checking sitemap…');
  const fromSitemap = await fetchSitemapUrls(start.origin);
  for (const url of fromSitemap) {
    urls.add(url);
    if (queue.length < MAX_PAGES) queue.push({ url, depth: 0 });
  }
  console.log(`Sitemap contributed ${fromSitemap.length} URL(s)`);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    while (queue.length && visited.size < MAX_PAGES) {
      const next = queue.shift();
      if (!next || visited.has(next.url)) continue;
      visited.add(next.url);
      urls.add(next.url);

      console.log(`[${visited.size}/${MAX_PAGES}] Scanning ${next.url}`);
      try {
        const response = await page.goto(next.url, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        const status = response?.status() ?? 0;
        if (status >= 400 || next.depth >= MAX_DEPTH) continue;

        const hrefs = await collectLinks(page).catch(() => []);
        for (const href of hrefs) {
          const candidate = normalizeUrl(href, next.url);
          if (!isCrawlable(candidate, start.origin)) continue;
          const key = candidate.href;
          if (urls.has(key) || visited.has(key) || queue.some((q) => q.url === key)) {
            continue;
          }
          urls.add(key);
          queue.push({ url: key, depth: next.depth + 1 });
          if (urls.size >= MAX_PAGES) break;
        }
      } catch (err) {
        console.log(`  skip: ${err?.message || err}`);
      }

      if (urls.size >= MAX_PAGES) break;
    }
  } finally {
    await browser.close();
  }

  const list = [...urls].sort((a, b) => a.localeCompare(b)).slice(0, MAX_PAGES);
  const payload = {
    website,
    discoveredAt: new Date().toISOString(),
    count: list.length,
    source: 'discover-urls',
    maxPages: MAX_PAGES,
    maxDepth: MAX_DEPTH,
    urls: list,
  };

  const savedPath = writeSiteUrls(payload);
  console.log('\nURL list saved');
  console.log(`Count: ${list.length}`);
  console.log(`File: ${savedPath}`);
  console.log('Next: run Audit entire site to audit this list one by one.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

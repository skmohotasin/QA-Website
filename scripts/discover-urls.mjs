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
const MAX_PAGES = Number(process.env.SITE_DISCOVER_MAX_PAGES) || 500;
const MAX_DEPTH = Number(process.env.SITE_DISCOVER_MAX_DEPTH) || 8;
const MAX_SITEMAPS = Number(process.env.SITE_DISCOVER_MAX_SITEMAPS) || 40;
const SETTLE_MS = Number(process.env.SITE_DISCOVER_SETTLE_MS) || 1500;

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

function decodeXml(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim();
}

function looksLikeXml(text) {
  const sample = String(text || '')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .slice(0, 200)
    .toLowerCase();
  return (
    sample.startsWith('<?xml') ||
    sample.startsWith('<urlset') ||
    sample.startsWith('<sitemapindex') ||
    sample.includes('<urlset') ||
    sample.includes('<sitemapindex')
  );
}

function isParamRoute(pathname) {
  return /[:*]/.test(pathname) || /\{[^}]+\}/.test(pathname);
}

function isLikelyAppPage(pathname) {
  const p = pathname.toLowerCase();
  if (
    /refresh_token|verify-otp|\/oauth|\/graphql|\/healthz?$|\/favicon/.test(p)
  ) {
    return false;
  }
  return true;
}

function routeToUrl(origin, routePath) {
  if (!routePath || typeof routePath !== 'string') return null;
  let cleaned = routePath.trim();
  if (!cleaned.startsWith('/')) cleaned = `/${cleaned}`;
  if (isParamRoute(cleaned)) return null;
  if (cleaned.length > 180) return null;
  return normalizeUrl(cleaned, origin);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
      'User-Agent': 'QA-Website-Discover/1.0',
    },
    redirect: 'follow',
  });
  if (!res.ok) return { ok: false, status: res.status, text: '', contentType: '' };
  const text = await res.text();
  return {
    ok: true,
    status: res.status,
    text,
    contentType: res.headers.get('content-type') || '',
  };
}

async function readRobotsSitemaps(origin) {
  const maps = [];
  try {
    const robots = await fetchText(`${origin}/robots.txt`);
    if (!robots.ok || !robots.text) return maps;
    if (looksLikeXml(robots.text) || robots.text.trimStart().startsWith('<!')) return maps;
    for (const line of robots.text.split(/\r?\n/)) {
      const match = line.match(/^\s*sitemap:\s*(.+)\s*$/i);
      if (match?.[1]) maps.push(decodeXml(match[1]));
    }
  } catch {
    // optional
  }
  return maps;
}

async function fetchSitemapUrls(origin) {
  const found = new Set();
  const seed = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
    `${origin}/sitemap.xml.gz`,
    ...(await readRobotsSitemaps(origin)),
  ];
  const queue = [...new Set(seed)];
  const seenMaps = new Set();

  while (queue.length && found.size < MAX_PAGES && seenMaps.size < MAX_SITEMAPS) {
    const mapUrl = queue.shift();
    if (!mapUrl || seenMaps.has(mapUrl)) continue;
    seenMaps.add(mapUrl);

    try {
      const res = await fetchText(mapUrl);
      if (!res.ok) continue;
      if (!looksLikeXml(res.text)) {
        console.log(`  skip non-XML sitemap: ${mapUrl}`);
        continue;
      }
      const locs = [...res.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) =>
        decodeXml(m[1]),
      );
      for (const loc of locs) {
        if (!loc) continue;
        if (/\.xml(\.gz)?($|\?)/i.test(loc) || /sitemap/i.test(loc)) {
          if (!seenMaps.has(loc) && queue.length + seenMaps.size < MAX_SITEMAPS * 2) {
            queue.push(loc);
          }
          continue;
        }
        const url = normalizeUrl(loc, origin);
        if (isCrawlable(url, origin)) found.add(url.href);
        if (found.size >= MAX_PAGES) break;
      }
      console.log(`  sitemap ${mapUrl} → ${locs.length} loc(s)`);
    } catch {
      // sitemap optional
    }
  }

  return [...found];
}

function extractRoutesFromJs(source, origin) {
  const found = new Set();
  if (!source) return found;

  const addPath = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    let cleaned = raw.trim();
    if (!cleaned.startsWith('/')) return;
    cleaned = cleaned.split('?')[0].split('#')[0];
    if (cleaned.length > 120) return;
    if (
      cleaned.startsWith('/assets') ||
      cleaned.startsWith('/static') ||
      cleaned.startsWith('/api') ||
      cleaned.startsWith('/node_modules')
    ) {
      return;
    }
    const url = routeToUrl(origin, cleaned);
    if (url && isCrawlable(url, origin) && isLikelyAppPage(url.pathname)) {
      found.add(url.href);
    }
  };

  for (const match of source.matchAll(/\bpath\s*:\s*["'`]([^"'`]+)["'`]/g)) {
    addPath(match[1]);
  }
  for (const match of source.matchAll(/<Route[^>]+path=["'`]([^"'`]+)["'`]/g)) {
    addPath(match[1]);
  }
  for (const match of source.matchAll(/\b(?:to|href|navigate)\(\s*["'`](\/[^"'`]+)["'`]/g)) {
    addPath(match[1]);
  }
  for (const match of source.matchAll(/\b(?:to|href)=["'`](\/[^"'`]+)["'`]/g)) {
    addPath(match[1]);
  }

  // Quoted absolute app paths (avoid file-like and asset paths).
  for (const match of source.matchAll(/["'`](\/[a-zA-Z][\w\-/]{1,80})["'`]/g)) {
    const p = match[1];
    if (p.includes('.') || isParamRoute(p)) continue;
    // Prefer paths that look like app routes (few segments, no file extension).
    const segments = p.split('/').filter(Boolean);
    if (segments.length === 0 || segments.length > 5) continue;
    if (segments.some((s) => s.length > 40)) continue;
    addPath(p);
  }

  return found;
}

async function collectDomLinks(page) {
  return page.evaluate(() => {
    const hrefs = new Set();

    const add = (value) => {
      if (!value) return;
      const trimmed = String(value).trim();
      if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:')) return;
      hrefs.add(trimmed);
    };

    document.querySelectorAll('a[href], area[href], link[rel="alternate"]').forEach((el) => {
      add(el.getAttribute('href'));
    });

    document.querySelectorAll('[data-href], [data-url], [data-to], [data-link]').forEach((el) => {
      add(el.getAttribute('data-href'));
      add(el.getAttribute('data-url'));
      add(el.getAttribute('data-to'));
      add(el.getAttribute('data-link'));
    });

    document.querySelectorAll('[role="link"]').forEach((el) => {
      add(el.getAttribute('href'));
      add(el.getAttribute('data-href'));
    });

    // React Router / Next-style props sometimes stringify into DOM comments rarely;
    // also pick up same-origin absolute URLs in plain text for small apps.
    const html = document.documentElement?.innerHTML || '';
    for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) add(match[1]);
    for (const match of html.matchAll(/to=["'](\/[^"']+)["']/gi)) add(match[1]);

    return [...hrefs];
  });
}

async function expandMenus(page) {
  const selectors = [
    'button[aria-expanded="false"]',
    'button[aria-haspopup="menu"]',
    'button[aria-haspopup="true"]',
    '[aria-label*="menu" i]',
    '[aria-label*="Menu" i]',
    'nav button',
    'header button',
  ];

  for (const selector of selectors) {
    const handles = await page.$$(selector);
    for (const handle of handles.slice(0, 8)) {
      try {
        await handle.click({ timeout: 800 });
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch {
        // ignore
      }
    }
  }
}

async function collectScriptUrls(page, origin) {
  const found = new Set();

  const fromDom = await page.$$eval('script[src]', (nodes) =>
    nodes.map((n) => n.getAttribute('src') || n.src).filter(Boolean),
  );
  for (const src of fromDom) {
    try {
      const url = new URL(src, origin);
      if (url.origin === origin && /\.m?js(\?|$)/i.test(url.pathname)) {
        found.add(url.href);
      }
    } catch {
      // ignore
    }
  }

  const html = await page.content();
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin === origin && /\.m?js(\?|$)/i.test(url.pathname)) {
        found.add(url.href);
      }
    } catch {
      // ignore
    }
  }

  return [...found];
}

async function discoverFromAssets(page, origin, extraScriptUrls = []) {
  const found = new Set();
  const scriptSrcs = [
    ...(await collectScriptUrls(page, origin)),
    ...extraScriptUrls,
  ];

  const unique = [...new Set(scriptSrcs)].slice(0, 20);
  console.log(`  parsing ${unique.length} JS asset(s) for routes…`);

  for (const src of unique) {
    try {
      const scriptUrl = new URL(src, origin);
      if (scriptUrl.origin !== origin) continue;
      const res = await fetchText(scriptUrl.href);
      if (!res.ok) {
        console.log(`  asset fetch failed ${scriptUrl.pathname}: HTTP ${res.status}`);
        continue;
      }
      const routes = extractRoutesFromJs(res.text, origin);
      for (const url of routes) found.add(url);
      console.log(`  routes from ${scriptUrl.pathname}: ${routes.size}`);
    } catch (err) {
      console.log(`  asset parse skip: ${err?.message || err}`);
    }
  }

  return found;
}

async function settlePage(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 8_000 });
  } catch {
    // SPA may keep connections open
  }
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

function enqueue(url, depth, { urls, queue, visited, queued }) {
  if (!url || urls.size >= MAX_PAGES) return false;
  if (visited.has(url) || queued.has(url)) return false;
  urls.add(url);
  queued.add(url);
  queue.push({ url, depth });
  return true;
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

  const urls = new Set();
  const queue = [];
  const visited = new Set();
  const queued = new Set();
  const sources = {
    seed: 0,
    sitemap: 0,
    assets: 0,
    crawl: 0,
  };

  enqueue(start.href, 0, { urls, queue, visited, queued });
  sources.seed = 1;

  console.log('Checking sitemap + robots.txt…');
  const fromSitemap = await fetchSitemapUrls(start.origin);
  for (const url of fromSitemap) {
    if (enqueue(url, 0, { urls, queue, visited, queued })) sources.sitemap += 1;
  }
  console.log(`Sitemap contributed ${fromSitemap.length} crawlable URL(s)`);

  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 QA-Website-Discover/1.0',
  });
  const page = await context.newPage();
  const seenJsResponses = new Set();
  page.on('response', async (response) => {
    try {
      const url = response.url();
      const status = response.status();
      if (status < 200 || status >= 400) return;

      if (/\.m?js(\?|$)/i.test(url)) {
        const parsed = new URL(url);
        if (parsed.origin === start.origin) seenJsResponses.add(url);
        return;
      }

      const contentType = (response.headers()['content-type'] || '').toLowerCase();
      if (!contentType.includes('json')) return;

      const text = await response.text();
      if (!text || text.length > 2_000_000) return;

      // Pull same-origin absolute URLs and /job/<id> style paths from API payloads.
      for (const match of text.matchAll(/https?:\/\/[^"'\s\\]+/g)) {
        const candidate = normalizeUrl(match[0].replace(/[),.;]+$/, ''), start.origin);
        if (
          isCrawlable(candidate, start.origin) &&
          isLikelyAppPage(candidate.pathname) &&
          enqueue(candidate.href, 1, { urls, queue, visited, queued })
        ) {
          sources.crawl += 1;
        }
      }
      for (const match of text.matchAll(/["'](\/job\/[a-zA-Z0-9\-]+)["']/g)) {
        const candidate = normalizeUrl(match[1], start.origin);
        if (
          isCrawlable(candidate, start.origin) &&
          enqueue(candidate.href, 1, { urls, queue, visited, queued })
        ) {
          sources.crawl += 1;
        }
      }
      for (const match of text.matchAll(
        /["'](?:id|echo_id|uuid|slug)["']\s*:\s*["']([a-zA-Z0-9\-_]{8,})["']/g,
      )) {
        const id = match[1];
        // Prefer concrete job detail pages when ids look like UUIDs.
        if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            id,
          )
        ) {
          const candidate = normalizeUrl(`/job/${id}`, start.origin);
          if (
            isCrawlable(candidate, start.origin) &&
            enqueue(candidate.href, 1, { urls, queue, visited, queued })
          ) {
            sources.crawl += 1;
          }
        }
      }
    } catch {
      // ignore
    }
  });

  try {
    // First pass: load homepage, wait for SPA, mine JS routes + DOM.
    console.log(`[1] Bootstrapping SPA at ${start.href}`);
    await page.goto(start.href, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settlePage(page);
    await expandMenus(page);

    const assetRoutes = await discoverFromAssets(page, start.origin, [...seenJsResponses]);
    for (const url of assetRoutes) {
      if (enqueue(url, 0, { urls, queue, visited, queued })) sources.assets += 1;
    }

    const homeLinks = await collectDomLinks(page).catch(() => []);
    for (const href of homeLinks) {
      const candidate = normalizeUrl(href, start.href);
      if (!isCrawlable(candidate, start.origin)) continue;
      if (enqueue(candidate.href, 1, { urls, queue, visited, queued })) sources.crawl += 1;
    }
    console.log(
      `Bootstrap found ${assetRoutes.size} asset route(s), ${homeLinks.length} DOM href(s); queue=${queue.length}`,
    );

    while (queue.length && visited.size < MAX_PAGES) {
      const next = queue.shift();
      if (!next || visited.has(next.url)) continue;
      visited.add(next.url);
      queued.delete(next.url);
      urls.add(next.url);

      console.log(`[${visited.size}/${MAX_PAGES}] Scanning ${next.url}`);
      try {
        const response = await page.goto(next.url, {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        });
        const status = response?.status() ?? 0;
        if (status >= 400) {
          console.log(`  HTTP ${status}`);
          continue;
        }

        await settlePage(page);
        if (next.depth === 0 || next.depth === 1) {
          await expandMenus(page);
        }

        // Keep discovering routes from newly loaded chunks on first few pages.
        if (visited.size <= 5) {
          const moreRoutes = await discoverFromAssets(page, start.origin, [...seenJsResponses]);
          for (const url of moreRoutes) {
            if (enqueue(url, next.depth, { urls, queue, visited, queued })) {
              sources.assets += 1;
            }
          }
        }

        if (next.depth >= MAX_DEPTH) continue;

        const hrefs = await collectDomLinks(page).catch(() => []);
        let added = 0;
        for (const href of hrefs) {
          const candidate = normalizeUrl(href, next.url);
          if (!isCrawlable(candidate, start.origin)) continue;
          if (enqueue(candidate.href, next.depth + 1, { urls, queue, visited, queued })) {
            sources.crawl += 1;
            added += 1;
          }
          if (urls.size >= MAX_PAGES) break;
        }
        if (added) console.log(`  +${added} new link(s)`);
      } catch (err) {
        console.log(`  skip: ${err?.message || err}`);
      }
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
    stats: {
      scanned: visited.size,
      fromSeed: sources.seed,
      fromSitemap: sources.sitemap,
      fromAssets: sources.assets,
      fromCrawl: sources.crawl,
    },
    urls: list,
  };

  const savedPath = writeSiteUrls(payload);
  console.log('\nURL list saved');
  console.log(`Count: ${list.length}`);
  console.log(
    `Sources — sitemap: ${sources.sitemap}, assets: ${sources.assets}, crawl: ${sources.crawl}`,
  );
  console.log(`File: ${savedPath}`);
  console.log('Next: run Audit entire site to audit this list one by one.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = path.join(root, 'data');
export const siteUrlsPath = path.join(dataDir, 'site-urls.json');

export function normalizeUrl(href, base) {
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

export function isCrawlable(url, origin) {
  if (!url || url.origin !== origin) return false;
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  const pathName = url.pathname.toLowerCase();
  if (
    /\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|rar|exe|dmg|mp4|mp3|css|js|woff2?|ico|xml|txt|md|json|csv|rss|atom)$/i.test(
      pathName,
    )
  ) {
    return false;
  }
  if (pathName.includes('/wp-admin') || pathName.includes('/cdn-cgi/')) return false;
  return true;
}

export function slugFromUrl(url, index) {
  let pathPart = '/';
  try {
    pathPart = new URL(url).pathname || '/';
  } catch {
    pathPart = String(url);
  }
  const slug =
    pathPart
      .replace(/^\//, '')
      .replace(/\/+/g, '-')
      .replace(/[^a-zA-Z0-9-_]/g, '')
      .slice(0, 60) || 'home';
  return `${String(index + 1).padStart(3, '0')}-${slug}`;
}

export function readSiteUrls() {
  if (!fs.existsSync(siteUrlsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(siteUrlsPath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeSiteUrls(payload) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(siteUrlsPath, JSON.stringify(payload, null, 2), 'utf8');
  return siteUrlsPath;
}

export function getSiteUrlsStatus() {
  const data = readSiteUrls();
  if (!data?.urls?.length) {
    return {
      available: false,
      count: 0,
      website: null,
      path: '/data/site-urls.json',
      discoveredAt: null,
    };
  }
  return {
    available: true,
    count: data.urls.length,
    website: data.website || null,
    path: '/data/site-urls.json',
    discoveredAt: data.discoveredAt || null,
  };
}

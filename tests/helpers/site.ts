import { expect, type Page, type TestInfo } from '@playwright/test';

export function bugMeta(
  info: TestInfo,
  meta: {
    severity: 'Critical' | 'High' | 'Medium' | 'Low';
    steps: string[];
    expected: string;
  },
) {
  info.annotations.push(
    { type: 'severity', description: meta.severity },
    { type: 'steps', description: meta.steps.join('\n') },
    { type: 'expected', description: meta.expected },
  );
}

export function targetPath() {
  return process.env.PAGE_URL || '/';
}

export async function gotoHome(page: Page) {
  const response = await page.goto(targetPath(), { waitUntil: 'domcontentloaded' });
  return response;
}

export function sameOrigin(href: string, baseURL: string) {
  try {
    const base = new URL(baseURL);
    const next = new URL(href, baseURL);
    return next.origin === base.origin;
  } catch {
    return false;
  }
}

/** Common selectors used to discover features on unknown sites. */
export const SELECTORS = {
  navLinks: 'nav a[href], header a[href], [role="navigation"] a[href]',
  forms: 'form',
  search:
    'input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i]',
  authLinks:
    'a[href*="login" i], a[href*="signin" i], a[href*="sign-in" i], a[href*="account" i], button:has-text("Sign in"), button:has-text("Log in")',
  authForm:
    'form:has(input[type="password"]), input[type="password"]',
  cart:
    'a[href*="cart" i], a[href*="bag" i], button:has-text("Add to cart"), button:has-text("Add to bag"), [data-testid*="cart" i]',
  filters:
    'select, [role="listbox"], button:has-text("Filter"), [aria-label*="filter" i], input[type="checkbox"]',
};

export async function countVisible(page: Page, selector: string) {
  const loc = page.locator(selector);
  const total = await loc.count();
  let visible = 0;
  for (let i = 0; i < Math.min(total, 30); i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) visible++;
  }
  return { total, visible };
}

export async function hasHorizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

export async function collectInternalHrefs(page: Page, baseURL: string, limit = 5) {
  const hrefs = await page.locator(SELECTORS.navLinks).evaluateAll((nodes) =>
    nodes
      .map((n) => (n as HTMLAnchorElement).getAttribute('href') || '')
      .filter(Boolean),
  );

  const unique: string[] = [];
  for (const href of hrefs) {
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    if (!sameOrigin(href, baseURL)) continue;
    const abs = new URL(href, baseURL).pathname + new URL(href, baseURL).search;
    if (!unique.includes(abs)) unique.push(abs);
    if (unique.length >= limit) break;
  }
  return unique;
}

export { expect };

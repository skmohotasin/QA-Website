import { test, expect } from '../fixtures';
import {
  bugMeta,
  collectInternalHrefs,
  countVisible,
  gotoHome,
  SELECTORS,
} from '../helpers/site';

const baseURL = process.env.BASE_URL || 'https://example.com';

test.describe('Functional — navigation', () => {
  test('primary navigation links open without server errors', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'High',
      steps: [
        '1. Open the website homepage.',
        '2. Collect visible navigation links.',
        '3. Open each internal link and check the response.',
      ],
      expected: 'Navigation links open pages that respond successfully (no 5xx errors).',
    });

    await gotoHome(page);
    const paths = await collectInternalHrefs(page, baseURL, 5);
    test.skip(paths.length === 0, 'No internal navigation links found on this site');

    const failures: string[] = [];
    for (const path of paths) {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (status >= 500) failures.push(`${path} → HTTP ${status}`);
    }

    expect(failures, failures.join('\n') || 'nav ok').toEqual([]);
  });
});

test.describe('Functional — forms', () => {
  test('forms are present and usable when the site has forms', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'High',
      steps: [
        '1. Open the homepage.',
        '2. Look for HTML forms.',
        '3. Confirm each visible form has fields and a submit control.',
      ],
      expected: 'Visible forms include at least one input and a submit button/input.',
    });

    await gotoHome(page);
    const forms = page.locator(SELECTORS.forms);
    const count = await forms.count();
    test.skip(count === 0, 'No forms found on the homepage');

    let checked = 0;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const form = forms.nth(i);
      if (!(await form.isVisible().catch(() => false))) continue;
      const fields = form.locator('input, textarea, select');
      const submit = form.locator(
        'button[type="submit"], input[type="submit"], button:not([type]), button[type="button"]',
      );
      await expect(fields.first(), `form ${i + 1} should have a field`).toBeVisible();
      const submitCount = await submit.count();
      expect(submitCount, `form ${i + 1} should have a submit control`).toBeGreaterThan(0);
      checked++;
    }

    test.skip(checked === 0, 'Forms exist in DOM but none are visible');
  });
});

test.describe('Functional — search', () => {
  test('search field accepts input when search exists', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'Medium',
      steps: [
        '1. Open the homepage.',
        '2. Find a search field.',
        '3. Type a sample query and confirm the field accepts it.',
      ],
      expected: 'Search input is visible and accepts typed text.',
    });

    await gotoHome(page);
    const search = page.locator(SELECTORS.search).first();
    const visible = await search.isVisible().catch(() => false);
    test.skip(!visible, 'No search field found on this site');

    await search.click({ force: true }).catch(async () => search.focus());
    await search.fill('qa test query');
    await expect(search).toHaveValue(/qa test query/i);
  });
});

test.describe('Functional — auth', () => {
  test('login / account entry point is available when offered', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'High',
      steps: [
        '1. Open the homepage.',
        '2. Look for Sign in / Login / Account links or a password form.',
        '3. Open the auth entry point and confirm it loads.',
      ],
      expected: 'Auth entry point opens a page with a login form or password field.',
    });

    await gotoHome(page);
    const authLink = page.locator(SELECTORS.authLinks).first();
    const passwordOnHome = await page.locator(SELECTORS.authForm).first().isVisible().catch(() => false);

    if (passwordOnHome) {
      await expect(page.locator('input[type="password"]').first()).toBeVisible();
      return;
    }

    const hasLink = await authLink.isVisible().catch(() => false);
    test.skip(!hasLink, 'No login/account entry point found on this site');

    await authLink.click();
    await page.waitForLoadState('domcontentloaded');
    const authUi = page.locator(
      'input[type="password"], input[type="email"], input[name*="user" i], input[name*="email" i]',
    );
    await expect(
      authUi.first(),
      'Auth page should show a login-related field',
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Functional — cart / checkout signals', () => {
  test('cart or add-to-cart controls exist on commerce sites', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'High',
      steps: [
        '1. Open the homepage.',
        '2. Look for cart / bag / add-to-cart controls.',
        '3. Confirm at least one commerce control is visible.',
      ],
      expected: 'Commerce sites expose a cart or add-to-cart control.',
    });

    await gotoHome(page);
    const { visible } = await countVisible(page, SELECTORS.cart);
    test.skip(visible === 0, 'No cart/checkout controls found (site may not be commerce)');
    expect(visible).toBeGreaterThan(0);
  });
});

test.describe('Functional — filters', () => {
  test('filter controls are interactive when present', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'Medium',
      steps: [
        '1. Open the homepage.',
        '2. Look for filter/select/checkbox controls.',
        '3. Confirm a visible filter control is enabled.',
      ],
      expected: 'Filter controls that exist are visible and enabled.',
    });

    await gotoHome(page);
    const filters = page.locator(SELECTORS.filters);
    const count = await filters.count();
    test.skip(count === 0, 'No filter controls found on this site');

    let enabledVisible = 0;
    for (let i = 0; i < Math.min(count, 20); i++) {
      const item = filters.nth(i);
      if (!(await item.isVisible().catch(() => false))) continue;
      if (await item.isEnabled().catch(() => false)) enabledVisible++;
    }

    test.skip(enabledVisible === 0, 'Filter nodes exist but none are visible/enabled');
    expect(enabledVisible).toBeGreaterThan(0);
  });
});

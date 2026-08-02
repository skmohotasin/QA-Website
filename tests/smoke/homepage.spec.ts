import { test, expect } from '../fixtures';
import { bugMeta } from '../helpers/site';

function targetUrl() {
  return process.env.PAGE_URL || '/';
}

test.describe('Smoke — page', () => {
  test('loads and returns a successful response', async ({ page }, info) => {
    const target = targetUrl();
    bugMeta(info, {
      severity: 'Critical',
      steps: [
        `1. Open ${target}.`,
        '2. Wait for the page response.',
        '3. Confirm the page title is present.',
      ],
      expected: 'Page loads with a successful HTTP response and a page title.',
    });

    const response = await page.goto(target);
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/.+/);
  });

  test('has a visible main landmark or body content', async ({ page }, info) => {
    const target = targetUrl();
    bugMeta(info, {
      severity: 'High',
      steps: [
        `1. Open ${target}.`,
        '2. Look for main content on the page.',
      ],
      expected: 'Main page content is visible to the user.',
    });

    await page.goto(target);
    const main = page.locator('main, [role="main"], body');
    await expect(main.first()).toBeVisible();
  });
});

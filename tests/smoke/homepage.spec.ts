import { test, expect } from '../fixtures';
import { bugMeta } from '../helpers/site';

test.describe('Smoke — homepage', () => {
  test('loads and returns a successful response', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'Critical',
      steps: [
        '1. Open the website homepage.',
        '2. Wait for the page response.',
        '3. Confirm the page title is present.',
      ],
      expected: 'Homepage loads with a successful HTTP response and a page title.',
    });

    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/.+/);
  });

  test('has a visible main landmark or body content', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'High',
      steps: [
        '1. Open the website homepage.',
        '2. Look for main content on the page.',
      ],
      expected: 'Main page content is visible to the user.',
    });

    await page.goto('/');
    const main = page.locator('main, [role="main"], body');
    await expect(main.first()).toBeVisible();
  });
});

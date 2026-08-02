import { test, expect } from '../fixtures';

test.describe('Smoke — homepage', () => {
  test('loads and returns a successful response', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveTitle(/.+/);
  });

  test('has a visible main landmark or body content', async ({ page }) => {
    await page.goto('/');
    const main = page.locator('main, [role="main"], body');
    await expect(main.first()).toBeVisible();
  });
});

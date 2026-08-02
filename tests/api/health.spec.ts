import { test, expect } from '@playwright/test';

test.describe('API / network smoke', () => {
  test('base URL responds with HTTP 2xx', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(400);
  });
});

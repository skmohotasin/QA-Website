import { test, expect } from '@playwright/test';
import { bugMeta } from '../helpers/site';

test.describe('API / network smoke', () => {
  test('base URL responds with HTTP 2xx', async ({ request }, info) => {
    bugMeta(info, {
      severity: 'Critical',
      steps: [
        '1. Send an HTTP GET request to the website base URL.',
        '2. Read the response status code.',
      ],
      expected: 'Server responds with HTTP status 200–399.',
    });

    const response = await request.get('/');
    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(400);
  });
});

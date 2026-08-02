import { test, expect } from '../fixtures';

test.describe('Accessibility', () => {
  test('homepage has no critical axe violations', async ({ page, makeAxeBuilder }) => {
    await page.goto('/');

    const results = await makeAxeBuilder()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    expect(
      critical,
      critical.map((v) => `${v.id}: ${v.help}`).join('\n') || 'no critical issues',
    ).toEqual([]);
  });
});

import { test, expect } from '../fixtures';
import { bugMeta } from '../helpers/site';

test.describe('Accessibility', () => {
  test('homepage has no critical axe violations', async ({ page, makeAxeBuilder }, info) => {
    bugMeta(info, {
      severity: 'High',
      steps: [
        '1. Open the homepage.',
        '2. Run an automated accessibility scan (WCAG 2 A/AA).',
        '3. Review critical and serious findings.',
      ],
      expected: 'No critical or serious accessibility violations on the homepage.',
    });

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

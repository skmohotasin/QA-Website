import { test, expect } from '../fixtures';
import { bugMeta, gotoHome, hasHorizontalOverflow } from '../helpers/site';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
];

test.describe('UI/UX — responsiveness', () => {
  for (const vp of VIEWPORTS) {
    test(`layout is usable on ${vp.name} (${vp.width}px)`, async ({ page }, info) => {
      bugMeta(info, {
        severity: 'High',
        steps: [
          `1. Open the homepage at ${vp.width}�-${vp.height} (${vp.name}).`,
          '2. Confirm main content is visible.',
          '3. Confirm the page does not require horizontal scrolling.',
        ],
        expected: 'Content is visible and there is no horizontal page overflow.',
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await gotoHome(page);
      await expect(page.locator('body')).toBeVisible();
      const overflow = await hasHorizontalOverflow(page);
      expect(overflow, `Horizontal overflow detected on ${vp.name}`).toBe(false);
    });
  }
});

test.describe('UI/UX — layout basics', () => {
  test('clickable controls are large enough to tap on mobile', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'Medium',
      steps: [
        '1. Open the homepage on a mobile viewport.',
        '2. Measure visible buttons and links.',
        '3. Flag button controls smaller than 24x24 CSS pixels.',
      ],
      expected: 'Buttons and form controls are at least 24x24px (basic touch usability).',
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHome(page);

    const small = await page.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll(
          'button, [role="button"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]',
        ),
      ] as HTMLElement[];
      const bad: string[] = [];
      for (const el of nodes.slice(0, 80)) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.width < 24 || rect.height < 24) {
          const label =
            el.getAttribute('aria-label') ||
            el.textContent?.trim().slice(0, 40) ||
            el.tagName.toLowerCase();
          bad.push(`${label} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
        }
      }
      return bad.slice(0, 8);
    });

    expect(
      small,
      small.length
        ? `Small controls found:\n${small.join('\n')}`
        : 'tap targets ok',
    ).toEqual([]);
  });

  test('images that convey meaning expose alternative text', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'Medium',
      steps: [
        '1. Open the homepage.',
        '2. Inspect <img> elements.',
        '3. Ensure non-decorative images have alt text.',
      ],
      expected: 'Content images include an alt attribute (decorative images may use alt="").',
    });

    await gotoHome(page);
    const missing = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('img')];
      return imgs
        .filter((img) => !img.hasAttribute('alt'))
        .slice(0, 8)
        .map((img) => img.getAttribute('src') || '[no src]');
    });

    test.skip(missing.length === 0 && (await page.locator('img').count()) === 0, 'No images on page');
    expect(missing, missing.join('\n') || 'alts ok').toEqual([]);
  });

  test('text content does not overflow its viewport width', async ({ page }, info) => {
    bugMeta(info, {
      severity: 'Medium',
      steps: [
        '1. Open the homepage on mobile width.',
        '2. Check for elements wider than the viewport.',
      ],
      expected: 'No element is substantially wider than the viewport.',
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await gotoHome(page);

    const wide = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const all = [...document.body.querySelectorAll('*')] as HTMLElement[];
      const offenders: string[] = [];
      for (const el of all.slice(0, 300)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > vw + 8) {
          offenders.push(
            `${el.tagName.toLowerCase()}.${el.className?.toString?.().slice?.(0, 40) || ''} (${Math.round(rect.width)}px)`,
          );
        }
        if (offenders.length >= 5) break;
      }
      return offenders;
    });

    expect(wide, wide.join('\n') || 'width ok').toEqual([]);
  });
});

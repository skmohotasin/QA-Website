import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type Fixtures = {
  makeAxeBuilder: () => AxeBuilder;
};

/**
 * Extended test fixture with accessibility scanning helpers.
 */
export const test = base.extend<Fixtures>({
  makeAxeBuilder: async ({ page }, use) => {
    await use(() => new AxeBuilder({ page }));
  },
});

export { expect };

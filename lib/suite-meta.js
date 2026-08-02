/** Shared suite labels + short descriptions for UI and reports. */
export const SUITE_META = {
  smoke: {
    label: 'Smoke',
    description: 'Page load & content — confirms visitors can open pages and see content.',
  },
  functional: {
    label: 'Functional',
    description:
      'Forms, auth, nav, search, cart, filters — checks key interactive features work when present.',
  },
  uiux: {
    label: 'UI / UX',
    description:
      'Responsive layout + accessibility — checks usable layout across screen sizes and basic UX.',
  },
  a11y: {
    label: 'A11y',
    description:
      'axe WCAG critical / serious — finds serious accessibility barriers that block users.',
  },
  api: {
    label: 'API / Network',
    description: 'HTTP health check — confirms the site responds with a healthy status code.',
  },
  regression: {
    label: 'Regression',
    description: 'Full retest of all key suites — re-checks smoke, functional, UI, a11y, and API.',
  },
  lighthouse: {
    label: 'Lighthouse',
    description:
      'Performance, SEO, a11y, best practices — scores how well the page loads and follows web quality rules.',
  },
  'site-audit': {
    label: 'Audit entire site',
    description:
      'HTTP, a11y & mobile overflow — page-by-page health, accessibility, and mobile layout checks.',
  },
  all: {
    label: 'All suites',
    description: 'Everything on Chromium — runs the full automated Playwright suite set.',
  },
  headed: {
    label: 'All (headed)',
    description: 'Watch the browser run — same full suite set with a visible browser window.',
  },
  browsers: {
    label: 'All browsers',
    description: 'All engines + mobile — runs checks across Chromium, Firefox, WebKit, and mobile.',
  },
  'discover-urls': {
    label: 'Find all URLs',
    description: 'Crawl the site and save a URL list for full-site testing.',
  },
};

export function getSuiteMeta(suiteKey) {
  const key = String(suiteKey || '').toLowerCase();
  return (
    SUITE_META[key] || {
      label: suiteKey || 'QA checks',
      description: 'Automated quality checks for your website.',
    }
  );
}

# QA Website

Automated website QA with **Playwright** (E2E, API smoke, accessibility).

## Setup

```bash
npm install
npx playwright install
cp .env.example .env
```

Edit `.env` and set `BASE_URL` to the site you want to test.

## Web console

```bash
npm start
```

Open **http://localhost:4173**

Start the console from a **VS Code / Cursor terminal** (or Terminal → Run Task → **QA Website: Start console**). Closing that terminal or VS Code stops the server. If a leftover process remains, run:

```bash
npm run stop
```

1. If browsers are missing, click **Install browsers** (downloads into `.playwright/`, gitignored).
2. Paste a website URL and click **Save URL**.
3. Click **Find all URLs** to crawl the site (and sitemap) and save `data/site-urls.json`.
4. Click **Audit entire site** to audit that saved list one URL at a time (per-URL report + cache clear between pages).
5. Click **Smoke** to run smoke checks on every saved URL one by one, then download one combined Summary + Full report.
6. Run other suites (Functional, A11y, API, etc.) as needed. Live output streams on the page.
7. Use **Lighthouse** separately for Performance / SEO / Best Practices / Accessibility scores.

Client reports are written to `reports/client-report.html` and `reports/client-report.md`.  
Lighthouse reports: `reports/lighthouse-summary.html` (simple) and `reports/lighthouse-full.html` (full detail).  
Site audit reports: `reports/site-audit-summary.html` / `.md`, `reports/site-audit-full.html` / `.md`, and per-URL files under `reports/pages/`.

## Run tests (CLI)

| Command | What it does |
|---------|----------------|
| `npm start` | Open the web console |
| `npm test` | Run all tests (Chromium, Firefox, WebKit, mobile) |
| `npm run test:chromium` | Chromium only (faster local loop) |
| `npm run test:ui` | Interactive Playwright UI |
| `npm run test:headed` | See the browser |
| `npm run test:debug` | Step-through debug |
| `npm run test:lighthouse` | Lighthouse scores for `BASE_URL` |
| `npm run test:discover-urls` | Deep crawl with 10 parallel workers → `data/site-urls.json` |
| `npm run test:site-audit` | Audit saved URL list one by one |
| `npm run test:codegen` | Record flows into tests |
| `npm run test:report` | Open the last HTML report |

## Project layout

```
tests/
  smoke/          # Critical path / homepage checks
  functional/     # Forms, auth, nav, search, cart, filters
  ui/             # Responsive + layout UX checks
  a11y/           # axe-core accessibility scans
  api/            # HTTP / API smoke checks
  helpers/        # Shared probes + bug metadata
  fixtures.ts     # Shared Playwright fixtures
reporters/client-report.mjs   # Client report + bug tickets
scripts/discover-urls.mjs     # Find all site URLs → JSON
scripts/audit-site.mjs        # Audit saved URL list one by one
scripts/run-lighthouse.mjs    # Lighthouse runner
playwright.config.ts
.github/workflows/playwright.yml
```

## Pointing at your site

1. Set `BASE_URL` in `.env` (local) or a GitHub Actions variable named `BASE_URL` (CI).
2. Replace/add specs under `tests/` for your real flows (login, checkout, etc.).
3. Use `npm run test:codegen` against your URL to record new tests quickly.

## Manual vs automated

You handle exploratory / judgment-heavy manual QA. This repo covers regression automation you can run locally or in CI.

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

1. If browsers are missing, click **Install browsers** (downloads into `.playwright/`, gitignored).
2. Paste a website URL and save it.
3. Run a suite (Smoke, A11y, API, etc.). Live output streams on the page.
4. Open the **Client report** (HTML) or download **Markdown** to send to your client.
5. Use **Lighthouse** separately for Performance / SEO / Best Practices / Accessibility scores.

Client reports are written to `reports/client-report.html` and `reports/client-report.md`.  
Lighthouse reports: `reports/lighthouse-summary.html` (simple) and `reports/lighthouse-full.html` (full detail).

## Run tests (CLI)

| Command | What it does |
|---------|----------------|
| `npm start` | Open the web console |
| `npm test` | Run all tests (Chromium, Firefox, WebKit, mobile) |
| `npm run test:chromium` | Chromium only (faster local loop) |
| `npm run test:ui` | Interactive Playwright UI |
| `npm run test:headed` | See the browser |
| `npm run test:debug` | Step-through debug |
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
playwright.config.ts
.github/workflows/playwright.yml
```

## Pointing at your site

1. Set `BASE_URL` in `.env` (local) or a GitHub Actions variable named `BASE_URL` (CI).
2. Replace/add specs under `tests/` for your real flows (login, checkout, etc.).
3. Use `npm run test:codegen` against your URL to record new tests quickly.

## Manual vs automated

You handle exploratory / judgment-heavy manual QA. This repo covers regression automation you can run locally or in CI.

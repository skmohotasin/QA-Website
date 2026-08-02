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

Open **http://localhost:4173** — paste a website URL, then click a suite button (Smoke, Accessibility, API, All, Headed, All browsers). Live output streams in the page.

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
  a11y/           # axe-core accessibility scans
  api/            # HTTP / API smoke checks
  fixtures.ts     # Shared Playwright fixtures
playwright.config.ts
.github/workflows/playwright.yml   # CI on push/PR
```

## Pointing at your site

1. Set `BASE_URL` in `.env` (local) or a GitHub Actions variable named `BASE_URL` (CI).
2. Replace/add specs under `tests/` for your real flows (login, checkout, etc.).
3. Use `npm run test:codegen` against your URL to record new tests quickly.

## Manual vs automated

You handle exploratory / judgment-heavy manual QA. This repo covers regression automation you can run locally or in CI.

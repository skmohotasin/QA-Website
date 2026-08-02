# QA Website

Local QA console for any website. Run **Playwright** suites, **Lighthouse**, and full-site audits from a browser UI — or from the CLI.

Open **http://localhost:4173** after `npm start`.

## Features

- **Web console** — paste a URL, run suites, stream live logs, download reports
- **Scope** — **Current URL** or **All URLs** (after discovering the site map)
- **Find all URLs** — crawls links, sitemap, and SPA routes → `data/site-urls.json`
- **Suites** — Smoke, Functional, UI/UX, A11y, API, Regression, All suites / browsers
- **Lighthouse** — Performance, SEO, Accessibility, Best Practices (one page or every discovered URL)
- **Audit entire site** — HTTP, a11y, and mobile overflow checks page by page
- **Reports** — Summary (overview) + Full (details), plus bug tickets when checks fail

## Setup

```bash
npm install
npx playwright install
cp .env.example .env
```

Set `BASE_URL` in `.env` to the site under test.

Browsers can also be installed from the console (**Install browsers** → downloads into `.playwright/`, gitignored).

## Web console

```bash
npm start
```

Open **http://localhost:4173**.

Start from a **VS Code / Cursor terminal** (or **Terminal → Run Task → QA Website: Start console**). Closing that terminal stops the server. To clear a leftover process:

```bash
npm run stop
```

### Typical workflow

1. Paste a website URL → **Save URL**
2. **Find all URLs** (optional) — builds the list for full-site runs
3. Choose **Current URL** or **All URLs**
4. Run a suite (**Smoke**, **Lighthouse**, **Audit entire site**, etc.)
5. Download **Summary** / **Full** reports when finished

### Reports on disk

| Kind | Files |
|------|--------|
| Client suites | `reports/client-report.html` / `.md`, `reports/client-report-full.*`, bug tickets |
| Lighthouse | `reports/lighthouse-summary.*`, `reports/lighthouse-full.*`, per-page under `reports/lighthouse-pages/` |
| Site audit | `reports/site-audit-summary.*`, `reports/site-audit-full.*`, per-URL under `reports/pages/` |

## Run tests (CLI)

| Command | What it does |
|---------|----------------|
| `npm start` | Web console on port 4173 |
| `npm run stop` | Stop a leftover console server |
| `npm test` | All Playwright projects (Chromium, Firefox, WebKit, mobile) |
| `npm run test:chromium` | Chromium only |
| `npm run test:ui` | Interactive Playwright UI |
| `npm run test:headed` | Visible browser |
| `npm run test:debug` | Step-through debug |
| `npm run test:lighthouse` | Lighthouse for `BASE_URL` (or all URLs when `SITE_RUN_SCOPE=all`) |
| `npm run test:discover-urls` | Crawl site → `data/site-urls.json` |
| `npm run test:site-audit` | Audit the saved URL list |
| `npm run test:smoke-all` | Smoke on every saved URL |
| `npm run test:codegen` | Record flows into tests |
| `npm run test:report` | Open the last Playwright HTML report |

## Project layout

```
public/                 # Console UI
server/                 # Local console API
tests/
  smoke/                # Page load & content
  functional/           # Forms, auth, nav, search, cart, filters
  ui/                   # Responsive + layout UX
  a11y/                 # axe-core accessibility
  api/                  # HTTP / API smoke
  helpers/              # Shared probes + bug metadata
lib/                    # Shared helpers (URLs, browsers, suite meta)
scripts/
  discover-urls.mjs     # Find all site URLs
  audit-site.mjs        # Full-site audit
  run-lighthouse.mjs    # Lighthouse (current or all URLs)
  run-multi-url-suite.mjs
  stop-server.mjs
reporters/client-report.mjs
playwright.config.ts
.github/workflows/playwright.yml
```

## Pointing at your site

1. Set `BASE_URL` in `.env` (local) or a GitHub Actions variable named `BASE_URL` (CI).
2. Add or replace specs under `tests/` for real flows (login, checkout, etc.).
3. Use `npm run test:codegen` against your URL to record new tests quickly.

## Manual vs automated

Exploratory and judgment-heavy checks stay manual. This repo covers repeatable regression automation you can run locally or in CI.

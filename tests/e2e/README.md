# Playwright e2e suite

End-to-end tests for the Open Finance Data Sandbox, run against a local
`python3 -m http.server` of the `src/` tree. The webServer is wired by
`playwright.config.mjs` and shared across all projects.

## Projects

| Project             | Browser           | Viewport                | Runs                          |
|---------------------|-------------------|-------------------------|-------------------------------|
| `chromium-desktop`  | Chromium          | 1280×800                | All non-visual specs          |
| `firefox-desktop`   | Firefox           | 1280×800                | All non-visual specs          |
| `webkit-desktop`    | WebKit            | 1280×800                | All non-visual specs          |
| `mobile-chrome`     | Chromium (Pixel 7)| Pixel 7 emulation       | All non-visual specs          |
| `mobile-webkit`     | WebKit (iPhone 14)| iPhone 14 emulation     | All non-visual specs          |
| `visual`            | Chromium          | 1280×800 (DSR=1)        | `visual.spec.mjs` only        |

`testIgnore` keeps the visual file out of the cross-browser fan-out — visual
baselines are pinned to a single renderer to keep maintenance sane. Mobile
projects exist to catch viewport-locked-layout regressions (EXP-23 + EXP-24).

## Run locally

```sh
# All projects (visual will fail on macOS/Windows — see baselines section)
npm run test:e2e

# Just one project
npm run test:e2e -- --project=chromium-desktop
npm run test:e2e -- --project=firefox-desktop
npm run test:e2e -- --project=webkit-desktop
npm run test:e2e -- --project=mobile-chrome
npm run test:e2e -- --project=mobile-webkit

# One test by title
npm run test:e2e -- --project=chromium-desktop -g "field card shows all 9 elements"

# Open the HTML report from the last run
npx playwright show-report
```

Run `npm run build:site` first if you've touched anything in `src/` or `spec/`
that the generator depends on — the sandbox needs `dist/SPEC.json` +
`dist/data.json` to render the persona library.

## Visual baselines

Baselines for the `visual` project are stored at
`tests/e2e/visual.spec.mjs-snapshots/<name>-visual-linux.png` and are committed
to git. Because Playwright fingerprints font / antialiasing per platform,
**baselines render differently on macOS, Linux, and Windows**. The repo's
baselines are Linux-only (CI parity).

Running `--project=visual` on macOS or Windows will surface mismatches that are
not real regressions — skip the project on those platforms during normal e2e:

```sh
# macOS/Windows: just run the cross-browser projects
npm run test:e2e -- --project=chromium-desktop --project=firefox-desktop \
  --project=webkit-desktop --project=mobile-chrome --project=mobile-webkit
```

### Regenerating baselines

Use the **`e2e-update-baselines`** GitHub Actions workflow (manual dispatch).
It runs `--project=visual --update-snapshots` on Linux and opens a PR with the
refreshed PNGs. This is the only sanctioned way to refresh baselines — running
`--update-snapshots` on macOS or Windows would commit non-CI-parity images.

Volatile elements (spec SHA pin, generated seed labels) are masked via the
`mask:` option, so legitimately re-pinning the spec SHA does not churn
baselines. Add a `data-volatile` attribute to new dynamic elements (timestamps,
randomised IDs) to opt them into the mask.

## Console-error catcher

Every test fails if the page emits any `console.error` or `pageerror` during
its run. The catcher is installed by the shared `_fixtures.mjs` test fixture,
so individual specs no longer need to wire `page.on('console', …)` themselves.

Tests that intentionally surface benign errors (e.g. analytics stub timing in
`analytics.spec.mjs`) opt out with:

```js
test.use({ allowConsoleErrors: true });
```

## Helpers

Defined in `_fixtures.mjs`:

| Helper                                | Use                                                     |
|---------------------------------------|---------------------------------------------------------|
| `loadPersona(page, opts)`             | `goto + waitForFunction('coverage-pct')` + optional endpoint click. |
| `disableAnimations(page)`             | Inject CSS that zeroes animation / transition durations. Used by visual specs and any flaky animation-sensitive test. |

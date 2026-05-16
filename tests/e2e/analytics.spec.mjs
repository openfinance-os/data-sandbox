// EXP-21 / EXP-22 e2e contract for the PostHog wire-up. Covers the
// invariants the unit-level allowlist test (tests/analytics-allowlist.test.mjs)
// can't reach: lazy-load timing, cookie / localStorage absence, and
// the actual capture() payload shape after a real user gesture.
//
// Strategy: addInitScript sets window.__POSTHOG_KEY__ + a known
// __POSTHOG_SDK_URL__, then page.route() intercepts the dynamic import
// of that SDK URL with a thin in-test module that records every
// capture() call onto `window.__phStub`. Tests assert against that
// record. This is strictly more rigorous than hitting the real PostHog
// CDN: flaky-CI-free, no real PostHog project polluted with test
// events, and the exact capture-payload shape is observable.
//
// PR 7 self-hosts the SDK (tools/stage-site.mjs vendors
// _site/src/vendor/posthog-js-<sha>.js) so production traffic never
// touches unpkg either — but the e2e harness runs against the
// non-staged tree where vendor/ doesn't exist, so the route-fulfill
// is what supplies the module body.

import { test, expect } from './_fixtures.mjs';

const FAKE_KEY = 'phc_e2e_test_stub_key';
// Distinctive path the e2e harness routes; matches the production
// shape (vendor/posthog-js-*.js) so the test exercises the same
// load codepath staged builds use.
// Leading `./` is load-bearing — see analytics.js / stage-site.mjs
// note. Browsers reject bare-relative module specifiers in import().
const SDK_URL_TEST = './vendor/posthog-js-e2etest.js';
const SDK_URL_PATTERN = '**/vendor/posthog-js-*.js';

// Minimal ESM stub matching the surface src/analytics.js calls into.
// Records init options + every capture() call onto window.__phStub so
// tests can introspect.
const STUB_MODULE = `
const posthog = {
  init(key, opts) {
    window.__phStub = {
      key,
      opts,
      captures: [],
      distinctID: opts && opts.bootstrap ? opts.bootstrap.distinctID : null,
    };
  },
  capture(name, props) {
    if (window.__phStub) window.__phStub.captures.push({ name, props });
  },
};
export default posthog;
`;

async function configurePosthogStub(page, { withKey = true } = {}) {
  if (withKey) {
    await page.addInitScript(
      ({ key, sdkUrl }) => {
        // eslint-disable-next-line no-undef
        window.__POSTHOG_KEY__ = key;
        // eslint-disable-next-line no-undef
        window.__POSTHOG_SDK_URL__ = sdkUrl;
      },
      { key: FAKE_KEY, sdkUrl: SDK_URL_TEST },
    );
  }
  // Intercept the dynamic import of the self-hosted SDK and return our
  // stub. The glob matches the production filename shape
  // (vendor/posthog-js-<sha>.js) so the test routes whatever URL the
  // analytics module ends up requesting.
  await page.route(SDK_URL_PATTERN, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: STUB_MODULE,
    }),
  );
  // Track every PostHog ingest request so tests can assert "no requests
  // before first gesture" — capture() in the real SDK posts to /e/.
  const ingestRequests = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/(?:^|\.)posthog\.com\//i.test(url) || /\/i\.posthog\.com\//i.test(url)) {
      ingestRequests.push({ url, postData: req.postData() });
    }
  });
  return { ingestRequests };
}

test.describe('EXP-21 / EXP-22 analytics wire-up', () => {
  // The stubbed SDK path can race with the analytics module's import() at
  // page-load — the resulting console output is benign for these tests,
  // whose contract is the captured `__phStub` state, not console hygiene.
  // Smoke tests still enforce zero console errors against the real codepath.
  test.use({ allowConsoleErrors: true });

  test('no PostHog requests fire when POSTHOG_KEY is unset (PR 3 default)', async ({ page }) => {
    const { ingestRequests } = await configurePosthogStub(page, { withKey: false });
    // PR-13 — use query params so PR #2's cold-landing tour auto-launch
    // doesn't cover the navigator and block subsequent clicks.
    await page.goto('/src/index.html?persona=salaried_expat_mid&lfi=median&seed=4729');
    await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
    // Click around — without a key the SDK never loads, so still nothing
    // hits the wire.
    await page.locator('.nav-endpoint', { hasText: '/transactions' }).first().click();
    await page.locator('.field-name', { hasText: 'TransactionId' }).first().click();
    expect(ingestRequests).toEqual([]);
    // No window.__phStub either — init was never called.
    const stubExists = await page.evaluate(() => typeof window.__phStub !== 'undefined');
    expect(stubExists).toBe(false);
  });

  test('SDK init runs with strict EXP-21 / EXP-22 options after first track()', async ({ page }) => {
    await configurePosthogStub(page);
    await page.goto('/src/index.html');
    await page.waitForFunction(() => typeof window.__phStub !== 'undefined');
    const opts = await page.evaluate(() => window.__phStub.opts);
    expect(opts.api_host).toBe('https://us.i.posthog.com');
    expect(opts.autocapture).toBe(false);
    expect(opts.capture_pageview).toBe(false);
    expect(opts.capture_pageleave).toBe(false);
    expect(opts.disable_session_recording).toBe(true);
    expect(opts.disable_surveys).toBe(true);
    expect(opts.persistence).toBe('memory');
    // EXP-22: distinctID is present and looks like an opaque random
    // value, not a fingerprint or PII.
    const distinctID = await page.evaluate(() => window.__phStub.distinctID);
    expect(typeof distinctID).toBe('string');
    expect(distinctID.length).toBeGreaterThanOrEqual(16);
    // Property blacklist covers the auto-properties EXP-21 forbids.
    for (const banned of ['$ip', '$current_url', '$pathname', '$referrer', '$user_agent']) {
      expect(opts.property_blacklist).toContain(banned);
    }
  });

  test('persona_load fires on init with allowlisted props only', async ({ page }) => {
    await configurePosthogStub(page);
    await page.goto('/src/index.html?persona=salaried_expat_mid&lfi=median&seed=4729');
    await page.waitForFunction(() => window.__phStub?.captures?.some((c) => c.name === 'persona_load'));
    const captures = await page.evaluate(() => window.__phStub.captures);
    const personaLoad = captures.find((c) => c.name === 'persona_load');
    expect(personaLoad).toBeTruthy();
    expect(Object.keys(personaLoad.props).sort()).toEqual(['custom', 'domain', 'lfi', 'persona_id'].sort());
    expect(personaLoad.props.persona_id).toBe('salaried_expat_mid');
    expect(personaLoad.props.lfi).toBe('median');
    expect(personaLoad.props.domain).toBe('banking');
    expect(personaLoad.props.custom).toBe(false);
  });

  test('endpoint_nav, field_click, raw_json_toggle, share fire with sanitised props', async ({ page, isMobile }) => {
    // The `#view-raw` / Export controls live in the desktop topbar and
    // are repositioned (or hidden) in the mobile viewport. Analytics prop
    // allowlisting is identical across viewports — the desktop projects
    // give us full coverage; skipping here keeps mobile runs green without
    // weakening the contract.
    test.skip(isMobile, 'view-raw / Export controls not exposed in the mobile-viewport layout');

    await configurePosthogStub(page);
    await page.goto('/src/index.html?persona=salaried_expat_mid&lfi=median&seed=4729');
    await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');

    await page.locator('.nav-endpoint', { hasText: '/transactions' }).first().click();
    await page.locator('.field-name', { hasText: 'TransactionId' }).first().click();
    await page.locator('#view-raw').click();
    // PR-10 removed #share-btn; the 'share' event now fires from the
    // Export popover's Permalink-tab Copy button (default-active tab).
    await page.locator('#export-toggle').click();
    await page.locator('.export-overlay .export-copy-btn', { hasText: 'Copy' }).first().click();

    const captures = await page.evaluate(() => window.__phStub.captures);
    const eventNames = captures.map((c) => c.name);
    expect(eventNames).toContain('endpoint_nav');
    expect(eventNames).toContain('field_click');
    expect(eventNames).toContain('raw_json_toggle');
    expect(eventNames).toContain('share');

    // Allowlisted property keys only — nothing PII-shaped.
    const banned = /(name|email|phone|iban|amount|merchant|address|searchQuery|userInput|ip|url|referrer|query|input|value|text|fullName)/i;
    for (const c of captures) {
      for (const k of Object.keys(c.props ?? {})) {
        expect(banned.test(k), `event ${c.name}: prop '${k}' looks PII-shaped`).toBe(false);
      }
    }
  });

  test('EXP-22 — analytics writes no cookies and no PostHog localStorage keys', async ({ page, context }) => {
    await configurePosthogStub(page);
    await page.goto('/src/index.html?persona=salaried_expat_mid&lfi=median&seed=4729');
    await page.waitForFunction(() => document.getElementById('coverage-pct')?.textContent !== '—');
    await page.locator('.nav-endpoint', { hasText: '/transactions' }).first().click();
    await page.locator('.field-name', { hasText: 'TransactionId' }).first().click();

    const cookies = await context.cookies();
    expect(cookies.filter((c) => /posthog|distinct/i.test(c.name))).toEqual([]);

    const lsKeys = await page.evaluate(() => Object.keys(localStorage));
    expect(lsKeys.filter((k) => /posthog|distinct/i.test(k))).toEqual([]);
  });
});

# App Improvement Plan — post-Phase 2.3 review

**Status:** Proposed · 2026-07-28
**Baseline:** commit `bbf0fb4` (`main`), full `npm run ci` green (3,410 passing, 1 skipped, 1 timeout flake — see T-06)
**Method:** five parallel in-depth reviews — frontend/UX, generator + data pipeline, tests/CI, distribution packages + MCP + examples, docs/roadmap — followed by hand-verification of every P0 claim against HEAD.
**Relationship to other docs:** this plan consolidates and supersedes the open remainders scattered across `IMPLEMENTATION_PLAN.md` (pre-Phase-0 draft), `PHASE2_INSURANCE_PLAN.md` (Phase 2.0–2.1, shipped), and `ENRICHMENT_REALISM_PLAN.md` (R1–R5.1 shipped). The PRD remains the source of truth for product behaviour; this document is an execution plan, not a spec.

---

## 0. Executive summary

The repo is in genuinely good shape: determinism is treated as a first-class invariant with real engineering behind it, the lint suite encodes the load-bearing PRD constraints, the MCP server is well-designed, and the workflow security posture is above average. The review nevertheless found:

- **Three confirmed correctness bugs** (§1), the worst of which makes **all 8 multi-domain personas — including the Phase 2.2 flagship `retail-multi-banker` — invisible in the explorer UI**. The shipped banking tab shows 21 personas, not the 29 the docs claim.
- **A cross-cutting root cause**: the Phase 2.2 data-model migration (`domain:` → `domains: []`, triad footprint → `slots[]`) landed in the generator and fixture builder but **not in ~7 downstream consumers** (explorer, embed, `/connect`, both example demos, the MCP server's `list_personas`, the npm `.d.ts`). §2 fixes this once, centrally.
- **Trust gates that report green while not gating** (§3): the bundle-weight test under-counts the real cold load by 62 KB (the app is actually ~34 KB **over** the EXP-24 budget), visual regression never runs in CI, ~11 suites can silently skip, the analytics allowlist regex misses multi-line `track()` calls, and the PII-leak lint covers one of three domains.
- **A distribution layer that would fail its first real consumer** (§4): no `types` entry in the npm exports map, an 11-function CJS/ESM surface divergence, a Python wheel that can silently ship without its data, no tag↔version gate on the publish workflows — and per the changelog, the packages the README tells people to `npm install` / `pip install` are not actually published.
- **Docs two phases stale** (§7): PRD v0.11 has no Phase 2.2/2.3 rows and still says 27 personas; two decisions the PRD already settled (D-12 canonical slug, `noindex` removal) were never landed in code.

The plan is organised as six tracks (A–F) sequenced into four slices (§8). Track A is a bug-fix slice and should land first, alone, so it can be cherry-picked and released quickly.

---

## 1. Confirmed defects (fix first, ship as one slice)

All three verified by hand against `bbf0fb4`.

### A-1 · Multi-domain personas invisible in the explorer — P0
`src/app.js:543-545` and the identical filter in `switchDomain` (`src/app.js:1587-1589`):

```js
.filter(([, p]) => p.domain === state.domain)
```

Multi-domain personas declare `domains: ['banking','insurance']` and carry no singular `domain`, so `undefined === 'banking'` drops all 8. Banking renders 21/29, insurance 9/17; `retail-multi-banker` is unreachable from the UI. Related variants of the same bug:

- `src/embed.js:42` — `(p.domain ?? 'banking') === domain` misclassifies all 8 as banking-only.
- `src/connect.js:760-763` — `a.domain.localeCompare(...)` throws on `undefined` when `/connect` falls back to `dist/data.json` (the documented `npm run serve` dev path shows "Could not load personas").
- `examples/tpp-budgeting-demo/app.js:93-95` — excludes all 8 multi-domain personas from the picker.
- `examples/accounting-multi-bank-demo/app.js:105,143` — reads only the legacy triad keys, so the N-slot personas (the demo's own flagship use case) render an empty footprint table.
- `packages/sandbox-mcp/src/server.mjs:612-621` — same triad-only walk; `list_personas` reports `multi_lfi_footprint: { roles: [] }` for all 8 N-slot personas while `available_lfi_roles` in the same payload lists their real slots.

**Fix:** one shared `normalizeDomains(p)` (`p.domains ?? [p.domain ?? 'banking']`) in `src/shared/`, plus exporting the existing `normalizeFootprint()` (`src/generator/multi-lfi.js:65`) through the fixture package, and migrating all seven call sites. Add a regression test asserting per-domain persona counts derived from `personas/*.yaml` (29 banking / 17 insurance / 8 multi) against `dist/data.json`, the manifest, and `loadPersonasByDomain`.

### A-2 · Insurance ConsentId is identical across every seed — P0 (EXP-05)
`src/generator/insurance/index.js:131`:

```js
const consentRng = makePrng(persona.persona_id, 'consents', line, seed);
```

`makePrng` (`src/prng.js:36`) takes three parameters; the fourth argument — the actual seed — is silently dropped and `line` lands in the seed slot. ConsentId varies by line but not by seed (verified: seeds 1, 2, 999 produce the same ConsentId with three different PolicyIds). `manifest.fixtures[…].consentIds` therefore collides across seeds.

**Fix:** `makePrng(persona.persona_id, \`consents:${line}\`, seed)`. Guard the class of bug: make `makePrng` throw on arity > 3 (18 call sites, all currently 3-arg). Note this changes generated ConsentIds — a deliberate fixture-corpus change to record in the changelog.

### A-3 · Latent primary-anchor divergence breaks the cross-LFI mirror ledger — P0 (latent)
`src/generator/index.js:305-315` recomputes the primary anchor account by `findIndex` over the **unfiltered** `persona.accounts`, while `src/generator/accounts.js:41-52` computes it over the **primary-slot-filtered** list. They agree only when the account list happens to start with a primary-slot `CurrentAccount` — true for `retail-multi-banker` today by luck. The next `at_slot` persona that orders accounts differently gets ledger outflows carrying an `_accountId` no account matches; `envelopesFromBundle` silently drops them and the accounting demo's reconciliation breaks with no error.

**Fix:** delete the reconstruction; read the anchor from the already-generated `accounts` array in scope at `index.js:328`. Add a corpus-wide assertion that every `tx._accountId` resolves to a real `AccountId` in the same bundle (this permanently catches the whole class, including regressions in A-1's demo).

### A-4 · Locale-dependent sort decides transaction byte order — P1 (EXP-05 hardening)
`src/generator/transactions.js:524-528` uses `String.prototype.localeCompare` — explicitly locale/ICU-dependent — in the only sort in `src/generator/**`, the one that fixes the final byte order of every transaction array. The in-process replay test cannot detect cross-ICU divergence.

**Fix:** ordinal comparison (`a < b ? -1 : a > b ? 1 : 0`), plus an ESLint `no-restricted-syntax` ban on `localeCompare` under `src/generator/`.

### A-5 · Wrong banking spec provenance published everywhere — P1
`tools/domains.config.mjs:19` records `upstreamPath` as `dist/standards/v2.1/…` while the vendored file is `v2.1-errata2`. The wrong string is published into `dist/SPEC.json`, the UI top bar, `/about`, and the fixture manifest — the exact field the next spec bump will be reasoned from.

**Fix:** correct the path; add an assertion in `parse-spec.mjs` that `upstreamPath` contains the parsed `spec.info.version` (insurance and ATM already pass it).

### A-6 · Unknown/partial domain combinations silently degrade — P1
`src/generator/index.js:177-211` (`buildMultiDomainBundle`) and `src/ui/export.js:51-61` handle exactly `banking` + `insurance` by name. A persona declaring `domains: [banking, atm]` or a future `[banking, wealth]` silently produces a banking-only bundle with no error (the unknown-domain guard only fires on the single-domain path).

**Fix:** a `DOMAIN_PIPELINES` registry keyed by domain id; iterate declared domains, throw on any domain absent from the registry.

---

## 2. Track A — Correctness & determinism (slice 1)

| Item | Files | Effort |
|---|---|---|
| A-1 `normalizeDomains` + all 7 consumers + count regression test | `src/shared/`, `src/app.js`, `src/embed.js`, `src/connect.js`, both examples, `packages/sandbox-mcp` | 1 day |
| A-2 ConsentId seed fix + `makePrng` arity guard | `src/generator/insurance/index.js`, `src/prng.js` | 2 h |
| A-3 anchor derivation fix + `_accountId`-resolves corpus test | `src/generator/index.js`, `tests/` | 3 h |
| A-4 ordinal sort + ESLint ban | `src/generator/transactions.js`, `eslint.config.mjs` | 1 h |
| A-5 `upstreamPath` fix + self-check | `tools/domains.config.mjs`, `tools/parse-spec.mjs` | 1 h |
| A-6 `DOMAIN_PIPELINES` registry | `src/generator/index.js`, `src/ui/export.js` | 3 h |

Everything in this track regenerates parts of the fixture corpus (A-2 certainly, A-3 possibly). Land behind a byte-diff of the staged corpus so intended vs. accidental churn is explicit.

---

## 3. Track B — Trust gates: make green mean green (slice 1–2)

The theme: several gates report success without gating. In priority order:

**T-01 · Bundle-weight gate under-counts by 62 KB (EXP-24).** `tests/bundle-weight.test.mjs:80-91` never traverses modules reachable only through the 30 `<link rel="modulepreload">`-seeded entries. Measured: gate sees 221.6 KB gz (passes); the real static graph from `app.js` is 284 KB gz — 34 KB **over** the 250 KB budget. Fix the traversal (enqueue unconditionally, dedupe via `visited`), then recover the budget by lazy-loading the insurance + ATM generator trees (`src/generator/index.js:28-29` drags all 7 insurance lines onto every banking cold landing, ~24 KB gz; the UI renderers are already lazy — the generators should match). Extend the test to per-page budgets for `connect.html` (~77 KB gz today, entirely ungated), `integrate.html`, `embed.html`.

**T-02 · Visual regression never runs.** Six Linux baselines are committed, but the `visual` Playwright project is absent from the CI project list (`.github/workflows/ci.yml:132-138`); the only workflow that runs it does so with `--update-snapshots`, which cannot fail. Add `--project=visual` to CI, delete the stale "until baselines are generated" comment, and add an RTL (`?lang=ar`) baseline — currently nothing checks that the Arabic layout actually mirrors.

**T-03 · Silent skip-gating.** 11 suites `describe.skip` when fixture packages aren't built; a skipped suite is a pass, and nothing asserts skip-count in CI. Add a `CI=true`-gated assertion that `packages/sandbox-fixtures/manifest.json` and `_site/src/index.html` exist. De-hardcode the `sme_rak_trading_emirati|rich|4106` fixture key in `tests/multi-lfi-self-beneficiary.test.mjs:52-55` (a rename silently deletes a Slice-4 invariant assertion today).

**T-04 · `check:dist-clean` ordering bug in CI.** `.github/workflows/ci.yml:60` runs it *before* `build:fixtures:pkgs`, which the tool's own header comment says makes the fixture-package half a no-op. Move the step below the build. While there: reconcile `npm run ci` with the workflow steps (they've drifted; CI adds `stage-site` + spec-conformance validation the local script lacks, so local-green ≠ CI-green).

**T-05 · PII-leak lint is banking-only (invariant 2 — the unrecoverable one).** `tools/lint-pii-leak.mjs:12-14` loads banking personas only; the insurance/ATM audit it claims exists could not be found. Insurance bundles emit policyholder names, addresses, employer names, beneficiary names, and IBANs. Extend the lint with insurance and ATM probe tables. Pair with making `tools/verify-spec-shape.mjs` domain-generic (currently hardcodes the 12 banking paths; insurance's 30 paths and `/atms` have no shape gate).

**T-06 · Vitest hygiene.** Set `testTimeout: 30000` in the root `vitest.config.mjs` (Vitest 4 dropped the default to 5 s; `tests/enrichment.test.mjs` already flakes on slow runners — reproduced during this review). Add `github-actions` reporter for inline annotations. Fix the silent-drop in `tests/rendered-fixture-spec-validation.test.mjs:175,178` (`if (!ref) continue` — a new endpoint gets zero validation with no signal; collect and assert the skip set). Delete the tautological `expect(true).toBe(true)` test at `:220-224`.

**T-07 · Analytics allowlist false negative (EXP-21/22 privacy gate).** The extraction regex in `tests/analytics-allowlist.test.mjs:50` only matches single-line `track()` calls; `src/app.js:626` is already invisible to it. Add a raw `track(`-occurrence parity assertion and an `ALLOWED_PROP_KEYS ∩ BANNED === ∅` check on the allowlist constant itself.

**T-08 · Structural lint additions** (cheaper than the bugs they prevent): (a) assert every `_`-prefixed generator key is in `RECORD_LEVEL_METADATA_KEEP` or stripped from rendered envelopes; (b) cross-LFI IBAN-identity corpus assertion (beneficiary IBAN ≡ role-bundle account IBAN; every `_crossLfiPairId` has exactly two members, equal amounts, opposite indicators); (c) promote `tools/realism-audit.mjs` into `npm run ci` with the numeric floors from `ENRICHMENT_REALISM_PLAN.md` §Verification (≥12 MCCs, ≥80 merchants, ≥30 narrative shapes — currently nothing prevents realism regression); (d) seed the institution-name denylist in `lint-no-institution-leak.mjs` from the two real-name pool files; (e) convert `personas/_schema.yaml` from "documentation, not enforced" to an AJV-validated schema — the prerequisite for accepting community personas (D-07).

**T-09 · `/connect` test coverage.** The repo's largest frontend surface (3,975 lines JS + 91 KB HTML) has zero tests of any kind. Minimum: an e2e spec walking both journeys with the shared console-error catcher and an axe scan; add `/connect` to `lighthouserc.json`. (Unit coverage arrives with the C-02 decomposition — the extracted pure insight-computation module is directly testable.)

---

## 4. Track C — Frontend: performance, accessibility, UX (slice 2)

### Performance (EXP-24)
- **C-P1** Lazy-load domain generators (with T-01; the single biggest lever, ~24 KB gz off the banking cold path).
- **C-P2** Memoize compare-mode bundles — `src/ui/compare-view.js:22-35` builds 2 extra full bundles on every render (3 generations per interaction on an HNW persona). A 6-entry cache keyed `(persona, lfi, seed)` halves the work.
- **C-P3** Debounce the transactions filter (`src/ui/tx-filter.js:114-119`) — every keystroke tears down and rebuilds the full table and resets the caret to end-of-input (a real typing bug, not just jank).
- **C-P4** Index the cross-link match pass (`src/app.js:2088-2097` is O(visible × transactions) ≈ 600 k `match()` calls per render on `/standing-orders`).
- **C-P5** Memoize `endpointFieldsByName` (rebuilt per hover open); split or slim `dist/SPEC.insurance.json` (715 KB raw, fetched in one stall on domain switch).
- **C-P6** Prune the 30 `modulepreload` tags to the true critical path; consider a `stage-site.mjs`-produced single-file production bundle (no dev build chain needed) — this addresses the root cause behind the Lighthouse budget being walked down 0.90 → 0.60.

### Accessibility (EXP-23 — all invisible to axe, hence currently "passing")
- **C-A1** Persona cards (`src/app.js:940-966`) are click-only `div`s — the app's primary navigation is unreachable by keyboard. The correct pattern already exists in-repo (stress chips, connect's persona radios). Add a Playwright keyboard-nav spec since axe can't catch regressions here.
- **C-A2** Sortable headers: no `scope="col"`, mouse-only sort, no `aria-sort` (`src/app.js:2107-2157`, also compare-view and embed).
- **C-A3** Hover preview violates 1.4.13 (not dismissible, not hoverable, never announced — no `aria-describedby`) (`src/ui/hover-preview.js:16-32`).
- **C-A4** `/connect` wizard steppers are click-only `<li>`s with no `aria-current="step"`.
- **C-A5** Find-box is a listbox without combobox semantics and doesn't restore focus on close.
- **C-A6** Smaller: compare-diff meaning encoded in colour alone (add `≠`/`−` glyphs to match the existing `✚`); "why is this field empty" lives only in `title=` attributes (invisible on touch — mirror into the field card); skip links on all pages; Escape should close the mobile field-detail overlay; sub-meter contrast `#c8862a` → ~`#a86c1e`.
- **C-A7** Extend the axe gate beyond the default landing state: each dialog-open state, compare mode, `/connect`, `/integrate`, and `?lang=ar`.

### UX / structure
- **C-01** Extract `renderPayloadUnsafe` (~400 lines) into `ui/payload-table.js`; extract the four remaining inline renderers. `app.js` lands ~1,900 lines as a pure orchestrator.
- **C-02** Decompose `connect.js` (3,975 lines, zero modules) along its natural seams: `permissions.js`, `state-url.js`, `journey-j1.js`, `journey-j2.js`, `insights.js` (pure functions — the "every figure is computed from real fixture data" claim, currently untestable), `consent-manager.js`, `dashboards.js`. Migrate its divergent `el()` builder to `shared/dom.js`; extract the 62 KB inline stylesheet to `connect.css` and rename the two selectors that collide with `styles.css`.
- **C-03** Deduplicate `rowsFor*` (three verbatim copies with already-diverging row caps) into `shared/bundle-rows.js`; same for `stripInternal` and the four hand-rolled lazy-module wrappers.
- **C-04** Discoverability: promote `/connect` out of the "More ▾" menu (the largest UI in the repo is hidden behind an unlabelled disclosure); make compare mode's dead-end banner actionable (auto-switch to a field-level endpoint or make the banner's endpoint names clickable).
- **C-05** Empty/error states: give the bare "No transactions match" / "No records." / "No policies." states the cause+recovery treatment the PII-only empty state already has; stop rendering `err.stack` into the page (`src/app.js:1910`); fix the row-cap message that points users at uncapped Raw JSON (which will hang the tab on a 2,400-row persona).
- **C-06** Resolve the Service-Worker plug-point status: `src/sw-fixtures.js` is never registered by any code path, yet CLAUDE.md and `/integrate` present it as shipped plug-point #2. Either register behind an opt-in flag or downgrade its documented status.
- **C-07** Fix stale tour copy ("eleven other archetypes" — library is 38) and clear the 7 ESLint unused-var warnings; promote `no-unused-vars` to error for `src/`.
- **C-08** Pin the EXP-22 storage interpretation: `app.js` refuses all storage while `connect.js` uses `sessionStorage` — both citing EXP-22. Decide once, document in CLAUDE.md, align both pages.

---

## 5. Track D — i18n deepening (D-10 completion) (slice 2–3)

Current state: 48 catalog keys, 4 modules wired. Two shipped-Arabic regressions and a clear cost gradient:

1. **Tranche 1 (an afternoon, ~15 keys)** — fixes visible EN/AR mixing in shipped Arabic mode: toolbar controls (`index.html:216-231`), find-box leftovers including the dangling `' · close with '` concatenation, persona-card chrome, and the compare view using the English persona name where `localizedName()` exists but isn't passed (`src/ui/compare-view.js:49`). Wire `embed.js` (3 strings; it already parses `lang`).
2. **Tranche 2 (~23 keys)** — field-card row labels, tx-filter chrome (whose `aria-label`s currently expose raw prop names — also an a11y fix).
3. **Tranche 3 (the CLAUDE.md item)** — field-card explanation corpus: `shared/field-knowledge.js` + the conditional rules in `shared/spec-helpers.js` (~35 strings, several templated → parameterized keys). Leaf modules, mechanically clean; needs a real Arabic translation pass.
4. **Tranche 4** — tour (15 strings; fix the stale count in the same pass) and underwriting panel (~25 strings; the EXP-18 formulas are pinned by PRD §4.4, so the Arabic must be reviewed against the pinned English).
5. **Tranche 5** — number/date formatting: `Intl.DateTimeFormat('en-GB')` and browser-locale `toLocaleString` are hardcoded; thread `state.lang` through (numerals are already handled separately by `localizeDigits`).
6. **Tranche 6 (own slice)** — `/connect` end-to-end (200+ strings, RTL audit of its stylesheet). The consumer-facing page is where Arabic matters most; schedule after C-02 so strings extract into the new modules rather than into the monolith.

Add the missing guard: a test that every `data-i18n` key in HTML exists in `STRINGS` (a missing key currently renders the raw key with no signal).

---

## 6. Track E — Distribution: packages, MCP, examples, releases (slice 2)

**E-01 · npm package TypeScript story — P0.** No `types` field or `types` export condition (`tools/build-fixture-package.mjs:401-455`): under `moduleResolution: node16/bundler`, every TS consumer gets `TS7016` and the 250-line `.d.ts` is dead. The `.d.ts` is also wrong in four places (`Domain` missing `'multi'`; `PersonaInfo` missing `domains`/footprints; `Journey` missing `lfi_role`; CJS's async `loadFixturePage` typed sync). Fix the generator, correct the types, and gate with `tsc --noEmit` over a smoke consumer in CI.

**E-02 · CJS/ESM divergence.** CJS is missing ~11 exports (`buildBundle`, the recipe codec, `envelopesFromBundle`, pagination helpers) hidden behind undocumented async accessors, and its `loadFixturePage` is async where ESM's is sync. Recommendation: drop CJS and ship ESM-only (Node ≥ 20 is already the floor) — simpler than maintaining parity. Also: add `exports` entries for the shipped-but-unreachable `enrichment/`, `brands/`, `brand-registry.json` subpaths, and `./package.json`.

**E-03 · MCP parity with the product — P0 for the public endpoint.** (a) ATM domain: `atm_directory` appears in `list_personas` but every tool rejects it — a session dead-end; add `get_atms`, the `'atm'` enum values, the `inferDomain` branch, and the third spec resource. (b) N-slot footprint bug (fixed by A-1's `normalizeFootprint` export) and the promised-but-never-emitted `multi_insurer_footprint`. (c) Read `PKG_VERSION` from `package.json` instead of the hardcoded `'0.0.1'` (`src/server.mjs:31`) and extend the version-sync test to cover it. (d) Enrich `/health` (`{ ok, version, specSha, personaCount, toolCount }`) so a deploy can be verified; change `smoke.mjs`'s exact tool count to a floor. (e) Non-motor insurance tools or an explicit roadmap note — the per-line claim in the MCP README is currently false. (f) Security for the public Fly endpoint: per-IP rate limit or a concurrent-generation semaphore on `build_persona`; populate `allowedOrigins`; don't apply CORS `*` to the OAuth endpoints. (g) For hosted OAuth teaching demos: `MCP_PUBLIC_URL` issuer override and a stub RFC 7591 `/register` endpoint (Claude.ai and VS Code clients attempt DCR and currently can't complete the flow).

**E-04 · Python package — P0.** Zero Python is executed anywhere in CI, yet the wheel publishes gated on JS tests alone. Two live defects: `setuptools>=61.0` is below the 62.3 floor recursive `data/**/*` globs need (older setuptools → wheel installs then `FileNotFoundError`s on every call), and `load_spec()` can't reach the insurance/ATM specs it ships. The mirror also drops `pools.json`, `enrichment/`, `brands/` — making the enrichment story unimplementable in Python. Add a pytest parity suite (persona set, journey sample, pagination agreement vs npm), wire into `publish-fixtures.yml`'s validate gate and `npm run ci`; add `py.typed`; bump setuptools; mirror the missing data; close the biggest function gaps (`domain` filter, `lfi_role`, spec selection).

**E-05 · Release integrity.** Nothing bumps versions and nothing verifies tag↔version: pushing `fixtures-v0.3.0` with root at `0.0.1` publishes 0.0.1. Add a `verify-tag` job to both publish workflows and a `release:bump` script (root bump → rebuild → sync test). Gate `publish-mcp.yml` on the full `npm run ci` like the fixtures workflow; fix the `latest` docker tag condition (never true on tag pushes) and the misleading `PYPI_TOKEN` comment (Trusted Publishing needs PyPI-side config, not a secret). **Then actually publish** — the README and `/integrate` currently instruct installs that 404.

**E-06 · Examples.** Fix both demos' Phase 2.2 blind spots (covered by A-1); update their stale counts and the D-14 "two allow-sites" claim (now four); make the fallback origin match the actual live deploy or show a visible banner on manifest-fetch failure. Then add the highest-value third example: an **insurance + multi-domain "coverage gap" demo built on the npm package** — closes three gaps at once (zero insurance examples, zero multi-domain examples, zero plug-point-4 examples) and exercises the package the way a TPP would, which would have caught E-01/E-02 before publish.

**E-07 · TPP developer asks** (in demand order): a `validateEnvelope(endpoint, payload)` export reusing the CI AJV setup; an error-response catalogue (every fixture today is a 200 — no consent-revoked/403/429/5xx shapes); `npx … serve` local mock server mounting fixtures at real v2.1 paths; permission-filtered journeys (`loadJourney({ permissions: [...] })` — the taxonomy already exists in `/connect` and the OAuth scopes).

---

## 7. Track F — Docs, spec freshness, governance (slice 3)

**F-01 · PRD v0.12 reconciliation.** Add Phase 2.2/2.3 rows to §11; fix persona counts (27 → 38+1) and D-13's counts (15 personas → 38, 20 tools → 27+, plug-point 4 → 5); amend D-10 (shipped); resolve the D-08 self-contradiction; extend Appendix F with the insurance/multi-domain/ATM stress vocabulary (it's now provably incomplete relative to what `lint-stress-coverage-uniqueness` accepts); update Appendix E.

**F-02 · Close the two already-decided code items.** `src/url.js:24` slug → `/commons/data-sandbox` (D-12 names this exact line) and remove `noindex` from `src/index.html:6` when the Commons publication checklist (PRD §11) is executed — or record a decision explicitly deferring it.

**F-03 · Mark superseded plans.** Banner `IMPLEMENTATION_PLAN.md` (pre-Phase-0 draft with 8 "open" decisions all long-resolved) and `PHASE2_INSURANCE_PLAN.md` (describes an unadopted layout; calls Open Wealth "Phase 2.2"; asserts a spec-watch workflow that doesn't exist) as SUPERSEDED, as was done for the deployment doc. Point CLAUDE.md at this plan instead; fix CLAUDE.md's stale claims (PRD "v0.9" → v0.11; "D-01…D-10 settled" → D-14; "dist/ gitignored" → committed-and-verified). Add a status table to `ENRICHMENT_REALISM_PLAN.md` (R1–R5.1 shipped; R4 keyed by slug, not MerchantId — amend the design record; R5.2–R6 open).

**F-04 · CONTRIBUTING rewrite + governance.** Counts are ~8× stale (413 tests → ~3.4k, 4 lints → 7, 3 invariants → 9); the persona-contribution gate ("when Insurance GA ships") fired in Phase 2.1 and nothing happened — either open D-07 contributions (with T-08e's schema validation as the safety net) or record a D-15 explaining why they stay closed. Add the missing `build:fixtures` step to the setup instructions (without it, a new contributor's `npm test` silently skips ~10 suites). Add a PR template with an invariant checklist, issue templates, and the promised Code of Conduct.

**F-05 · README repair.** Quick start doesn't produce a working sandbox (missing `build:fixtures`/`build:site`); it advertises unpublished packages with no warning; no links to CONTRIBUTING/CHANGELOG/roadmap; no single copy-pasteable `{Data, Links, Meta}` + `curl` example — the fastest "I get it" moment is missing. Surface the four undocumented flagship features (`/connect`, Arabic/RTL, persona builder, enrichment). Fix the self-contradicting package READMEs (`sandbox-fixtures` says 38 and 18+9 in the same file; `sandbox-mcp` claims per-line insurance tools at line 134 and denies them at line 165). Update `/about` (three domains, five plug-points, contribution status).

**F-06 · Spec freshness (prep for the errata3 bump).** The published standard is v2.1-final + errata3; banking is pinned two errata back, insurance three. Before bumping: (a) **decouple the `now` anchor from `SPEC_PIN.retrieved`** (`tools/build-shared.mjs:26-33`) into an explicit `NOW_ANCHOR` — today a spec re-pin regenerates every date in the corpus, drowning the schema diff in timestamp churn; (b) land A-5's provenance self-check; (c) add a weekly non-blocking freshness check against `Nebras-Open-Finance/api-specs` (the workflow `PHASE2_INSURANCE_PLAN.md` claims exists but doesn't). Then execute the bump behind `verify:spec-shape` + conformance lints + the full matrix suite, with special attention to any optional→mandatory promotions (invariant 5).

**F-07 · Consolidated ROADMAP.md.** Open work is currently scattered across five documents with colliding phase numbering. One page: Open Wealth, Service Initiation (currently discoverable only in a superseded plan and `/connect` UI copy), PostHog go-live (D-08), i18n remainder, MCP domain parity, realism R5.2–R6, replay mode, fixture snapshots (D-11), MCP CNAME cutover (D-13), Commons publication flip.

---

## 8. Track G — Architecture: pre-work for Open Wealth (slice 4)

Adding the ATM domain touched ~14 files; the goal is to make domain #4 the "config + generator module" job the Phase 2 plan promised. Do these behind a byte-identity harness (regenerate the full corpus before/after, require zero diff — RNG draw order is load-bearing and the in-code comments show this is understood):

- **G-01** Collapse the seven structurally-identical insurance line builders (~380 of 617 lines duplicated) into `buildLineBundle({ line, hooks })`.
- **G-02** Replace the fixture builder's hardcoded per-line id-extraction ladder (`tools/build-fixture-package.mjs:211-241`) with a per-domain `describeBundle(bundle)` export.
- **G-03** A-6's `DOMAIN_PIPELINES` registry (landed in slice 1) is the third leg.
- **G-04** Deduplicate the twin extended-spend loops in `transactions.js` (~70 lines, both containing the same EXP-05-load-bearing skip-on-zero logic — actively dangerous to patch singly).
- **G-05** Move the role vocabulary onto `spec/lfi-roles.yaml` (three uncoordinated JS tables today; `ROLE_AMOUNT_BANDS_AED` is missing all five Phase 2.2 retail roles and silently defaults) with a YAML↔table consistency test.
- **G-06** Emit LFI band tables from YAML into `dist/data.json` instead of the three hand-mirrored JS copies (drift currently prevented by test, not by construction).
- **G-07** Smaller: single `src/generator/time.js` for the nine `isoOf` copies; sync `buildRoleBundle` (invert the dynamic-import cycle); `computeCrossLfiLedger` uniform return shape; delete the run-once loop and dead `void` statements in `transactions.js`; documentation pass over `multi-lfi.js`'s misplaced JSDoc.

With G-01..G-06 landed, scoping **Open Wealth** (and Service Initiation after it) becomes: vendored YAML + pin files + bands YAML + `DOMAINS[]` entry + one generator module with hooks + personas. Target that shape explicitly in the domain-addition PR description as the acceptance test for this track.

---

## 9. Sequencing & effort

| Slice | Contents | Effort (focused days) | Gate |
|---|---|---|---|
| **1 — Integrity** | Track A (all) + T-03/T-04/T-06/T-07 | ~4 d | Corpus byte-diff reviewed; persona-count regression test green |
| **2 — Honest gates & reach** | T-01/T-02/T-05/T-08/T-09 + Track E (E-01..E-06) + C-P1..P4 + C-A1/A2 + i18n tranches 1–2 | ~10 d | Real bundle ≤ 250 KB gz; visual project red/green in CI; `tsc --noEmit` + pytest in CI; first real npm/PyPI publish |
| **3 — Experience & docs** | remaining Track C + i18n tranches 3–5 + Track F (F-01..F-05, F-07) | ~9 d | axe green on all dialog states; PRD v0.12 merged; CONTRIBUTING accurate |
| **4 — Foundations** | Track G + F-06 spec bump to errata3 + i18n tranche 6 (`/connect`) + E-07 picks + PostHog go-live (D-08) | ~12 d | Byte-identical corpus through G-refactors; errata3 pinned; Open Wealth scoped as config+module |

Slice 1 is deliberately small and self-contained: it fixes everything that makes the shipped product disagree with its own documentation, and it unblocks honest measurement for everything after.

## 10. Explicitly out of scope (tracked in ROADMAP.md, not here)

Open Wealth implementation itself, Service Initiation, replay mode (PRD §11 future), fixture snapshots (D-11), the MCP CNAME cutover (D-13, infra-side), deeper realism R6 (persona-level `spend_profile_id` / `seasonal_overrides` / `lifecycle_events` — needs the maintainer's four open answers in `ENRICHMENT_REALISM_PLAN.md` §Open questions first), and the Commons publication flip (F-02 prepares it; the flip itself is a maintainer decision).

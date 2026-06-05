// Sandbox UI entry — wires the three-pane layout to the deterministic
// generator and the parsed SPEC.json. The browser fetches both as static
// JSON (no build chain). State lives in a single object updated by select-
// box and persona-card events; every change re-renders the active panes.

import { buildBundle } from './generator/index.js';
import { track } from './analytics.js';
import {
  coverage,
  coverageByBand,
  coverageForEndpoint,
  leafFields,
  specCitationUrl,
  realLfisGuidance,
  bandForFieldName,
} from './shared/spec-helpers.js';
import { statusPill, syncViewTabs } from './shared/dom.js';
import { setDocumentLocale, normalizeLocale, DEFAULT_LOCALE } from './shared/i18n.js';
import { decodeFromUrl, encodeEmbed, encodeFixtureUrl, CUSTOM_PERSONA_SLUG } from './url.js';
import { expandRecipe } from './persona-builder/expand.js';
import { decodeRecipe, encodeRecipe, RECIPE_DEFAULTS } from './persona-builder/recipe.js';
import { mountPersonaBuilder } from './ui/persona-builder-ui.js';
// PR-14 perf — find-box module is dynamic-imported on first ⌘K /
// button click. Like Export popover, the entry point is user-triggered
// outside the cold-load measurement window, so the dynamic-import
// latency is invisible.
import { createTour } from './ui/tour.js';
// PR-12 perf — export popover is dynamic-imported on first ⌘E / button
// click so it stays off the cold-load critical path (EXP-24 Lighthouse
// budget). The factory itself isn't invoked until a user interaction.
// PR-14 — tour module was lazy-loaded in PR-13 (chasing 0.01 of perf
// budget) but it backfired: the dynamic import fires at init's tail
// on cold landing, inside the TBT measurement window, dropping the
// median to 0.57. Static import + modulepreload is the right shape.
import { createCompareView } from './ui/compare-view.js';
import { createTxFilter } from './ui/tx-filter.js';
import { createMonthlySummary } from './ui/monthly-summary.js';
// PR-15 perf — insurance module is dynamic-imported when the active
// domain shifts to insurance. The banking default landing never needs
// it, so keeping it off the cold-load path tightens the EXP-24
// Lighthouse budget without affecting insurance-flow latency
// (rebuildAndRender is already async work).
import {
  envelopesFromBundle,
  csvForResource,
  downloadJson,
  downloadCsv,
  downloadTarball,
} from './ui/export.js';
import { conditionalRule, isPii, whyEmpty } from './shared/field-knowledge.js';
import { createUnderwriting } from './ui/underwriting.js';
import { createFieldCard } from './ui/field-card.js';
import { createHoverPreview } from './ui/hover-preview.js';
import { createEmbedSnippet } from './ui/embed-snippet.js';
import { copyToClipboard } from './ui/clipboard.js';
import {
  el,
  isDateField,
  humaniseDate,
  humanArchetype,
  humanStressTerm,
  formatAmount,
  svgFromString,
} from './app/utils.js';
import {
  UNDERWRITING_PSEUDO,
  OVERVIEW_PSEUDO,
  ENDPOINTS,
  ACCOUNT_SCOPED_PATHS,
  BUNDLE_SCOPED_PATHS,
  JTBD_PRESETS,
  INSURANCE_JTBD_PRESETS,
  getJtbdPresets,
  STRESS_BEST_FOR,
  LFI_CAPTIONS,
  PANE_COLLAPSE_CLASS,
  NARROW_PANE_BREAKPOINT_PX,
  MEDIAN_HINT,
} from './app/constants.js';

const state = {
  spec: null,
  data: null,
  // Phase 2.0 multi-domain (slice 8). state.domain is 'banking' by default;
  // preview-status domains (e.g. insurance) are now visible in the chip and
  // tagged "(preview)" in the option label.
  // domains: id → manifest entry (label, status, parsedJsonUrl, defaultEndpoint).
  // activePersonas: state.data.personas filtered to state.domain.
  domain: 'banking',
  preview: false,
  domains: null,
  activePersonas: null,
  personaId: null,
  lfi: 'median',
  seed: 4729,
  // D-10 — UI language ('en' | 'ar') and numeral system ('latn' | 'arab').
  // English + Western digits are the defaults; both stay implicit in the URL.
  // `lang` flips <html lang/dir> and swaps the app-shell chrome; `numerals`
  // switches display digits independently (formatAmount routes through it).
  lang: 'en',
  numerals: 'latn',
  // Phase 2.3 ATM Locator domain state. atmId is the selected ATM's
  // identifier (`bundle.atms[].ATMId`); atmFilter is the picker rail's
  // text filter. Both reset on persona/domain switch in switchDomain().
  atmId: null,
  atmFilter: '',
  // PR #5 — Underwriting Summary is the default landing for banking
  // bundles. URL-pinned endpoints override this in init() per EXP-17.
  endpoint: UNDERWRITING_PSEUDO,
  view: 'rendered', // 'rendered' | 'raw'  (orthogonal to compareMode)
  bundle: null,
  selectedAccountId: null,
  // EXP-11: filter / sort state for the /transactions view.
  txFilter: emptyTxFilter(),
  txSort: { column: null, dir: 'asc' },
  // EXP-12: bidirectional links — `txHighlight` is a set of TransactionId
  // values to render with the highlight class; `crossLink` is the banner
  // shown above a filtered transactions view that lets the user jump back.
  txHighlight: new Set(),
  crossLink: null,
  // Date-humanise toggle on /transactions — shows "27 Apr 2025 · 11:00 GST"
  // instead of "2025-04-27T07:00:00Z" when on. Resets on persona/lfi change.
  humanDates: false,
  // Active stress-coverage filter on the persona library — null when no
  // filter; otherwise a single term-slug from Appendix F vocabulary.
  stressFilter: null,
  // Active JTBD preset filter on the persona library — null or a key from
  // JTBD_PRESETS. Composes with stressFilter (both must match if both are
  // set, but UI activates only one at a time).
  jtbdFilter: null,
  // Active business-segment filter on the persona library — null or one of
  // Retail | SME | Corporate (the v2.1 AccountType / PartyCategory enum).
  // Single-select toggle; composes with stressFilter and jtbdFilter as AND.
  segmentFilter: null,
  // EXP-16 Compare-LFIs — when state.compareMode is true, renderPayload
  // builds two bundles (state.lfi vs state.compareWith) and renders them
  // side-by-side with diff highlighting. Decoupled from state.view so
  // representation (rendered/raw) and cardinality (one/two LFIs) stay
  // orthogonal.
  compareMode: false,
  compareWith: 'sparse',
  // Inline-expand the field metadata under each column header in the
  // rendered view. EXP-14 hover/click is the on-demand path; this is the
  // "I want to read everything at once" path for first-time visits.
  expandFields: false,
  // PII-only column filter — Reem's JTBD-12.1 ("scope my data-handling
  // controls under PDPL"). When true, the rendered table hides every
  // column whose field is not in the curated PII allowlist.
  piiOnly: false,
  // Phase R1.5 — "Show enriched" toggle. When OFF (default), /transactions
  // renders the raw v2.1 envelope as a real UAE core would emit it. When
  // ON, the rendered table joins the enrichment sidecar by TransactionId
  // and overlays a clean merchant name + Category + Subcategory columns.
  // Persists in the URL as `?enriched=1`. Pure render-time toggle —
  // bundle data is unchanged.
  enriched: false,
  // Cold-landing welcome cards — first-load orientation for visitors arriving
  // from the Commons feed. Per EXP-22 the app does not write to local /
  // sessionStorage, so the dismissal lives only in JS state (a refresh re-shows
  // by design) and the cards fire only when the URL has no query params.
  welcomeShown: false,
  welcomeDismissed: false,
  // Tour state — cold landing auto-launches the 5-step walkthrough and the
  // Tour button is demoted to a small ⓘ icon once seen. Same EXP-22
  // constraint as welcomeShown: JS-only, refresh re-arms by design.
  tourSeen: false,
  // PR-13 (Greptile P1) — set of AccountIds the user has explicitly
  // collapsed in the navigator. renderNavigator() reads this to honour
  // the toggle across re-renders (which call replaceChildren()).
  // JS-only per EXP-22; cleared on persona switch.
  navAccountCollapsed: new Set(),
};

// Mount the UI submodules. `state` is a const and the helpers below
// are hoisted function declarations — so closure-binding the deps
// here at module load is stable. Field card is mounted first because
// the Find box's "jump to field" path depends on its openFieldCard.
const { openFieldCard } = createFieldCard({
  state,
  el,
  endpointFieldsByName,
  rowsForActiveEndpoint,
  setPaneCollapsed,
});
const { attachHoverPreview } = createHoverPreview({
  state,
  el,
  endpointFieldsByName,
});
const { copyEmbedSnippet, buildEmbedSnippet } = createEmbedSnippet({
  state,
  OVERVIEW_PSEUDO,
  UNDERWRITING_PSEUDO,
});
// PR-14 perf — find-box lazy wrapper. Dynamic-import on first
// invocation; reuse the resolved instance thereafter. Keeps the
// ~200-line find-box module off the cold-load JS payload.
const findBox = (() => {
  let inner = null;
  let loading = null;
  function ensure() {
    if (inner) return inner;
    if (!loading) {
      loading = import('./ui/find-box.js').then(({ createFindBox }) => {
        inner = createFindBox({
          state,
          el,
          humanArchetype,
          rebuildAndRender,
          clearTxState,
          renderNavigator,
          renderPayload,
          openFieldCard,
        });
        return inner;
      });
    }
    return loading;
  }
  // PR-16 (Greptile P1) — sync fast-path once the module has loaded so
  // ⌘K spam can't race against itself.
  return {
    open() {
      if (inner) {
        inner.openFind();
        return;
      }
      ensure().then((p) => p.openFind());
    },
    close() {
      inner?.closeFind();
    },
  };
})();
const openFind = () => findBox.open();
const closeFind = () => findBox.close();
const { startTour } = createTour({
  state,
  el,
  setPersona,
  emptyTxFilter,
  renderNavigator,
  renderPayload,
  renderCoverage,
  onClose: () => demoteTourButton(),
});

// Demote the prominent "Tour" button to a small ⓘ icon once the user has
// seen the walkthrough (finish/skip/click-outside all route through
// closeTour). State is JS-only per EXP-22 — a refresh re-arms the prominent
// label, and cold-landing visitors get auto-launched again next session.
function demoteTourButton() {
  const btn = document.getElementById('tour-btn');
  if (!btn) return;
  btn.classList.add('topbar-btn-icon');
  btn.textContent = 'ⓘ';
  btn.setAttribute('aria-label', 'Replay guided tour');
  btn.setAttribute('title', 'Replay the 5-step guided tour');
}
const { renderCompareView } = createCompareView({
  state,
  el,
  stripInternal,
  personaAvatarEl,
});
const { renderTxFilterBar, applyFilter, applySort, toggleSort } = createTxFilter({
  state,
  el,
  renderPayload,
  emptyTxFilter,
  updateUrl: pushPermalink,
});
const { renderMonthlySummary } = createMonthlySummary({ el, formatAmount });
// PR-15 — lazy insurance wrapper. The factory loads on the first
// renderInsuranceBundle() call; subsequent calls reuse the cached
// instance. Banking flow never triggers the import.
// PR-16 (Greptile P1) — sync fast-path once `inner` is loaded so a
// second call within the same tick can't race with the first.
const renderInsuranceBundle = (() => {
  let inner = null;
  let loading = null;
  function ensure() {
    if (inner) return inner;
    if (!loading) {
      loading = import('./ui/insurance.js').then(({ createInsurance }) => {
        inner = createInsurance({
          state,
          el,
          syncControls,
          pushPermalink,
        }).renderInsuranceBundle;
        return inner;
      });
    }
    return loading;
  }
  return () => {
    if (inner) {
      inner();
      return;
    }
    ensure().then((fn) => fn());
  };
})();
// Phase 2.3 ATM Locator UX revision — same lazy-load pattern as insurance.
// The ATM module replaces the persona library with an ATM picker rail and
// renders the selected ATM as a field tree (no compare-mode, no underwriting,
// no coverage meter — all persona-shaped affordances are suppressed).
let _atmRestorePersonaChrome = null;
const renderAtmBundle = (() => {
  let inner = null;
  let loading = null;
  function ensure() {
    if (inner) return inner;
    if (!loading) {
      loading = import('./ui/atm.js').then(({ createAtm, restorePersonaPaneChrome }) => {
        inner = createAtm({
          state,
          el,
          syncControls,
          pushPermalink,
        }).renderAtmBundle;
        _atmRestorePersonaChrome = restorePersonaPaneChrome;
        return inner;
      });
    }
    return loading;
  }
  return () => {
    if (inner) {
      inner();
      return;
    }
    ensure().then((fn) => fn());
  };
})();
const { renderUnderwritingStrip, renderUnderwritingPanel } = createUnderwriting({
  state,
  el,
  formatAmount,
  renderNavigator,
  renderPayload,
  UNDERWRITING_PSEUDO,
  openFieldCard,
});

// PR-12 perf — Export popover module is loaded on-demand on the first
// ⌘E / button click. The wrapper exposes the same `{ open, close,
// isOpen }` surface as the eagerly-instantiated factory used to, so
// the keyboard / button handlers in attachEventHandlers don't change
// shape. EXP-24 Lighthouse budget benefits because the popover code
// is off the cold-load critical path.
const exportPopover = (() => {
  let inner = null;
  let loading = null;
  const deps = () => ({
    state,
    el,
    track,
    copyToClipboard,
    exportActiveJson: () => exportActiveJson(),
    exportActiveCsv: () => exportActiveCsv(),
    exportTarball: () => exportTarball(),
    embedIframeSnippet: () => buildEmbedSnippet(),
    activeFixtureUrl: () => {
      const origin =
        window.location.origin +
        window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
      return encodeFixtureUrl({
        origin,
        personaId: state.personaId,
        lfi: state.lfi,
        seed: state.seed,
        endpoint:
          state.endpoint === OVERVIEW_PSEUDO || state.endpoint === UNDERWRITING_PSEUDO
            ? '/accounts'
            : state.endpoint,
      });
    },
    activeJsonString: () => {
      if (!state.bundle) return '';
      const ctx = exportContext();
      const envelopes = envelopesFromBundle(state.bundle, ctx);
      const key = activeEnvelopeKey();
      const env = envelopes[key] ?? envelopes[state.endpoint];
      return env ? JSON.stringify(env, null, 2) : '';
    },
    activeCsvString: () => {
      if (!state.bundle) return '';
      return buildActiveCsvString();
    },
  });
  function ensure() {
    if (inner) return inner;
    if (!loading) {
      loading = import('./ui/export-popover.js').then(({ createExportPopover }) => {
        inner = createExportPopover(deps());
        return inner;
      });
    }
    return loading;
  }
  // PR-16 — sync fast-path once the module has loaded so the common
  // case (cache warm) doesn't pay a microtask yield. The inner open()
  // at src/ui/export-popover.js:126 is itself a toggle, so a real
  // dblclick still opens-then-closes by design.
  return {
    open() {
      if (inner) {
        inner.open();
        return;
      }
      ensure().then((p) => p.open());
    },
    close() {
      inner?.close();
    },
    get isOpen() {
      return inner ? inner.isOpen : false;
    },
  };
})();

// Phase R1.5 — merge a single enrichment record onto a /transactions row.
// Returns a NEW row object so the underlying bundle stays untouched.
// Adds two top-level keys (Category, Subcategory) that the table-render
// loop picks up as new columns. When the sidecar carries a merchant name
// and the row has none (Sparse stripped MerchantDetails), the overlay
// recovers it under a synthetic MerchantDetails block so the column
// still renders. Field-card lookup tolerates unknown column names —
// Category/Subcategory aren't v2.1 fields, which is correct (they're
// enrichment-engine output, not bank-side wire data).
function applyEnrichmentOverlay(row, rec) {
  if (!rec) return row;
  const out = { ...row };
  if (rec.category) out.Category = rec.category;
  if (rec.subcategory) out.Subcategory = rec.subcategory;
  // Phase R4 — Logo column. Marker tokens that the row-rendering loop
  // picks up to swap in an <img> from the brand-registry path. Stays
  // a string in the row object so the generic cell-render path stays
  // unchanged; the renderPayload loop replaces the cell content when
  // the column key === 'Logo'.
  if (rec.logoUrl) {
    out.Logo = rec.logoUrl;
  }
  if (rec.merchant) {
    out.MerchantDetails = {
      ...(row.MerchantDetails ?? {}),
      MerchantName: rec.merchant,
      ...(rec.mcc ? { MerchantCategoryCode: rec.mcc } : {}),
    };
  }
  return out;
}

function emptyTxFilter() {
  return {
    search: '',
    type: '',
    subType: '',
    debitCredit: '',
    dateFrom: '',
    dateTo: '',
    amountFrom: '',
    amountTo: '',
    mcc: '',
  };
}

async function init() {
  // Wire the pane-collapse chevrons before any await so they remain live even
  // if the data/spec fetches fail (e.g. when the user serves the repo from
  // src/ alone and ../dist isn't reachable). The chevrons live in static HTML
  // and don't depend on any async state.
  wirePaneCollapse();

  // Cold landing = URL with no query params (visitor arriving from the
  // Commons feed for the first time). Drives the welcome cards since EXP-22
  // forbids storage-based "first-visit" detection.
  const isColdLanding = window.location.search === '';
  state.welcomeShown = isColdLanding;

  const url = decodeFromUrl(window.location.href);
  state.preview = url.preview;
  state.enriched = Boolean(url.enriched);
  // D-10 — resolve UI language from the URL and apply the document locale
  // before first paint. Numerals default to follow the language (Arabic UI →
  // Arabic-Indic digits) but remain an independent toggle. `skipChromeWhenDefault`
  // leaves the literal English HTML untouched for the default locale so the
  // LTR visual baselines never drift; Arabic re-translates the chrome here.
  state.lang = normalizeLocale(url.lang);
  state.numerals = state.lang === 'ar' ? 'arab' : 'latn';
  setDocumentLocale(document, {
    lang: state.lang,
    numerals: state.numerals,
    skipChromeWhenDefault: true,
  });
  // Phase 2.3 — ATM selection from URL; only honoured when the resolved
  // domain ends up as 'atm' (renderAtmBundle re-validates the ATMId
  // exists in the active fleet and falls back to the first ATM if not).
  state.atmId = url.atmId ?? null;

  // Slice 8: domain manifest drives which SPEC.json to lazy-load. Banking
  // remains the default; unknown domain values fall back to banking.
  // Avatars are presentation-only — a 404 / non-JSON response or transient
  // network blip must not block the rest of init (the fallback initials
  // path covers any missing avatar). data / domains are load-bearing and
  // stay strict.
  const [domainsRes, dataRes, avatarsRes] = await Promise.all([
    fetch('../dist/domains.json'),
    fetch('../dist/data.json'),
    fetch('../dist/avatars.json').catch(() => null),
  ]);
  const domainsManifest = await domainsRes.json();
  state.data = await dataRes.json();
  // D-10 — on a non-default initial locale, merge the lazy Arabic content
  // before first paint so persona names render localized. The default English
  // path skips the extra fetch entirely (the overlay is opt-in, not preloaded).
  if (state.lang !== DEFAULT_LOCALE) await ensureLocaleData(state.lang);
  state.avatars = {};
  if (avatarsRes && avatarsRes.ok) {
    try {
      state.avatars = (await avatarsRes.json()).avatars ?? {};
    } catch {
      // Malformed avatars.json — fall through to the initials fallback.
    }
  }
  state.domains = Object.fromEntries(domainsManifest.domains.map((d) => [d.id, d]));

  let resolvedDomain = url.domain;
  const requested = state.domains[resolvedDomain];
  if (!requested) {
    resolvedDomain = 'banking';
  }
  state.domain = resolvedDomain;

  const specEntry = state.domains[state.domain];
  // parsedJsonUrl is "/dist/SPEC.<domain>.json"; the app is served from src/
  // so we walk one level up.
  const specRes = await fetch(`..${specEntry.parsedJsonUrl}`);
  state.spec = await specRes.json();

  state.activePersonas = Object.fromEntries(
    Object.entries(state.data.personas).filter(([, p]) => p.domain === state.domain),
  );

  // Workstream B — materialise a custom persona from the URL recipe param,
  // if present. The generator pipeline is persona-agnostic; injecting the
  // expanded persona into state.data.personas + state.activePersonas under
  // the 'custom' key lets the rest of the app behave identically to a
  // curated persona. The recipe itself stays in state.recipe so
  // pushPermalink can re-encode it on share / URL update.
  if (state.domain === 'banking' && url.personaId === CUSTOM_PERSONA_SLUG && url.recipe) {
    try {
      const recipe = decodeRecipe(url.recipe);
      const customPersona = expandRecipe(recipe, state.data.pools);
      state.data.personas[CUSTOM_PERSONA_SLUG] = customPersona;
      state.activePersonas[CUSTOM_PERSONA_SLUG] = customPersona;
      state.recipe = recipe;
    } catch (err) {
      console.warn('Custom persona recipe failed to expand:', err);
    }
  }

  state.personaId =
    url.personaId && state.activePersonas[url.personaId]
      ? url.personaId
      : Object.keys(state.activePersonas)[0];
  state.lfi = url.lfi;
  state.seed = url.seed;
  // EXP-17: honour the URL's pinned endpoint when it's recognised by the
  // active domain's spec or one of the two banking pseudo-endpoints
  // (overview, underwriting). Falls back to the domain default otherwise.
  if (state.domain === 'banking') {
    const isPseudo = url.endpoint === OVERVIEW_PSEUDO || url.endpoint === UNDERWRITING_PSEUDO;
    const isSpecEndpoint = url.endpoint && ENDPOINTS.some((e) => e.path === url.endpoint);
    if (isPseudo || isSpecEndpoint) state.endpoint = url.endpoint;
  } else {
    state.endpoint =
      url.endpoint && state.spec.endpoints[url.endpoint]
        ? url.endpoint
        : specEntry.defaultEndpoint || Object.keys(state.spec.endpoints)[0];
  }

  document.getElementById('footer-sha').textContent = (state.spec.pinSha || 'unknown').slice(0, 7);
  // specVersion already starts with "v" — don't double-prefix.
  const v = String(state.spec.specVersion || '');
  const versionLabel = v.startsWith('v') ? v : `v${v}`;
  const pin = document.getElementById('version-pin');
  pin.textContent = `${versionLabel} @ ${(state.spec.pinSha || '').slice(0, 7)}`;
  pin.title = `Pinned spec SHA ${state.spec.pinSha}\nRetrieved ${state.spec.retrievedAt}\nUpstream: ${state.spec.upstreamRepo}/${state.spec.upstreamPath}`;

  buildSegmentRail();
  buildJtbdRail();
  buildPersonaList();
  renderDomainChip();
  syncControls();
  attachEventHandlers();
  attachBuilderHandlers();
  // Workstream C plug-point 1 (Service Worker fixture mock) is implemented
  // and unit-tested under tests/fixture-handler.test.mjs; live registration
  // is gated on a deployment-time `Service-Worker-Allowed: /` header that
  // requires sandbox-host configuration outside this commit's scope. Until
  // that lands, custom-persona bundles are accessible via the npm engine
  // (plug-point 2) and the static-fixture zip download (plug-point 3).
  rebuildAndRender();
  emitPersonaLoad();

  // Auto-launch the 5-step tour on cold landing (URL with no query params)
  // — first-visit orientation. EXP-22 forbids storage-based "first visit"
  // detection, so we reuse the same isColdLanding signal that drives the
  // welcome cards. URL-with-params is treated as a returning visitor —
  // the Tour button starts demoted to ⓘ and the tour does not auto-launch.
  // After finish/skip on a cold landing, the button likewise demotes.
  if (isColdLanding && !state.tourSeen) {
    startTour();
  } else {
    demoteTourButton();
  }
}

// EXP-21 helpers — kept thin and centralised so analytics call sites are
// auditable in one place and the per-event property allowlist matches
// src/analytics.js exactly.
function emitPersonaLoad() {
  track('persona_load', {
    persona_id: state.personaId,
    domain: state.domain,
    lfi: state.lfi,
    custom: state.personaId === CUSTOM_PERSONA_SLUG,
  });
}

// Workstream B — wire the "+ Build a custom persona" CTA in the persona pane
// to the builder dialog. The dialog is mounted lazily on first open so the
// initial render stays cheap; subsequent opens reuse the same instance.
let builderInstance = null;
function attachBuilderHandlers() {
  const btn = document.getElementById('open-builder-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!builderInstance) {
      builderInstance = mountPersonaBuilder({
        pools: state.data.pools,
        currentRecipe: state.recipe,
        onApply: ({ recipe, persona }) => {
          state.data.personas[CUSTOM_PERSONA_SLUG] = persona;
          state.activePersonas[CUSTOM_PERSONA_SLUG] = persona;
          state.recipe = recipe;
          state.personaId = CUSTOM_PERSONA_SLUG;
          state.navAccountCollapsed.clear();
          // PR #5 — Banking bundles default to Underwriting Summary on a
          // persona switch; it surfaces the four illustrative signals
          // (income / commitments / DBR / NSF) up-front instead of routing
          // through the bundle-level /accounts overview.
          state.endpoint = UNDERWRITING_PSEUDO;
          state.selectedAccountId = null;
          buildPersonaList();
          rebuildAndRender();
        },
      });
    }
    builderInstance.open(state.recipe ?? { ...RECIPE_DEFAULTS });
  });
}

function bestForLine(persona) {
  const terms = persona.stress_coverage ?? [];
  const lines = [];
  for (const t of terms) {
    const v = STRESS_BEST_FOR[t];
    if (v && !lines.includes(v)) lines.push(v);
  }
  return lines.join(' · ');
}

// Persona avatar — wraps the build-time SVG in an aria-labelled card.
// `size` is a tag the CSS keys off: 'sm' for library list, 'md' for the
// compare-LFIs header, 'lg' for the persona-overview pane. The custom
// persona has no build-time manifest (it's expanded at runtime from a
// recipe), so it gets a sparkle glyph indicating "composed on the fly".
const CUSTOM_AVATAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
  '<rect width="120" height="120" fill="#E6DDEC"/>' +
  // Big sparkle (four-point star) centred
  '<path d="M60 26 L66 52 L92 60 L66 68 L60 94 L54 68 L28 60 L54 52 Z" fill="#6E548F"/>' +
  // Small sparkles for "compose / variation" feel
  '<path d="M30 30 L33 38 L41 41 L33 44 L30 52 L27 44 L19 41 L27 38 Z" fill="#6E548F" opacity="0.55"/>' +
  '<path d="M92 78 L94.5 84 L100 86.5 L94.5 89 L92 95 L89.5 89 L84 86.5 L89.5 84 Z" fill="#6E548F" opacity="0.55"/>' +
  '</svg>';

function personaAvatarEl(id, persona, size) {
  const name = persona?.name ?? id;
  const wrap = el('div', {
    class: `persona-avatar persona-avatar-${size}`,
    attrs: {
      role: 'img',
      // "Synthetic illustration" makes the watermark contract explicit to
      // screen readers — these are clearly not photos of real customers.
      'aria-label': `Synthetic illustration for ${name}`,
    },
  });
  const a = state.avatars?.[id];
  let svgSource = a?.svg;
  if (!svgSource && id === CUSTOM_PERSONA_SLUG) {
    svgSource = CUSTOM_AVATAR_SVG;
    wrap.classList.add('persona-avatar-custom');
  }
  const node = svgFromString(svgSource);
  if (node) {
    wrap.appendChild(node);
  } else {
    // Fallback initials — covers any future persona that lands before its
    // avatar is built. Never reached for the curated set + custom slug.
    // Mirrors tools/build-avatars.mjs initials(): first+last word, or the
    // first two chars when only one word is available.
    const head = (name ?? '').split(/\s+[—–-]\s+/)[0].trim();
    const words = head.split(/\s+/).filter(Boolean);
    const initials =
      words.length >= 2
        ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
        : words[0]
          ? words[0].slice(0, 2).toUpperCase()
          : '?';
    wrap.classList.add('persona-avatar-fallback');
    wrap.appendChild(el('span', { class: 'persona-avatar-initials', text: initials }));
  }
  return wrap;
}

const SEGMENT_FILTERS = ['Retail', 'SME', 'Corporate'];

function buildSegmentRail() {
  const rail = document.getElementById('segment-rail');
  if (!rail) return;
  rail.replaceChildren();
  for (const seg of SEGMENT_FILTERS) {
    const active = state.segmentFilter === seg;
    const chip = el('button', {
      class: 'jtbd-chip',
      attrs: {
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        title: `Show only ${seg} personas`,
      },
      text: seg,
      onClick: () => {
        state.segmentFilter = state.segmentFilter === seg ? null : seg;
        buildSegmentRail();
        buildPersonaList();
      },
    });
    rail.appendChild(chip);
  }
}

function buildJtbdRail() {
  const rail = document.getElementById('jtbd-rail');
  if (!rail) return;
  rail.replaceChildren();
  const presets = getJtbdPresets(state.domain);
  // If the active filter doesn't belong to the current domain's presets
  // (e.g. user switched banking → insurance with 'affordability' selected),
  // drop it so the rail and library stay coherent.
  if (state.jtbdFilter && !presets[state.jtbdFilter]) state.jtbdFilter = null;
  for (const [key, preset] of Object.entries(presets)) {
    const active = state.jtbdFilter === key;
    // PR-13 — these are toggle filters (deselectable by clicking again),
    // not exclusive tabs. role="tab" was added in PR #3 by analogy but
    // mixed with aria-pressed (axe-core critical aria-allowed-attr).
    // Drop role="tab" and rely on the implicit button role + aria-pressed.
    const chip = el('button', {
      class: 'jtbd-chip',
      attrs: {
        type: 'button',
        'aria-pressed': active ? 'true' : 'false',
        title: `Show personas covering ${preset.label.toLowerCase()} scenarios (${preset.terms.join(', ')})`,
      },
      text: preset.label,
      onClick: () => {
        state.jtbdFilter = state.jtbdFilter === key ? null : key;
        // JTBD preset replaces any single-term stress filter — keeps the
        // persona list state legible (one filter active at a time).
        if (state.jtbdFilter) state.stressFilter = null;
        buildJtbdRail();
        buildPersonaList();
      },
    });
    rail.appendChild(chip);
  }
}

function personaMatchesActiveFilter(persona) {
  const terms = persona.stress_coverage ?? [];
  if (state.segmentFilter && (persona.segment ?? 'Retail') !== state.segmentFilter) return false;
  if (state.stressFilter && !terms.includes(state.stressFilter)) return false;
  if (state.jtbdFilter) {
    const presets = getJtbdPresets(state.domain);
    const allow = presets[state.jtbdFilter]?.terms ?? [];
    if (!terms.some((t) => allow.includes(t))) return false;
  }
  return true;
}

function buildPersonaList() {
  // ATM domain owns the #persona-list container — its picker rail replaces
  // the persona library entirely. renderAtmBundle() populates the list and
  // hangs `.is-atm` on the pane so the stress / JTBD / segment rails are
  // hidden via CSS.
  if (state.domain === 'atm') return;
  const list = document.getElementById('persona-list');
  list.replaceChildren();

  // Render stress-filter bar state.
  const filterBar = document.getElementById('stress-filter-bar');
  const filterTerm = document.getElementById('stress-filter-term');
  if (state.stressFilter) {
    filterBar.classList.remove('is-empty');
    filterTerm.textContent = humanStressTerm(state.stressFilter);
    filterTerm.title = `Stress-coverage term: ${state.stressFilter}`;
    document.getElementById('stress-filter-clear').onclick = () => {
      state.stressFilter = null;
      buildPersonaList();
    };
  } else {
    filterBar.classList.add('is-empty');
  }

  let visibleCount = 0;
  for (const [id, p] of Object.entries(state.activePersonas ?? state.data.personas)) {
    if (!personaMatchesActiveFilter(p)) continue;
    visibleCount += 1;

    const isCustom = id === CUSTOM_PERSONA_SLUG;
    const cardBody = el(
      'div',
      { class: 'persona-card-body' },
      el(
        'div',
        { class: 'persona-name' },
        document.createTextNode(localizedName(p)),
        isCustom ? el('span', { class: 'custom-badge', text: 'Custom (not curated)' }) : null,
      ),
      el('div', { class: 'persona-archetype', text: humanArchetype(p.archetype) }),
    );

    // PR #4: JTBD chips are the visible default — one chip per scenario
    // family this persona qualifies for. The richer stress-coverage chips
    // + prose narrative move into the "▾ More about this persona"
    // disclosure below, keeping the default card view compact.
    const families = jtbdFamiliesForPersona(p);
    if (families.length > 0) {
      const jtbdRow = el('div', {
        class: 'persona-jtbd',
        attrs: { 'aria-label': 'Scenario families' },
      });
      for (const fam of families) {
        const active = state.jtbdFilter === fam.key;
        const chip = el('button', {
          class: `persona-jtbd-chip${active ? ' is-active' : ''}`,
          text: fam.label,
          attrs: {
            type: 'button',
            title: active
              ? `Scenario filter active: ${fam.label} — click to clear`
              : `Click to filter library by scenario: ${fam.label}`,
            'aria-pressed': active ? 'true' : 'false',
          },
        });
        chip.addEventListener('click', (ev) => {
          ev.stopPropagation();
          state.jtbdFilter = state.jtbdFilter === fam.key ? null : fam.key;
          if (state.jtbdFilter) state.stressFilter = null;
          buildJtbdRail();
          buildPersonaList();
          renderTopbarPersona();
        });
        jtbdRow.appendChild(chip);
      }
      cardBody.appendChild(jtbdRow);
    }

    // "More about this persona" disclosure — prose narrative, best-for
    // signal, and the fine-grained stress chips. Collapsed by default.
    const bestFor = bestForLine(p);
    const hasMore =
      Boolean(p.narrative) ||
      Boolean(bestFor) ||
      (Array.isArray(p.stress_coverage) && p.stress_coverage.length > 0);
    if (hasMore) {
      const details = el('details', { class: 'persona-more' });
      const summary = el('summary', { class: 'persona-more-summary' });
      summary.appendChild(document.createTextNode('More about this persona'));
      details.appendChild(summary);
      if (bestFor) details.appendChild(el('div', { class: 'persona-best', text: bestFor }));
      if (p.narrative)
        details.appendChild(
          el('div', { class: 'persona-narrative', text: localizedNarrative(p).trim() }),
        );
      if (Array.isArray(p.stress_coverage) && p.stress_coverage.length > 0) {
        const chips = el('div', {
          class: 'persona-stress',
          attrs: { 'aria-label': 'Stress coverage' },
        });
        for (const term of p.stress_coverage) {
          const isActive = term === state.stressFilter;
          const chip = el('span', {
            class: `stress-chip${isActive ? ' stress-active' : ''}`,
            text: humanStressTerm(term),
            attrs: {
              role: 'button',
              tabindex: '0',
              title: isActive
                ? `Filter active: ${term} — click to clear`
                : `Click to show only personas covering: ${term}`,
            },
          });
          const onChipActivate = (ev) => {
            ev.stopPropagation();
            state.stressFilter = state.stressFilter === term ? null : term;
            buildPersonaList();
          };
          chip.addEventListener('click', onChipActivate);
          chip.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              onChipActivate(ev);
            }
          });
          chips.appendChild(chip);
        }
        details.appendChild(chips);
      }
      // Stop card-click activation when the user opens the disclosure
      // or interacts with anything inside it.
      details.addEventListener('click', (ev) => ev.stopPropagation());
      cardBody.appendChild(details);
    }

    const card = el(
      'div',
      {
        class: `persona-card${isCustom ? ' is-custom' : ''}`,
        attrs: { role: 'listitem' },
        dataset: { personaId: id },
        onClick: (e) => {
          // Chips and the disclosure handle their own clicks. The card-level
          // click only fires when the user clicks empty card chrome.
          if (e.target.closest('.stress-chip, .persona-jtbd-chip, .persona-more')) return;
          state.personaId = id;
          state.navAccountCollapsed.clear();
          // PR #5 — banking persona-switch now lands on the Underwriting
          // Summary by default; insurance flow has its own per-domain
          // default endpoint resolved in rebuildAndRender.
          state.endpoint = UNDERWRITING_PSEUDO;
          state.selectedAccountId = null;
          rebuildAndRender();
          // PR-11 — emit EXP-21 persona_load on every card-click activation
          // (previously this fired from the persona-select change listener;
          // the dropdown is gone).
          emitPersonaLoad();
        },
      },
      personaAvatarEl(id, p, 'sm'),
      cardBody,
    );
    list.appendChild(card);
  }

  if (visibleCount === 0) {
    list.appendChild(
      el('div', {
        class: 'persona-empty',
        text: 'No personas cover this stress term yet. Clear the filter to see the full library.',
      }),
    );
  }
  // Re-sync the active card's visual state after a re-render.
  for (const card of document.querySelectorAll('.persona-card')) {
    card.classList.toggle('active', card.dataset.personaId === state.personaId);
  }
}

function syncControls() {
  // PR-11 — the visible persona dropdown is gone; persona switching is
  // driven by the left-pane persona library only. Hidden legacy LFI
  // <select> is kept for any URL-encoded form handlers and as a single
  // readable accessor; the visible control is the segmented buttons.
  const legacy = document.getElementById('lfi-select');
  if (legacy) legacy.value = state.lfi;
  for (const btn of document.querySelectorAll('#lfi-seg button[data-lfi]')) {
    btn.setAttribute('aria-checked', btn.dataset.lfi === state.lfi ? 'true' : 'false');
  }
  for (const btn of document.querySelectorAll('#lfi-seg-compare button[data-cmp-lfi]')) {
    btn.setAttribute('aria-checked', btn.dataset.cmpLfi === state.compareWith ? 'true' : 'false');
  }
  const compareBtn = document.getElementById('compare-toggle');
  if (compareBtn) compareBtn.setAttribute('aria-pressed', state.compareMode ? 'true' : 'false');
  const compareRow = document.getElementById('lfi-compare-row');
  if (compareRow) compareRow.hidden = !state.compareMode;
  const caption = document.getElementById('lfi-caption');
  if (caption) caption.textContent = LFI_CAPTIONS[state.lfi] ?? '';
  document.getElementById('seed-input').value = String(state.seed);
  for (const btn of document.querySelectorAll('#lang-seg button[data-lang]')) {
    btn.setAttribute('aria-checked', btn.dataset.lang === state.lang ? 'true' : 'false');
  }
  for (const btn of document.querySelectorAll('#numeral-seg button[data-numerals]')) {
    btn.setAttribute('aria-checked', btn.dataset.numerals === state.numerals ? 'true' : 'false');
  }
  const expand = document.getElementById('toggle-expand-all');
  if (expand) expand.checked = !!state.expandFields;
  const piiOnly = document.getElementById('toggle-pii-only');
  if (piiOnly) piiOnly.checked = !!state.piiOnly;
  for (const card of document.querySelectorAll('.persona-card')) {
    card.classList.toggle('active', card.dataset.personaId === state.personaId);
  }
}

// D-10 — re-apply the active locale to the document (sets <html lang/dir>,
// numeral mode, and swaps the [data-i18n] chrome). aria-checked on the
// language / numeral toggles is reconciled by syncControls() on the
// subsequent render.
function applyLocale() {
  setDocumentLocale(document, { lang: state.lang, numerals: state.numerals });
}

// Side-pane collapse — frees screen real estate for the navigator. State
// lives in JS only (EXP-22 forbids storage), so a refresh restores both
// panes. Field-card opens auto-expand the right pane (matches the existing
// .field-detail.open overlay behavior used at ≤1099 px).
//
// Below NARROW_PANE_BREAKPOINT_PX (1280) the navigator gets squeezed when
// both side panes are open, so expanding one auto-collapses the other.
// At >= 1280 the manual two-open state is allowed.
const OPPOSITE_PANE = Object.freeze({
  'persona-pane': 'field-detail',
  'field-detail': 'persona-pane',
});
function isNarrowViewport() {
  return window.matchMedia(`(max-width: ${NARROW_PANE_BREAKPOINT_PX - 1}px)`).matches;
}
function setPaneCollapsed(target, collapsed) {
  const root = document.getElementById('three-pane');
  if (!root) return;
  const cls = PANE_COLLAPSE_CLASS[target];
  if (!cls) return;
  root.classList.toggle(cls, collapsed);
  // At ≤1099 px the field-detail is a slide-in overlay (.open), not a grid
  // column — its chevron means "dismiss" there, so drop .open too.
  if (target === 'field-detail' && collapsed) {
    document.getElementById('field-detail').classList.remove('open');
  }
  for (const btn of document.querySelectorAll(`.pane-collapse[data-target="${target}"]`)) {
    btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  // Narrow-viewport mutex: expanding one side pane collapses the opposite,
  // so the middle navigator never sits between two simultaneously-open panes
  // below 1280. Skip when at ≤1099 px (right pane is overlay, not a column,
  // so the squeeze doesn't apply).
  if (!collapsed && isNarrowViewport()) {
    const overlayMode = window.matchMedia('(max-width: 1099px)').matches;
    if (!overlayMode) {
      const other = OPPOSITE_PANE[target];
      const otherCls = PANE_COLLAPSE_CLASS[other];
      if (other && otherCls && !root.classList.contains(otherCls)) {
        // Recurse with collapse=true; the guard above means this branch
        // can't loop indefinitely.
        setPaneCollapsed(other, true);
      }
    }
  }
}
function applyNarrowViewportDefault() {
  // When the viewport drops below 1280 and both side panes are still open
  // (typical fresh load between 1100–1279), auto-collapse the field-detail
  // by default — the persona library is the entry point, field-detail
  // re-expands on field click. At ≤1099 the existing overlay model takes
  // over and this is a no-op.
  const root = document.getElementById('three-pane');
  if (!root) return;
  if (!isNarrowViewport()) return;
  if (window.matchMedia('(max-width: 1099px)').matches) return;
  const leftOpen = !root.classList.contains('left-collapsed');
  const rightOpen = !root.classList.contains('right-collapsed');
  if (leftOpen && rightOpen) setPaneCollapsed('field-detail', true);
}
function wirePaneCollapse() {
  for (const btn of document.querySelectorAll('.pane-collapse')) {
    btn.addEventListener('click', () => setPaneCollapsed(btn.dataset.target, true));
  }
  for (const rail of document.querySelectorAll('.pane-rail')) {
    rail.addEventListener('click', () => setPaneCollapsed(rail.dataset.target, false));
  }
  // Apply the narrow-viewport default once at boot and again whenever the
  // viewport crosses the 1280 threshold (e.g. window resize / orientation
  // change). Crossing back above 1280 leaves the user's current pane state
  // alone — we only auto-collapse, never auto-expand.
  applyNarrowViewportDefault();
  const mql = window.matchMedia(`(max-width: ${NARROW_PANE_BREAKPOINT_PX - 1}px)`);
  const onChange = (e) => {
    if (e.matches) applyNarrowViewportDefault();
  };
  if (mql.addEventListener) mql.addEventListener('change', onChange);
  else if (mql.addListener) mql.addListener(onChange);
}

function attachEventHandlers() {
  // PR-11 — the persona dropdown change handler is removed. Persona
  // switching now flows exclusively through .persona-card clicks in
  // buildPersonaList (same setPersona / rebuildAndRender path,
  // emitPersonaLoad still fires from rebuildAndRender's chain).
  // LFI segmented control — replaces the v1 dropdown with a visible lever.
  for (const btn of document.querySelectorAll('#lfi-seg button[data-lfi]')) {
    btn.addEventListener('click', () => {
      const from = state.lfi;
      const to = btn.dataset.lfi;
      if (from === to) return;
      state.lfi = to;
      rebuildAndRender();
      track('lfi_switch', { from, to });
    });
  }
  // Compare toggle — adds a partner LFI row that drives EXP-16 side-by-side.
  document.getElementById('compare-toggle')?.addEventListener('click', () => {
    state.compareMode = !state.compareMode;
    if (state.compareMode && state.compareWith === state.lfi) {
      // Sensible default partner — anything other than the active LFI.
      state.compareWith = state.lfi === 'sparse' ? 'rich' : 'sparse';
    }
    syncControls();
    renderPayload();
  });
  document.getElementById('compare-close')?.addEventListener('click', () => {
    state.compareMode = false;
    syncControls();
    renderPayload();
  });
  document.getElementById('compare-swap')?.addEventListener('click', () => {
    const tmp = state.lfi;
    state.lfi = state.compareWith;
    state.compareWith = tmp;
    rebuildAndRender();
    track('lfi_switch', { from: tmp, to: state.lfi });
  });
  for (const btn of document.querySelectorAll('#lfi-seg-compare button[data-cmp-lfi]')) {
    btn.addEventListener('click', () => {
      const from = state.compareWith;
      const to = btn.dataset.cmpLfi;
      if (from === to) return;
      state.compareWith = to;
      syncControls();
      renderPayload();
      track('lfi_switch', { from, to });
    });
  }
  document.getElementById('seed-input')?.addEventListener('change', (e) => {
    const n = Number(e.target.value);
    if (Number.isFinite(n)) {
      state.seed = n;
      rebuildAndRender();
    }
  });
  document.getElementById('seed-reset')?.addEventListener('click', () => {
    const persona = state.data.personas[state.personaId];
    const def = Number(persona?.default_seed);
    state.seed = Number.isFinite(def) ? def : 1;
    rebuildAndRender();
  });
  // D-10 — language toggle. Flips <html lang/dir>, re-translates the chrome,
  // and (since the persona showcase + amounts are re-derived) rebuilds the
  // active view. Numerals follow the language by default but the user can
  // override them via the numeral toggle afterwards.
  for (const btn of document.querySelectorAll('#lang-seg button[data-lang]')) {
    btn.addEventListener('click', async () => {
      const from = state.lang;
      const to = normalizeLocale(btn.dataset.lang);
      if (from === to) return;
      state.lang = to;
      state.numerals = to === 'ar' ? 'arab' : 'latn';
      // Flip <html dir>/chrome immediately for a responsive feel, then merge
      // the lazy locale content (cached after the first switch) before the
      // persona re-render so localized names/narratives are available.
      applyLocale();
      await ensureLocaleData(to);
      rebuildAndRender();
      // No analytics event: the EXP-21 allowlist is a governed contract;
      // adding `lang_switch` is deferred to a deliberate allowlist update.
    });
  }
  // D-10 — numeral-system toggle (independent of language per the spec).
  for (const btn of document.querySelectorAll('#numeral-seg button[data-numerals]')) {
    btn.addEventListener('click', () => {
      const to = btn.dataset.numerals === 'arab' ? 'arab' : 'latn';
      if (state.numerals === to) return;
      state.numerals = to;
      applyLocale();
      rebuildAndRender();
    });
  }
  document.getElementById('view-rendered')?.addEventListener('click', () => {
    if (state.view === 'rendered') return;
    state.view = 'rendered';
    renderPayload();
    track('raw_json_toggle', { mode: 'rendered' });
  });
  document.getElementById('view-raw')?.addEventListener('click', () => {
    if (state.view === 'raw') return;
    state.view = 'raw';
    renderPayload();
    track('raw_json_toggle', { mode: 'raw' });
  });
  document.getElementById('toggle-expand-all')?.addEventListener('change', (e) => {
    state.expandFields = !!e.target.checked;
    renderPayload();
  });
  document.getElementById('toggle-pii-only')?.addEventListener('change', (e) => {
    state.piiOnly = !!e.target.checked;
    renderPayload();
  });
  // PR #6 — unified Export popover replaces the JSON / CSV / Tarball /
  // Embed button row and the toolbar Share button.
  document.getElementById('export-toggle')?.addEventListener('click', () => {
    exportPopover.open();
  });
  document.getElementById('tour-btn')?.addEventListener('click', () => startTour());
  document.getElementById('find-btn')?.addEventListener('click', openFind);
  // ⌘K / Ctrl+K opens the find box; ⌘E / Ctrl+E opens the Export popover.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openFind();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      exportPopover.open();
    } else if (e.key === 'Escape') {
      if (exportPopover.isOpen) {
        exportPopover.close();
        return;
      }
      if (document.getElementById('find-overlay')) closeFind();
    }
  });
}

function setPersona(personaId, lfi) {
  state.personaId = personaId;
  state.navAccountCollapsed.clear();
  if (lfi) state.lfi = lfi;
  rebuildAndRender();
}

function exportContext() {
  return {
    personaId: state.personaId,
    lfi: state.lfi,
    seed: state.seed,
    specVersion: state.spec?.specVersion,
    specSha: state.spec?.pinSha,
    retrievedAt: new Date().toISOString(),
  };
}

function activeEnvelopeKey() {
  if (state.endpoint === '/accounts' || state.endpoint === '/parties') return state.endpoint;
  if (state.selectedAccountId) {
    const tail = state.endpoint.replace('{AccountId}', state.selectedAccountId);
    return tail;
  }
  return state.endpoint;
}

function exportActiveJson() {
  if (!state.bundle) return;
  const ctx = exportContext();
  const envelopes = envelopesFromBundle(state.bundle, ctx);
  const key = activeEnvelopeKey();
  const env = envelopes[key] ?? envelopes[state.endpoint];
  if (!env) return;
  const fname = `${state.personaId}-${state.lfi}-seed${state.seed}-${key.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '') || 'root'}.json`;
  downloadJson(env, fname);
}

// Picks the bundle key + filename suffix for the active endpoint's CSV.
// Shared by exportActiveCsv (download) and buildActiveCsvString (popover).
const RESOURCE_FOR_ENDPOINT = Object.freeze({
  '/accounts': ['accounts', 'Account'],
  '/accounts/{AccountId}': ['accounts', 'Account'],
  '/accounts/{AccountId}/balances': ['balances', 'Balance'],
  '/accounts/{AccountId}/transactions': ['transactions', 'Transaction'],
  '/accounts/{AccountId}/standing-orders': ['standingOrders', 'StandingOrder'],
  '/accounts/{AccountId}/direct-debits': ['directDebits', 'DirectDebit'],
  '/accounts/{AccountId}/beneficiaries': ['beneficiaries', 'Beneficiary'],
  '/accounts/{AccountId}/scheduled-payments': ['scheduledPayments', 'ScheduledPayment'],
  '/accounts/{AccountId}/product': ['product', 'Product'],
  '/accounts/{AccountId}/parties': ['parties', 'Party'],
  '/parties': ['callingUserParty', 'Party'],
  '/accounts/{AccountId}/statements': ['statements', 'Statements'],
});
function buildActiveCsvString() {
  if (!state.bundle) return '';
  const ctx = exportContext();
  const [bundleKey] = RESOURCE_FOR_ENDPOINT[state.endpoint] ?? ['accounts', 'Account'];
  let rows = state.bundle[bundleKey] ?? [];
  if (state.selectedAccountId && Array.isArray(rows)) {
    rows = rows.filter((r) => !r._accountId || r._accountId === state.selectedAccountId);
  }
  if (!Array.isArray(rows)) rows = [rows];
  return csvForResource(rows, ctx);
}
function exportActiveCsv() {
  if (!state.bundle) return;
  const [, resourceLabel] = RESOURCE_FOR_ENDPOINT[state.endpoint] ?? ['accounts', 'Account'];
  const csv = buildActiveCsvString();
  const fname = `${state.personaId}-${state.lfi}-seed${state.seed}-${resourceLabel}.csv`;
  downloadCsv(csv, fname);
}

function exportTarball() {
  if (!state.bundle) return;
  const ctx = exportContext();
  downloadTarball(state.bundle, ctx, `${state.personaId}-${state.lfi}-seed${state.seed}.tar`);
}

function rebuildAndRender() {
  // 120ms fade — visually confirms "the data just changed" when the user
  // switches persona / LFI / seed. Ignored when prefers-reduced-motion is set
  // (the CSS rule kills the transition).
  const body = document.getElementById('payload-body');
  body?.classList.add('is-fading');

  const persona = state.data.personas[state.personaId];
  try {
    state.bundle = buildBundle({
      persona,
      lfi: state.lfi,
      seed: state.seed,
      pools: state.data.pools,
      now: new Date(state.data.buildInfo.nowIso),
    });
  } catch (err) {
    // Bundle-level error boundary (counterpart to EXP-26 at the field
    // level). A malformed persona manifest, a generator regression, or a
    // missing pool reference reaches us here. Render an in-pane fallback
    // with the active (persona, lfi, seed) tuple and a "Report this" link
    // pre-filled against the GitHub issue tracker rather than letting the
    // page go blank.
    renderBundleError(err, persona);
    body?.classList.remove('is-fading');
    return;
  }

  if (state.domain === 'insurance') {
    // Phase 2.0 motor full-coverage: insurance bundles render through a
    // domain-aware navigator + per-endpoint payload renderer (status badges
    // from the parsed insurance spec), replacing the bundle-wide JSON
    // inspector. Compare-LFIs / underwriting / banking-shaped coverage are
    // still banking-only — those are derived views with no insurance analogue.
    renderTopbarPersona();
    renderInsuranceBundle();
    pushPermalink();
    setTimeout(() => body?.classList.remove('is-fading'), 30);
    return;
  }
  if (state.domain === 'atm') {
    // Phase 2.3 — ATM Locator. The persona library is replaced by an ATM
    // picker rail; the right pane renders the selected ATM as a field tree.
    // There is no customer behind an ATM directory, so the topbar persona
    // slot is collapsed.
    const slot = document.getElementById('topbar-persona');
    if (slot) slot.classList.add('is-empty');
    renderAtmBundle();
    pushPermalink();
    setTimeout(() => body?.classList.remove('is-fading'), 30);
    return;
  }

  state.selectedAccountId = state.bundle.accounts[0]?.AccountId ?? null;
  state.txFilter = emptyTxFilter();
  state.txSort = { column: null, dir: 'asc' };
  state.txHighlight = new Set();
  state.crossLink = null;
  syncControls();
  renderTopbarPersona();
  renderNavigator();
  renderPayload();
  renderCoverage();
  pushPermalink();

  setTimeout(() => body?.classList.remove('is-fading'), 30);
}

// PR-10 — persona slot inside the topbar (renamed from PR #3's standalone
// hero). Avatar + name + a one-line tagline derived from the first
// sentence of the persona narrative. JTBD chips are dropped from the
// topbar slot — the left-pane scenario tabs (.jtbd-rail) are the
// canonical scenario filter surface post-PR #3. State changes (persona
// switch, custom-persona expand, domain switch) all flow through
// renderTopbarPersona() via rebuildAndRender / renderInsuranceBundle.
// D-10 — locale content overlay. Arabic display names + narratives are split
// out of the eagerly-preloaded data.json (tools/build-data.mjs) to keep the
// default English critical path lean; they're fetched once and merged into the
// loaded personas the first time the UI resolves to a non-default locale. The
// merge is idempotent (cached in `_localesMerged`) and a failed/absent fetch
// degrades silently to the English fallback in localizedName/localizedNarrative.
const _localesMerged = new Set();
let _localeOverlayPromise = null;
async function ensureLocaleData(lang) {
  if (lang === DEFAULT_LOCALE || _localesMerged.has(lang) || !state.data?.personas) return;
  if (!_localeOverlayPromise) {
    _localeOverlayPromise = fetch('../dist/data.i18n.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  const table = (await _localeOverlayPromise)?.[lang];
  if (table) {
    for (const [personaId, fields] of Object.entries(table)) {
      const persona = state.data.personas[personaId];
      if (persona) Object.assign(persona, fields);
    }
  }
  _localesMerged.add(lang);
}

// D-10 — pick the Arabic display name / narrative when the UI is in Arabic
// and the persona carries one (name_ar / narrative_ar, merged on demand by
// ensureLocaleData); otherwise fall back to the English text.
function localizedName(persona) {
  if (!persona) return '';
  if (state.lang === 'ar' && persona.name_ar) return persona.name_ar;
  return persona.name ?? '';
}
function localizedNarrative(persona) {
  if (!persona) return '';
  if (state.lang === 'ar' && persona.narrative_ar) return persona.narrative_ar;
  return persona.narrative ?? '';
}
function deriveTagline(persona, maxLen = 140) {
  const narrative = localizedNarrative(persona).trim();
  if (!narrative) return '';
  // First sentence — break on ". " then strip trailing period. Falls back
  // to the full narrative truncated when there's no sentence boundary.
  const firstStop = narrative.indexOf('. ');
  const first = firstStop > 0 ? narrative.slice(0, firstStop + 1) : narrative;
  const collapsed = first.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen - 1).trimEnd()}…`;
}
function jtbdFamiliesForPersona(persona) {
  const terms = persona?.stress_coverage ?? [];
  const presets = getJtbdPresets(state.domain);
  const matched = [];
  for (const [key, preset] of Object.entries(presets)) {
    if (terms.some((t) => preset.terms.includes(t))) {
      matched.push({ key, label: preset.label });
    }
  }
  return matched;
}
function renderTopbarPersona() {
  const slot = document.getElementById('topbar-persona');
  if (!slot) return;
  const persona = state.data?.personas?.[state.personaId];
  if (!persona) {
    slot.classList.add('is-empty');
    return;
  }
  slot.classList.remove('is-empty');

  const avatarSlot = document.getElementById('topbar-persona-avatar');
  avatarSlot.replaceChildren(personaAvatarEl(state.personaId, persona, 'sm'));

  const nameEl = document.getElementById('topbar-persona-name');
  const displayName = localizedName(persona) || state.personaId;
  nameEl.textContent = displayName;
  nameEl.setAttribute('title', displayName);

  const tag = deriveTagline(persona);
  const tagEl = document.getElementById('topbar-persona-tagline');
  tagEl.textContent = tag;
  // Full tagline in title so a truncated row stays inspectable on hover.
  tagEl.setAttribute('title', tag);
}

// PR #7 — inline banner shown when Compare-with is on but the active
// endpoint is a derived view (Underwriting summary / Persona overview)
// where the split-pane diff has no meaningful field-level analogue.
function renderCompareNaBanner(viewName) {
  return el('div', {
    class: 'compare-na-banner',
    attrs: { role: 'note' },
    text:
      `Comparison applies to field-level endpoints (e.g. /transactions, /accounts/{AccountId}/balances). ` +
      `${viewName} is a derived view — the populate-rate diff has no analogue here.`,
  });
}

function renderBundleError(err, persona) {
  const body = document.getElementById('payload-body');
  if (!body) return;
  const message = String(err?.message ?? err);
  const issueTitle = `[bundle-error] ${state.personaId} / ${state.lfi} / seed ${state.seed} — ${message.slice(0, 80)}`;
  const issueBody = [
    '## Bundle build failed',
    `- **Persona:** \`${state.personaId}\``,
    `- **Domain:** \`${persona?.domain ?? 'unknown'}\``,
    `- **LFI profile:** \`${state.lfi}\``,
    `- **Seed:** \`${state.seed}\``,
    `- **Pinned spec SHA:** \`${state.spec?.pinSha ?? 'unknown'}\``,
    '',
    '## Error',
    '```',
    message,
    '```',
    '',
    '## What you were doing',
    '<!-- describe -->',
    '',
  ].join('\n');
  const params = new URLSearchParams();
  params.set('title', issueTitle);
  params.set('body', issueBody);
  const issueUrl = `https://github.com/openfinance-os/data-sandbox/issues/new?${params.toString()}`;

  body.replaceChildren(
    el(
      'div',
      {
        class: 'bundle-error',
        attrs: {
          role: 'alert',
          style:
            'padding:16px;border:1px solid #c33;background:#fee;color:#600;border-radius:6px;margin:12px',
        },
      },
      el('strong', { text: 'Couldn’t build this bundle.' }),
      el('p', { text: `${state.personaId} · ${state.lfi} · seed ${state.seed}` }),
      el('pre', {
        text: message,
        attrs: {
          style:
            'white-space:pre-wrap;background:#fff;padding:8px;border-radius:4px;border:1px solid #fbb',
        },
      }),
      el(
        'p',
        {},
        el('a', {
          text: 'Report this on GitHub →',
          attrs: { href: issueUrl, target: '_blank', rel: 'noopener noreferrer' },
        }),
      ),
    ),
  );

  console.error('buildBundle failed', err);
}

// Slice 8b: visible domain selector. The chip lists every domain from
// dist/domains.json; preview-status domains carry a "(preview)" tag.
function renderDomainChip() {
  const chip = document.getElementById('domain-chip');
  if (!chip) return;
  chip.hidden = false;
  chip.replaceChildren();
  for (const dom of Object.values(state.domains)) {
    const opt = document.createElement('option');
    opt.value = dom.id;
    opt.textContent = dom.status === 'preview' ? `${dom.label} (preview)` : dom.label;
    if (dom.id === state.domain) opt.selected = true;
    chip.appendChild(opt);
  }
  // Use onchange (not addEventListener) so multiple renderDomainChip calls
  // don't stack handlers.
  chip.onchange = (e) => {
    const next = e.target.value;
    if (next !== state.domain) void switchDomain(next);
  };
}

async function switchDomain(newDomain) {
  const entry = state.domains?.[newDomain];
  if (!entry) return;
  const specRes = await fetch(`..${entry.parsedJsonUrl}`);
  state.spec = await specRes.json();
  const leavingAtm = state.domain === 'atm' && newDomain !== 'atm';
  state.domain = newDomain;
  state.activePersonas = Object.fromEntries(
    Object.entries(state.data.personas).filter(([, p]) => p.domain === newDomain),
  );
  state.personaId = Object.keys(state.activePersonas)[0];
  state.navAccountCollapsed.clear();
  state.endpoint = entry.defaultEndpoint || Object.keys(state.spec.endpoints)[0];
  // Reset ATM selection when entering or leaving the ATM domain so a
  // stale ATMId from a prior session doesn't leak across domain switches.
  state.atmId = null;
  state.atmFilter = '';
  if (leavingAtm && typeof _atmRestorePersonaChrome === 'function') {
    _atmRestorePersonaChrome();
  }
  // Refresh topbar metadata to reflect the active spec.
  const v = String(state.spec.specVersion || '');
  const versionLabel = v.startsWith('v') ? v : `v${v}`;
  const pin = document.getElementById('version-pin');
  if (pin) {
    pin.textContent = `${versionLabel} @ ${(state.spec.pinSha || '').slice(0, 7)}`;
    pin.title = `Pinned spec SHA ${state.spec.pinSha}\nRetrieved ${state.spec.retrievedAt}\nUpstream: ${state.spec.upstreamRepo}/${state.spec.upstreamPath}`;
  }
  buildSegmentRail();
  buildJtbdRail();
  buildPersonaList();
  renderDomainChip();
  rebuildAndRender();
  emitPersonaLoad();
}

function pushPermalink() {
  // Phase 0: keep the current pathname; only update the query string. Phase 1
  // will switch to the §6.8 permalink shape (/commons/[slug]/p/<id>?...) once
  // the Commons publication path is live.
  const params = new URLSearchParams();
  params.set('persona', state.personaId);
  params.set('lfi', state.lfi);
  params.set('seed', String(state.seed));
  // Slice 8: domain + preview round-trip. Banking is the default and stays
  // implicit so existing permalinks remain unchanged.
  if (state.domain && state.domain !== 'banking') params.set('domain', state.domain);
  // D-10 — emit language only when non-default (English stays implicit so
  // existing permalinks round-trip unchanged).
  if (state.lang && state.lang !== 'en') params.set('lang', state.lang);
  if (state.preview) params.set('preview', '1');
  // EXP-17: encode the active endpoint so Share copies "where the user
  // currently is", not the cold-landing default. Account scope is implicit —
  // selectedAccountId is always the first account of the active persona on
  // hydrate, so we don't need to round-trip it. The two pseudo-endpoints
  // (overview, underwriting) are the cold-landing defaults; emitting them
  // would just clutter the URL, so they stay implicit.
  if (
    state.endpoint &&
    state.endpoint !== '/accounts' &&
    state.endpoint !== OVERVIEW_PSEUDO &&
    state.endpoint !== UNDERWRITING_PSEUDO
  ) {
    params.set('endpoint', state.endpoint);
  }
  // Workstream B — emit the recipe param when the active persona is the
  // ephemeral custom one, so the URL fully describes the bundle.
  if (state.personaId === CUSTOM_PERSONA_SLUG && state.recipe) {
    params.set('recipe', encodeRecipe(state.recipe));
  }
  // Phase R1.5 — enriched view toggle. Emit only when ON so existing
  // shareable raw-view permalinks stay byte-identical.
  if (state.enriched) params.set('enriched', '1');
  // Phase 2.3 — ATM Locator selection. Only emitted on the ATM domain;
  // round-trips the drill-down so a share-link reopens at the same ATM.
  if (state.domain === 'atm' && state.atmId) {
    params.set('atm', state.atmId);
  }
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', next);
}

function renderCoverage() {
  const cov = coverage(state.bundle);
  const byBand = coverageByBand(state.bundle);
  document.getElementById('coverage-pct').textContent = `${cov.pct}%`;

  const host = document.getElementById('coverage-bands');
  if (!host) return;
  host.replaceChildren();
  // 4-cell strips per §7.3 band — Universal first (always-on), then Common,
  // Variable, Rare. Each cell = 25% of the band's populated/total ratio.
  // A band with no probes (Rare today) renders as is-empty so its semantic
  // slot stays visible, signalling "no curated probes for this band yet".
  const order = ['Universal', 'Common', 'Variable', 'Rare'];
  for (const band of order) {
    const b = byBand[band];
    const cells = 4;
    const filled = b.total > 0 ? Math.round((b.populated / b.total) * cells) : 0;
    const wrap = el('span', {
      class: `coverage-band${b.total === 0 ? ' is-empty' : ''}`,
      attrs: {
        'data-band': band,
        title:
          b.total === 0
            ? `${band} band: no curated probes yet (Phase 1 starter — widens as the spec parser feeds bands directly).`
            : `${band} band — ${b.populated} of ${b.total} populated (${b.pct}%). ${MEDIAN_HINT[band] ?? ''}`,
      },
    });
    wrap.appendChild(el('span', { class: 'band-label', text: band[0] }));
    const cellRow = el('span', { class: 'band-cells' });
    for (let i = 0; i < cells; i += 1) {
      cellRow.appendChild(el('span', { class: `band-cell${i < filled ? ' is-on' : ''}` }));
    }
    wrap.appendChild(cellRow);
    host.appendChild(wrap);
  }
}

// PR #8 — per-resource icons on per-account endpoints. Decorative-only;
// the readable label stays the source of truth and screen readers see
// the label text (icons are aria-hidden).
const ENDPOINT_ICONS = Object.freeze({
  '/accounts/{AccountId}': '☰',
  '/accounts/{AccountId}/balances': '⚖',
  '/accounts/{AccountId}/transactions': '⇄',
  '/accounts/{AccountId}/standing-orders': '↻',
  '/accounts/{AccountId}/direct-debits': '⇊',
  '/accounts/{AccountId}/beneficiaries': '⌂',
  '/accounts/{AccountId}/scheduled-payments': '⏱',
  '/accounts/{AccountId}/parties': '⚑',
  '/accounts/{AccountId}/product': '◑',
  '/accounts/{AccountId}/statements': '▤',
});

function renderNavigator() {
  const nav = document.getElementById('nav-tree');
  nav.replaceChildren();

  // Bundle-scoped endpoints get their own header section at the top.
  // Stays a plain <div> — not collapsible since the bundle section is the
  // user's entry point to derived views (overview / underwriting).
  const bundleSection = el('div', { class: 'nav-account is-bundle' });
  bundleSection.appendChild(el('div', { class: 'nav-account-header', text: 'Bundle' }));
  for (const ep of BUNDLE_SCOPED_PATHS) {
    const isActive = state.endpoint === ep;
    bundleSection.appendChild(
      navButton({
        endpoint: ep,
        accountId: null,
        active: isActive,
        onSelect: () => {
          state.endpoint = ep;
          state.selectedAccountId = null;
          clearTxState();
          renderNavigator();
          renderPayload();
          track('endpoint_nav', { endpoint: ep, domain: state.domain });
        },
      }),
    );
  }
  nav.appendChild(bundleSection);

  // PR #8 — per-account endpoint group is now a collapsible <details>
  // element. Open by default; the user can collapse to free vertical
  // space when many accounts are present (HNW / multi-currency personas).
  // PR-13 (Greptile P1) — every renderNavigator() call rebuilds the list
  // with replaceChildren(), so the previous code that unconditionally
  // set open='open' silently re-opened any account the user had
  // collapsed on every endpoint navigation. The owning account is
  // force-open so the active endpoint stays visible; every other
  // account respects state.navAccountCollapsed (a JS-only Set, EXP-22
  // safe) so user toggles persist across re-renders within the session.
  for (const acc of state.bundle.accounts) {
    const isOwning = state.selectedAccountId === acc.AccountId;
    const userCollapsed = state.navAccountCollapsed.has(acc.AccountId);
    const shouldBeOpen = isOwning || !userCollapsed;
    const attrs = { 'data-account-id': acc.AccountId };
    if (shouldBeOpen) attrs.open = 'open';
    const wrap = el('details', { class: 'nav-account', attrs });
    wrap.addEventListener('toggle', () => {
      if (wrap.open) state.navAccountCollapsed.delete(acc.AccountId);
      else state.navAccountCollapsed.add(acc.AccountId);
    });
    const summary = el('summary', {
      class: 'nav-account-header',
      text: `${acc.AccountSubType} · ${acc.AccountIdentifiers?.[0]?.Identification?.slice(0, 12) ?? acc.AccountId}…`,
    });
    wrap.appendChild(summary);
    for (const ep of ACCOUNT_SCOPED_PATHS) {
      const isActive = state.endpoint === ep && state.selectedAccountId === acc.AccountId;
      wrap.appendChild(
        navButton({
          endpoint: ep,
          accountId: acc.AccountId,
          active: isActive,
          onSelect: () => {
            state.endpoint = ep;
            state.selectedAccountId = acc.AccountId;
            clearTxState();
            renderNavigator();
            renderPayload();
            track('endpoint_nav', { endpoint: ep, domain: state.domain });
          },
        }),
      );
    }
    nav.appendChild(wrap);
  }
}

// Build a navigator button with an inline coverage sub-meter (EXP-15 second
// half). For bundle-scoped endpoints the sub-meter is omitted; for per-account
// endpoints it shows the populate-rate of optional fields under that scope.
// PR #8 — the visible numeric "50%" badge is replaced by a tooltip that
// surfaces the underlying populated/total ratio; the bar itself stays as
// the at-a-glance affordance.
function navButton({ endpoint, accountId, active, onSelect }) {
  const isVirtual = endpoint === UNDERWRITING_PSEUDO || endpoint === OVERVIEW_PSEUDO;
  const btn = el('button', {
    class: `nav-endpoint${active ? ' active' : ''}${isVirtual ? ' nav-virtual' : ''}`,
    attrs: { 'aria-current': active ? 'true' : null },
    dataset: { endpoint, accountId: accountId ?? '' },
    onClick: onSelect,
  });
  // Per-resource icon prefix (PR #8). Decorative — aria-hidden so screen
  // readers fall through to the label.
  const icon = ENDPOINT_ICONS[endpoint];
  if (icon) {
    btn.appendChild(
      el('span', { class: 'nav-endpoint-icon', text: icon, attrs: { 'aria-hidden': 'true' } }),
    );
  }
  // Pseudo-endpoints (overview, underwriting summary) get friendlier labels
  // so they read clearly as derived views rather than spec wire endpoints.
  let label = endpoint;
  if (endpoint === UNDERWRITING_PSEUDO) label = '◇ Underwriting summary';
  else if (endpoint === OVERVIEW_PSEUDO) label = '◇ Persona overview';
  btn.appendChild(el('span', { class: 'nav-endpoint-label', text: label }));
  if (accountId) {
    const cov = coverageForEndpoint(state.bundle, endpoint, accountId);
    if (cov.total > 0) {
      // Coverage-band drives the gradient applied via CSS — amber → green
      // so a 30% sub-meter reads as warmer than a 90% one.
      const band = cov.pct < 25 ? 'low' : cov.pct < 66 ? 'medium' : 'high';
      btn.dataset.coverageBand = band;
      const tooltip = `Optional-field coverage: ${cov.populated} of ${cov.total} populated (${cov.pct}%).`;
      const meter = el('span', {
        class: 'nav-submeter',
        attrs: { 'aria-label': tooltip, title: tooltip },
      });
      const fill = el('span', { class: 'nav-submeter-fill' });
      fill.style.width = `${cov.pct}%`;
      meter.appendChild(fill);
      btn.appendChild(meter);
    }
  }
  return btn;
}

function clearTxState() {
  state.txFilter = emptyTxFilter();
  state.txSort = { column: null, dir: 'asc' };
  state.txHighlight = new Set();
  state.crossLink = null;
}

function rowsForActiveEndpoint() {
  const acc = state.bundle.accounts.find((a) => a.AccountId === state.selectedAccountId);
  switch (state.endpoint) {
    case '/accounts':
      return state.bundle.accounts;
    case '/parties':
      return state.bundle.callingUserParty ? [state.bundle.callingUserParty] : [];
    case '/accounts/{AccountId}':
      return acc ? [acc] : [];
    case '/accounts/{AccountId}/balances':
      return acc ? state.bundle.balances.filter((b) => b._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/transactions':
      return acc ? state.bundle.transactions.filter((t) => t._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/standing-orders':
      return acc ? state.bundle.standingOrders.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/direct-debits':
      return acc ? state.bundle.directDebits.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/beneficiaries':
      return acc ? state.bundle.beneficiaries.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/scheduled-payments':
      return acc
        ? state.bundle.scheduledPayments.filter((x) => x._accountId === acc.AccountId)
        : [];
    case '/accounts/{AccountId}/product':
      return acc ? state.bundle.product.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/parties':
      return acc ? state.bundle.parties.filter((x) => x._accountId === acc.AccountId) : [];
    case '/accounts/{AccountId}/statements':
      return acc ? state.bundle.statements.filter((x) => x._accountId === acc.AccountId) : [];
    default:
      return [];
  }
}

function endpointFieldsByName() {
  const fields = leafFields(state.spec, state.endpoint);
  const out = new Map();
  for (const f of fields) out.set(f.name, f);
  return out;
}

function renderPayload() {
  try {
    renderPayloadUnsafe();
  } catch (err) {
    // Error boundary — without this, a throw mid-render leaves an empty
    // body and only a console trace. The toggle handlers (view, expand,
    // pii) all call renderPayload directly, so any failure here would
    // otherwise blank the pane until full reload. Surface it instead.
    console.error('renderPayload failed', err);
    const body = document.getElementById('payload-body');
    if (body) {
      body.replaceChildren();
      body.appendChild(
        el(
          'div',
          {
            class: 'payload-error',
            attrs: { role: 'alert' },
          },
          el('strong', { text: 'Failed to render payload.' }),
          el('p', { text: 'See the browser console for details.' }),
          el('pre', { text: String(err && err.stack ? err.stack : err) }),
        ),
      );
    }
  }
}

function renderPayloadUnsafe() {
  document.getElementById('endpoint-label').textContent = labelForEndpoint(state.endpoint);
  const body = document.getElementById('payload-body');
  body.replaceChildren();

  // Non-banking domains share the toolbar (view tabs, expand-fields,
  // pii-only) with banking, but the renderPayload pipeline below is
  // banking-shaped (rowsForActiveEndpoint walks state.bundle.accounts,
  // which insurance/ATM bundles don't have). Mirror the rebuildAndRender
  // domain dispatch so any toggle handler can safely re-render a
  // non-banking bundle.
  if (state.domain === 'insurance') {
    renderInsuranceBundle();
    return;
  }
  if (state.domain === 'atm') {
    renderAtmBundle();
    return;
  }

  // Cold-landing welcome — three jump cards routing the user to the surface
  // that matches their JTBD (Sara explore vs. Maryam embed vs. Hamid
  // fixtures). Lives at the top of the payload area; one-shot, dismissed
  // via JS state once the user picks a path.
  if (state.welcomeShown && !state.welcomeDismissed) {
    body.appendChild(renderWelcomeCards());
  }

  // EXP-18 Underwriting Scenario panel — a derived view, not a spec endpoint.
  if (state.endpoint === UNDERWRITING_PSEUDO) {
    // PR #7 — Compare-with doesn't apply to derived views; show the inline
    // banner so the user understands why the split pane isn't rendering.
    if (state.compareMode) body.appendChild(renderCompareNaBanner('Underwriting summary'));
    renderUnderwritingPanel(body);
    return;
  }
  // Persona overview — the natural landing on persona-switch.
  if (state.endpoint === OVERVIEW_PSEUDO) {
    if (state.compareMode) body.appendChild(renderCompareNaBanner('Persona overview'));
    renderPersonaOverview(body);
    return;
  }

  const allRows = rowsForActiveEndpoint();
  const fieldsByName = endpointFieldsByName();

  syncViewTabs(state.view);

  // Compare-LFIs is a parallel rendering mode driven by state.compareMode
  // (orthogonal to state.view: representation × cardinality). Either
  // branch can be re-entered without losing the other axis.
  if (state.compareMode) {
    renderCompareView(body);
    return;
  }

  // Filter + sort apply only to the /transactions view.
  const isTransactions = state.endpoint === '/accounts/{AccountId}/transactions';

  if (state.view === 'raw') {
    const rowsToRender = isTransactions ? applyFilter(allRows) : allRows;
    const pre = el('pre', {
      class: 'payload-raw',
      text: JSON.stringify(rowsToRender.map(stripInternal), null, 2),
    });
    body.appendChild(pre);
    return;
  }

  if (allRows.length === 0) {
    const wrap = el(
      'div',
      { class: 'payload-rendered' },
      el('p', { text: 'No records.', attrs: { style: 'color:var(--text-muted)' } }),
    );
    body.appendChild(wrap);
    return;
  }

  if (isTransactions) {
    body.appendChild(renderTxFilterBar(allRows));
    if (state.crossLink) body.appendChild(renderCrossLinkBanner());
    // Sara's primary JTBD-1.1/1.2 lives on /transactions. Dock a compact
    // 4-stat strip so the underwriting signals are one glance away
    // without leaving the wire view; clicking opens the full panel.
    body.appendChild(renderUnderwritingStrip());
    const nsfCount = allRows.filter((t) => t.Status === 'Rejected').length;
    if (nsfCount > 0) {
      body.appendChild(
        el('div', {
          class: 'distress-summary',
          attrs: { role: 'status' },
          text: `${nsfCount} rejected debit${nsfCount === 1 ? '' : 's'} in the trailing 12 months — highlighted below.`,
        }),
      );
    }
    // Monthly summary — Sara's anchor JTBD ("two years of transactions").
    // Aggregates from the unfiltered set so the user sees the underlying
    // shape, regardless of any active row filter.
    body.appendChild(renderMonthlySummary(allRows));
  }
  // /product gets a v1.5 hint when the spec defines additional optional
  // blocks the Phase 1 generator doesn't populate (Charges, FinanceRates,
  // RewardsBenefits, AssetBacked).
  if (state.endpoint === '/accounts/{AccountId}/product') {
    body.appendChild(
      el('div', {
        class: 'product-hint',
        text: 'v2.1 defines additional optional blocks for /product (Charges, FinanceRates, DepositRates, AssetBacked, RewardsBenefits) that the Phase 1 generator does not populate. v1.5 widens the generator to cover them — track via the field card spec links.',
      }),
    );
  }

  let rows = isTransactions ? applyFilter(allRows) : allRows;
  if (isTransactions) rows = applySort(rows);

  if (rows.length === 0) {
    body.appendChild(
      el('p', {
        text: 'No transactions match the active filter.',
        attrs: { style: 'color:var(--text-muted);padding:8px 12px' },
      }),
    );
    return;
  }

  // Phase R1.5 — enrichment overlay. When state.enriched is on and we're
  // looking at /transactions, fold every row's matching sidecar record
  // into a derived view that adds two top-level columns (Category,
  // Subcategory) and replaces a missing/redacted MerchantName with the
  // sidecar's clean value. Bundle data is untouched; only the rendered
  // rows change. The headline win is under Sparse, where the LFI profile
  // strips MerchantDetails out of the wire payload but the sidecar still
  // carries the canonical merchant name.
  if (isTransactions && state.enriched) {
    const reg = state.bundle?._enrichment ?? {};
    rows = rows.map((r) => applyEnrichmentOverlay(r, reg[r.TransactionId]));
  }

  // Row-render cap. Unfiltered /transactions hits 2,400+ rows on HNW
  // under the 24-month history window; we cap at 250 to keep first-paint
  // snappy while staying above the natural row-count of any single
  // moderate-volume filter result (e.g. HNW InternationalTransfer ≈ 100
  // tx, ATM ≈ 85, LocalBankTransfer ≈ 50 — all visible in full when the
  // user narrows). 250 is a uniform cap across filtered/unfiltered so
  // the UI semantics stay simple: a filter always narrows monotonically.
  const visible = rows.slice(0, 250);
  const allKeys = new Set();
  for (const r of visible) for (const k of Object.keys(stripInternal(r))) allKeys.add(k);

  // PII-only filter (Reem) — drop every column whose field is not in the
  // curated PII allowlist. Mandatory or not, only PDPL-relevant columns
  // remain so the user can scope data-handling controls.
  if (state.piiOnly) {
    for (const k of [...allKeys]) if (!isPii(k)) allKeys.delete(k);
    if (allKeys.size === 0) {
      body.appendChild(
        el('div', {
          class: 'pii-empty',
          attrs: { role: 'status' },
          text: 'No PII fields under this endpoint. Personal data lives mostly on /accounts (identifiers, holder name) and /parties — switch to one of those endpoints, or untick "PII only" to see the full payload.',
        }),
      );
      return;
    }
  }

  // Cross-link match counts (EXP-12) — pre-computed per row so the header
  // affordance reads "→ N matching transactions" instead of a quiet hover.
  const jumpFrom = jumpFromForActiveEndpoint();
  const linkedColumn = jumpFrom != null;
  const matchCountByRow = new Map();
  if (linkedColumn) {
    const accTx = (state.bundle.transactions ?? []).filter(
      (t) => t._accountId === state.selectedAccountId,
    );
    for (const r of visible) {
      const n = accTx.filter((t) => jumpFrom.match(t, r)).length;
      matchCountByRow.set(r, n);
    }
  }

  // Sticky leftmost column is most useful on /transactions (the only really
  // wide table). Apply selectively rather than to every endpoint.
  const stickyColClass = isTransactions ? ' has-sticky-col' : '';
  const wrap = el('div', {
    class: `payload-rendered${stickyColClass}${linkedColumn ? ' has-linked-col' : ''}`,
  });
  const table = el('table');
  const headRow = el('tr');
  for (const k of allKeys) {
    const th = el('th');
    const f = fieldsByName.get(k);
    if (f) th.dataset.status = f.status; // drives the status-stripe colour
    if (isTransactions) {
      th.classList.add('sortable');
      if (state.txSort.column === k) th.classList.add(`sort-${state.txSort.dir}`);
      th.addEventListener('click', () => toggleSort(k));
    }
    if (f) {
      th.appendChild(statusPill(f.status));
    }
    const fieldBtn = el('button', {
      class: 'field-name',
      text: k,
      onClick: (e) => {
        e.stopPropagation();
        openFieldCard(k);
      },
    });
    // Hover preview — fast affordance per EXP-14 (within ~100 ms). Click
    // still pins the full card in the right pane.
    attachHoverPreview(fieldBtn, k);
    th.appendChild(fieldBtn);
    if (isPii(k)) {
      th.appendChild(
        el('span', {
          class: 'pii-badge',
          text: 'PII',
          attrs: {
            title: 'Contains PII — PDPL handling controls required (see field card).',
            'aria-label': 'Personal data — PDPL applies',
          },
        }),
      );
    }
    // Real-LFIs guidance as a column-header subtitle — the soul of the
    // product (PRD §5.3) escapes the field card and reads ambiently. Only
    // for non-mandatory fields where the guidance is non-trivial; mandatory
    // fields' "Always present per spec" is already implied by the M pill.
    if (f && f.status !== 'mandatory') {
      const band = bandForFieldName(k, state.endpoint, state.spec);
      th.appendChild(
        el('span', {
          class: 'col-guidance',
          text: realLfisGuidance(f, band),
        }),
      );
    }
    headRow.appendChild(th);
  }
  if (linkedColumn) {
    const linkedTh = el('th', {
      class: 'th-linked',
      attrs: {
        scope: 'col',
        title:
          'Linked transactions — count of /transactions rows that match each record on this endpoint (EXP-12).',
      },
    });
    linkedTh.appendChild(el('span', { class: 'pill pill-linked', text: '→' }));
    linkedTh.appendChild(el('span', { class: 'field-name', text: 'Linked tx' }));
    headRow.appendChild(linkedTh);
  }
  table.appendChild(el('thead', {}, headRow));
  const persona = state.data.personas[state.personaId];
  const tbody = el('tbody');
  // Expand-all — inline field metadata row directly under the headers.
  // Type / format / enum-cardinality detail (the Real-LFIs guidance line
  // is now ambient on every non-mandatory column header, so this row
  // carries the wire-shape detail not the prose).
  if (state.expandFields) {
    const fieldRow = el('tr', { class: 'field-row' });
    for (const k of allKeys) {
      const f = fieldsByName.get(k);
      const td = el('td');
      if (f) {
        const meta = `${f.type}${f.format ? ' · ' + f.format : ''}${Array.isArray(f.enum) ? ` · enum (${f.enum.length})` : ''}`;
        td.appendChild(el('span', { class: 'fr-meta', text: meta }));
        if (Array.isArray(f.enum) && f.enum.length > 0) {
          td.appendChild(
            el('span', {
              class: 'fr-guidance',
              text:
                f.enum.slice(0, 6).join(', ') +
                (f.enum.length > 6 ? `, …(+${f.enum.length - 6})` : ''),
            }),
          );
        }
      } else {
        td.textContent = '—';
      }
      fieldRow.appendChild(td);
    }
    if (linkedColumn) fieldRow.appendChild(el('td'));
    tbody.appendChild(fieldRow);
  }
  for (const r of visible) {
    const stripped = stripInternal(r);
    const isHighlight = isTransactions && r.TransactionId && state.txHighlight.has(r.TransactionId);
    // NSF / distressed rows — Status=Rejected gets a visual marker so AML
    // and underwriting workflows can scan for them.
    const isRejected = r.Status === 'Rejected';
    const trClasses =
      [isHighlight && 'tx-highlight', isRejected && 'tx-rejected'].filter(Boolean).join(' ') ||
      null;
    const tr = el('tr', { class: trClasses });
    for (const k of allKeys) {
      const v = stripped[k];
      const isEmpty = v == null;
      const f = fieldsByName.get(k);
      // Phase R4 — Logo column (only present under the enriched-view
      // overlay). Render as an inline <img> rather than the literal URL
      // string. Tiny size so it sits neatly alongside the MerchantName
      // cell at the typical statement-table density. SVG content is
      // local to the staged origin so no cross-origin / CSP fuss.
      if (k === 'Logo' && typeof v === 'string') {
        const td = el('td', { class: 'tx-logo-cell' });
        const img = el('img', {
          attrs: {
            src: v,
            alt: 'Merchant logo placeholder',
            width: '24',
            height: '24',
            loading: 'lazy',
          },
        });
        td.appendChild(img);
        tr.appendChild(td);
        continue;
      }
      let text;
      if (isEmpty) {
        text = '—';
      } else if (state.humanDates && isDateField(k) && typeof v === 'string') {
        text = humaniseDate(v);
      } else if (typeof v === 'object') {
        text = JSON.stringify(v);
      } else {
        text = String(v);
      }
      const td = el('td', { text });
      // "Why is this empty?" tooltip — for optional/conditional blanks.
      if (isEmpty && f && f.status !== 'mandatory') {
        td.classList.add('cell-absent');
        td.title = whyEmpty({
          field: f,
          lfi: state.lfi,
          persona,
          band: bandForFieldName(k, state.endpoint, state.spec),
        });
      }
      tr.appendChild(td);
    }
    if (linkedColumn) {
      const n = matchCountByRow.get(r) ?? 0;
      const td = el('td', { class: 'td-linked' });
      const btn = el('button', {
        class: `linked-btn${n === 0 ? ' is-empty' : ''}`,
        attrs: {
          type: 'button',
          title:
            n > 0
              ? `Jump to /transactions filtered by ${jumpFrom.label(r)} — ${n} match${n === 1 ? '' : 'es'} highlighted.`
              : `Jump to /transactions filtered by ${jumpFrom.label(r)} — no matches under this LFI / seed (a real signal: under Sparse the filter token may not survive redaction). The banner explains what you'd see if matches existed.`,
        },
        text: n > 0 ? `→ ${n} matching tx` : '→ no matches',
        onClick: (e) => {
          e.stopPropagation();
          crossLinkToTransactions(r, jumpFrom);
        },
      });
      td.appendChild(btn);
      tr.appendChild(td);
      // Whole-row click always fires — even with zero matches the cross-link
      // banner is informative ("0 matches highlighted") and keeps the EXP-12
      // affordance consistent across rows. Empty rows just land on an
      // unfiltered /transactions view with the banner.
      tr.style.cursor = 'pointer';
      tr.title = `Jump to /transactions filtered by ${jumpFrom.label(r)}`;
      tr.addEventListener('click', () => crossLinkToTransactions(r, jumpFrom));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  if (rows.length > visible.length) {
    wrap.appendChild(
      el('p', {
        text: `…${rows.length - visible.length} more rows. Use Raw JSON to see the full set.`,
        attrs: { style: 'color:var(--text-muted);margin-top:8px' },
      }),
    );
  }

  if (isTransactions) {
    wrap.appendChild(
      el('p', {
        class: 'tx-filter-summary',
        text: `${rows.length} of ${allRows.length} transactions${rows.length > visible.length ? ` (showing first ${visible.length})` : ''}.`,
      }),
    );
  }

  body.appendChild(wrap);
}

// ---- Cold-landing welcome cards — route by JTBD bucket ------------------------------------

function renderWelcomeCards() {
  const wrap = el('div', {
    class: 'welcome-cards',
    attrs: { role: 'region', 'aria-label': 'Welcome — three ways to use this' },
  });
  const head = el('div', { class: 'welcome-head' });
  head.appendChild(el('span', { class: 'welcome-eyebrow', text: 'Welcome' }));
  head.appendChild(
    el('button', {
      class: 'welcome-dismiss',
      attrs: { type: 'button', 'aria-label': 'Dismiss welcome' },
      text: '×',
      onClick: () => {
        state.welcomeDismissed = true;
        renderPayload();
      },
    }),
  );
  wrap.appendChild(head);
  wrap.appendChild(el('h3', { class: 'welcome-title', text: 'Three ways to use the sandbox' }));

  const grid = el('div', { class: 'welcome-grid' });

  // Bucket 1 — explore the data (default flow). Closes the welcome and
  // jumps the active endpoint to /transactions on the first account so
  // the user lands on the highest-signal surface.
  grid.appendChild(
    welcomeCard({
      label: 'Explore the data',
      body: 'Walk a synthetic UAE customer end-to-end. Switch the LFI profile to see how field coverage drops; click any field name for spec-grounded guidance.',
      cta: 'Open Sara → Transactions',
      onClick: () => {
        state.welcomeDismissed = true;
        state.endpoint = '/accounts/{AccountId}/transactions';
        state.selectedAccountId = state.bundle.accounts?.[0]?.AccountId ?? null;
        clearTxState();
        renderNavigator();
        renderPayload();
      },
    }),
  );
  // Bucket 2 — embed in your article / class (Maryam, Yusuf).
  grid.appendChild(
    welcomeCard({
      label: 'Embed in your article or class',
      body: 'Drop a chrome-less view of a single persona+endpoint into a slide deck, blog post, or LMS module. Snippet pre-filled to the active state.',
      cta: 'Copy embed snippet',
      onClick: () => {
        state.welcomeDismissed = true;
        copyEmbedSnippet();
        renderPayload();
      },
    }),
  );
  // Bucket 3 — grab fixtures (Priya, Hamid).
  grid.appendChild(
    welcomeCard({
      label: 'Grab fixtures for your tests',
      body: 'Versioned, deterministic test corpus on npm + PyPI under @openfinance-os/sandbox-fixtures (MIT code, CC0 data). Pin to the same SHA the sandbox uses.',
      cta: 'See packaging on About →',
      href: 'about.html#fixtures',
    }),
  );

  wrap.appendChild(grid);
  return wrap;
}

function welcomeCard({ label, body, cta, onClick, href }) {
  const card = el('div', { class: 'welcome-card' });
  card.appendChild(el('div', { class: 'welcome-card-label', text: label }));
  card.appendChild(el('p', { class: 'welcome-card-body', text: body }));
  if (href) {
    card.appendChild(el('a', { class: 'welcome-cta', text: cta, attrs: { href } }));
  } else {
    card.appendChild(
      el('button', { class: 'welcome-cta', attrs: { type: 'button' }, text: cta, onClick }),
    );
  }
  return card;
}

// ---- Persona overview landing — story-level orientation -----------------------------------

function labelForEndpoint(ep) {
  if (ep === UNDERWRITING_PSEUDO) return 'Underwriting summary';
  if (ep === OVERVIEW_PSEUDO) return 'Persona overview';
  return ep;
}

function renderPersonaOverview(body) {
  const persona = state.data.personas[state.personaId];
  if (!persona) return;

  const wrap = el('div', { class: 'persona-overview' });
  const header = el(
    'div',
    { class: 'po-header' },
    personaAvatarEl(state.personaId, persona, 'lg'),
    el(
      'div',
      { class: 'po-header-text' },
      el('div', { class: 'po-archetype', text: humanArchetype(persona.archetype) }),
      el('h2', { text: localizedName(persona) }),
    ),
  );
  wrap.appendChild(header);
  if (persona.narrative) {
    wrap.appendChild(
      el('div', { class: 'po-narrative', text: localizedNarrative(persona).trim() }),
    );
  }

  const grid = el('div', { class: 'po-grid' });

  // Account roster — drawn from the live bundle so it matches what the
  // wire endpoints will show.
  const accCard = el('div', { class: 'po-card' });
  accCard.appendChild(el('div', { class: 'po-card-title', text: 'Accounts' }));
  const accList = el('ul');
  for (const a of state.bundle.accounts ?? []) {
    const id = a.AccountIdentifiers?.[0]?.Identification?.slice(0, 16) ?? a.AccountId;
    accList.appendChild(el('li', { text: `${a.AccountSubType} · ${a.Currency} · ${id}…` }));
  }
  accCard.appendChild(accList);
  grid.appendChild(accCard);

  // Income — straight from the persona manifest.
  if (persona.income) {
    const inc = el('div', { class: 'po-card' });
    inc.appendChild(el('div', { class: 'po-card-title', text: 'Income' }));
    const amt = persona.income.monthly_amount_aed
      ? `AED ${persona.income.monthly_amount_aed.toLocaleString()} / mo`
      : 'Variable';
    inc.appendChild(el('div', { class: 'po-card-value', text: amt }));
    const detail = [
      persona.income.flag_payroll ? 'Carries Flags=Payroll' : 'No Payroll flag',
      persona.income.pay_day ? `Pay-day ${persona.income.pay_day}th` : null,
      persona.income.variability ? `${persona.income.variability} variability` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (detail)
      inc.appendChild(
        el('div', { attrs: { style: 'color:var(--text-muted);font-size:11px' }, text: detail }),
      );
    grid.appendChild(inc);
  }

  // Fixed commitments — quick scan; full detail lives on /standing-orders
  // and /direct-debits.
  if (Array.isArray(persona.fixed_commitments) && persona.fixed_commitments.length > 0) {
    const fc = el('div', { class: 'po-card' });
    fc.appendChild(
      el('div', {
        class: 'po-card-title',
        text: `Fixed commitments (${persona.fixed_commitments.length})`,
      }),
    );
    const fcList = el('ul');
    for (const c of persona.fixed_commitments) {
      const amt = c.amount_aed
        ? `AED ${c.amount_aed.toLocaleString()}`
        : Array.isArray(c.amount_aed_band)
          ? `AED ${c.amount_aed_band[0]}–${c.amount_aed_band[1]}`
          : '—';
      fcList.appendChild(
        el('li', {
          text: `${c.kind === 'standing_order' ? 'SO' : 'DD'} · ${c.purpose} · ${amt} · ${c.schedule}`,
        }),
      );
    }
    fc.appendChild(fcList);
    grid.appendChild(fc);
  }

  // What this persona stresses — drives "why is this in the library?".
  if (Array.isArray(persona.stress_coverage) && persona.stress_coverage.length > 0) {
    const sc = el('div', { class: 'po-card' });
    sc.appendChild(el('div', { class: 'po-card-title', text: 'Stress coverage' }));
    const value = el('div', { class: 'po-card-value persona-best', text: bestForLine(persona) });
    sc.appendChild(value);
    grid.appendChild(sc);
  }

  // Quick flags row.
  const flags = el('div', { class: 'po-card' });
  flags.appendChild(el('div', { class: 'po-card-title', text: 'Profile flags' }));
  const flagList = [
    persona.fx_activity ? 'FX-active' : 'No FX',
    persona.cash_deposit_activity ? 'Cash-heavy' : 'No cash deposits',
    persona.distress_signals?.nsf_events_per_year_band
      ? `NSF events / yr: ${persona.distress_signals.nsf_events_per_year_band[0]}–${persona.distress_signals.nsf_events_per_year_band[1]}`
      : null,
  ].filter(Boolean);
  flags.appendChild(
    el('div', { attrs: { style: 'font-size:12px;line-height:1.5' }, text: flagList.join(' · ') }),
  );
  grid.appendChild(flags);

  wrap.appendChild(grid);

  // Where to look first — direct jumps to wire endpoints. Deep-link the
  // Daniel/Maryam/Omar 5-minute walkthrough into a single click.
  const jumps = el('div', {
    class: 'po-jumps',
    attrs: { role: 'group', 'aria-label': 'Where to look first' },
  });
  const firstAcc = state.bundle.accounts?.[0]?.AccountId ?? null;
  const jumpDefs = [
    { label: 'Transactions →', endpoint: '/accounts/{AccountId}/transactions', acc: firstAcc },
    {
      label: 'Standing Orders →',
      endpoint: '/accounts/{AccountId}/standing-orders',
      acc: firstAcc,
    },
    { label: 'Direct Debits →', endpoint: '/accounts/{AccountId}/direct-debits', acc: firstAcc },
    { label: 'Underwriting summary →', endpoint: UNDERWRITING_PSEUDO, acc: null },
  ];
  for (const j of jumpDefs) {
    const btn = el('button', {
      class: 'po-jump',
      text: j.label,
      attrs: { type: 'button' },
      onClick: () => {
        state.endpoint = j.endpoint;
        state.selectedAccountId = j.acc;
        clearTxState();
        renderNavigator();
        renderPayload();
      },
    });
    jumps.appendChild(btn);
  }
  wrap.appendChild(jumps);

  // EXP-30 — TPP-developer affordance: render the "Use this persona in your
  // demo" panel as the last element on the overview. Surfaces the four plug
  // points (iframe, npm, pip, curl) so a TPP can lift this persona's payloads
  // straight into a Nebras-mock-shaped demo flow without losing coherence.
  wrap.appendChild(renderUseInDemoPanel());

  body.appendChild(wrap);
}

// ---- EXP-30 "Use this persona in your demo" --------------------------------------------

function renderUseInDemoPanel() {
  const personaId = state.personaId;
  const lfi = state.lfi;
  const seed = state.seed;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const slugBase =
    typeof window !== 'undefined'
      ? (
          window.location.origin + window.location.pathname.replace(/\/(index|embed)\.html$/, '')
        ).replace(/\/$/, '')
      : '';

  // The curl snippet targets /accounts as the simplest entry — it has no
  // {AccountId} dependency and is safe to demo without prior IDs.
  const curlUrl = encodeFixtureUrl({ origin, personaId, lfi, seed, endpoint: '/accounts' });
  const manifestUrl = `${origin}/fixtures/v1/manifest.json`;

  const embedHref =
    slugBase +
    encodeEmbed({
      personaId,
      lfi,
      endpoint: '/accounts/{AccountId}/transactions',
      seed,
      height: 600,
    }).replace(/^\/embed/, '/embed.html');
  const iframeSnippet = `<iframe src="${embedHref}" width="100%" height="600" loading="lazy" title="Open Finance Data Sandbox · ${personaId} · ${lfi}" referrerpolicy="no-referrer" style="border:1px solid #d9d5cb;border-radius:4px"></iframe>`;

  const npmSnippet = `npm install @openfinance-os/sandbox-fixtures
import { loadJourney } from '@openfinance-os/sandbox-fixtures';
const j = loadJourney({ persona: '${personaId}', lfi: '${lfi}', seed: ${seed} });
// j.endpoints['/accounts'], j.endpoints['/parties'],
// j.endpoints['/accounts/{AccountId}/transactions'], ...`;

  const pipSnippet = `pip install openfinance-os-sandbox-fixtures
from openfinance_os_sandbox_fixtures import load_journey
j = load_journey('${personaId}', lfi='${lfi}', seed=${seed})
# j['endpoints']['/accounts'], j['endpoints']['/parties'],
# j['endpoints']['/accounts/{AccountId}/transactions'], ...`;

  const curlSnippet = `curl -fsS '${manifestUrl}'   # discover personas, LFIs, endpoints, version pin
curl -fsS '${curlUrl}'`;

  const details = el('details', {
    class: 'demo-panel',
    attrs: { 'aria-label': 'Use this persona in your demo' },
  });
  const summary = el('summary', { class: 'demo-panel-summary' });
  summary.appendChild(el('span', { class: 'demo-panel-eyebrow', text: 'For TPP demos' }));
  summary.appendChild(
    el('span', { class: 'demo-panel-title', text: 'Use this persona in your demo' }),
  );
  details.appendChild(summary);

  const note = el('p', { class: 'demo-panel-note' });
  note.appendChild(document.createTextNode('Synthetic, illustrative data. '));
  const strong = el('strong', { text: 'Not endorsed by Nebras / CBUAE / any LFI.' });
  note.appendChild(strong);
  note.appendChild(
    document.createTextNode(
      ' Not a substitute for the Nebras-operated regulatory sandbox at certification time. ',
    ),
  );
  const link = el('a', { attrs: { href: 'integrate.html' }, text: 'Full integration guide →' });
  note.appendChild(link);
  details.appendChild(note);

  const rows = [
    {
      eyebrow: 'Path 1 · iframe embed',
      hint: 'Drop a chrome-less view into a slide deck, blog post, or LMS module.',
      snippet: iframeSnippet,
      copyLabel: 'Copy iframe',
      doneLabel: 'Iframe snippet copied — paste into your HTML.',
      // EXP-21 share `kind` enum.
      kind: 'embed',
    },
    {
      eyebrow: 'Path 2 · npm — Node / TypeScript',
      hint: 'Swap your Nebras-mock backend; loadJourney() returns the full coherent bundle.',
      snippet: npmSnippet,
      copyLabel: 'Copy npm snippet',
      doneLabel: 'npm snippet copied.',
      kind: 'npm',
    },
    {
      eyebrow: 'Path 3 · PyPI — Python',
      hint: 'Notebook, FastAPI mock-server, ML pipeline.',
      snippet: pipSnippet,
      copyLabel: 'Copy pip snippet',
      doneLabel: 'pip snippet copied.',
      kind: 'pypi',
    },
    {
      eyebrow: 'Path 4 · raw HTTPS — Swift / Kotlin / Postman / curl / .NET',
      hint: 'Static JSON, CORS-permissive. Pin manifest.json.version for stability.',
      snippet: curlSnippet,
      copyLabel: 'Copy curl',
      doneLabel: 'curl snippet copied.',
      kind: 'fixture-url',
    },
  ];

  for (const r of rows) {
    const row = el('div', { class: 'demo-row' });
    row.appendChild(el('div', { class: 'demo-row-eyebrow', text: r.eyebrow }));
    row.appendChild(el('div', { class: 'demo-row-hint', text: r.hint }));
    const pre = el('pre', { class: 'demo-row-pre' });
    pre.appendChild(el('code', { text: r.snippet }));
    row.appendChild(pre);
    const btn = el('button', {
      class: 'demo-row-copy',
      attrs: { type: 'button' },
      text: r.copyLabel,
      onClick: () => {
        copyToClipboard(r.snippet, r.doneLabel);
        track('share', { kind: r.kind });
      },
    });
    row.appendChild(btn);
    details.appendChild(row);
  }

  return details;
}

// ---- EXP-12 bidirectional links ----------------------------------------------------------

function jumpFromForActiveEndpoint() {
  switch (state.endpoint) {
    case '/accounts/{AccountId}/standing-orders':
      return {
        kind: 'standing-order',
        label: (so) => `standing order "${so.Reference || so.StandingOrderId}"`,
        match: (tx, so) => {
          if (!so.Reference) return false;
          const ref = String(so.Reference).toUpperCase().slice(0, 6);
          return (
            tx.TransactionType === 'LocalBankTransfer' &&
            (tx.TransactionReference?.startsWith(ref) ||
              tx.TransactionInformation?.toLowerCase().includes(
                String(so.Reference).replace(/_/g, ' ').toLowerCase(),
              ))
          );
        },
      };
    case '/accounts/{AccountId}/direct-debits':
      return {
        kind: 'direct-debit',
        label: (dd) => `direct debit "${dd.Name || dd.DirectDebitId}"`,
        match: (tx, dd) => {
          const purpose = String(dd.Name || '').toLowerCase();
          return (
            tx.TransactionType === 'BillPayments' &&
            (tx.TransactionInformation?.toLowerCase().includes(purpose) || false)
          );
        },
      };
    case '/accounts/{AccountId}/beneficiaries':
      return {
        kind: 'beneficiary',
        label: (b) => `beneficiary "${b.CreditorAccount?.[0]?.Name || b.BeneficiaryId}"`,
        match: (tx, b) => {
          const ben = b.CreditorAccount?.[0]?.Name?.toLowerCase();
          if (!ben) return false;
          return tx.TransactionInformation?.toLowerCase().includes(ben) || false;
        },
      };
    default:
      return null;
  }
}

function crossLinkToTransactions(record, jumpFrom) {
  // Find the related transactions in the bundle for the active account.
  const txs = state.bundle.transactions.filter(
    (t) => t._accountId === state.selectedAccountId && jumpFrom.match(t, record),
  );
  state.txHighlight = new Set(txs.map((t) => t.TransactionId));
  state.crossLink = {
    label: jumpFrom.label(record),
    fromEndpoint: state.endpoint,
    matchCount: txs.length,
  };
  state.endpoint = '/accounts/{AccountId}/transactions';
  // Pre-populate the search filter with the most-distinctive token so the
  // matching transactions also pass the row filter.
  state.txFilter = emptyTxFilter();
  if (jumpFrom.kind === 'direct-debit') {
    state.txFilter.search =
      String(record.Name || '')
        .replace(/_/g, ' ')
        .split(' ')[0] || '';
    state.txFilter.type = 'BillPayments';
  } else if (jumpFrom.kind === 'standing-order') {
    state.txFilter.search =
      String(record.Reference || '')
        .replace(/_/g, ' ')
        .split(' ')[0] || '';
    state.txFilter.type = 'LocalBankTransfer';
  }
  renderNavigator();
  renderPayload();
}

function renderCrossLinkBanner() {
  const banner = el('div', { class: 'cross-link-banner', attrs: { role: 'status' } });
  banner.appendChild(
    el('span', {
      text: `Showing transactions linked to ${state.crossLink.label} — ${state.crossLink.matchCount} match${state.crossLink.matchCount === 1 ? '' : 'es'} highlighted.`,
    }),
  );
  banner.appendChild(
    el('button', {
      text: '← Back',
      onClick: () => {
        state.endpoint = state.crossLink.fromEndpoint;
        state.txFilter = emptyTxFilter();
        state.txHighlight = new Set();
        state.crossLink = null;
        renderNavigator();
        renderPayload();
      },
    }),
  );
  return banner;
}

function stripInternal(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

init().catch((err) => {
  // Render fallback safely — never use innerHTML/insertAdjacentHTML with untrusted data.
  const banner = el('pre', {
    text: `init failed: ${String(err.message ?? err)}`,
    attrs: {
      style: 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0',
    },
  });
  document.body.insertBefore(banner, document.body.firstChild);
});

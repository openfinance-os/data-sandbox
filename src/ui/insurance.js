// Insurance domain UI (Phase 2.0 motor full-coverage).
//
// Banking and insurance share the three-pane layout, the persona library,
// the LFI selector, the share-URL machinery and the rendered/raw toggle.
// They diverge in (a) the navigator (banking has bundle + per-account
// sections; insurance has a flat motor section), (b) the payload renderer
// (banking renders rows-as-table; insurance renders nested-record-as-tree
// because the motor schemas are deep, not list-shaped), and (c) the coverage
// meter (banking probes are spec-anchored; insurance preview reuses the
// same status-badge metadata but counts populated optional leaf fields
// directly until lfi-bands.insurance.yaml grows beyond the 4-path starter).

import { leafFields } from '../shared/spec-helpers.js';
import { renderFieldTree } from './field-tree.js';
import { track } from '../analytics.js';

export function createInsurance(deps) {
  const { state, el, syncControls, pushPermalink } = deps;

  function renderInsuranceBundle() {
    // Pin a sensible endpoint when state.endpoint is unset, was inherited from
    // a banking session, or refers to a path the active spec doesn't expose.
    if (!state.endpoint || !state.spec.endpoints?.[state.endpoint]) {
      state.endpoint =
        state.domains?.[state.domain]?.defaultEndpoint ??
        Object.keys(state.spec.endpoints ?? {})[0] ??
        null;
    }
    syncControls();
    renderInsuranceNavigator();
    renderInsurancePayload();
    renderInsuranceCoverage();
  }

  function renderInsuranceNavigator() {
    const nav = document.getElementById('nav-tree');
    if (!nav) return;
    nav.replaceChildren();
    const dom = state.domains?.[state.domain];
    const wrap = el('div', { class: 'nav-account is-bundle' });
    wrap.appendChild(el('div', { class: 'nav-account-header', text: dom?.label ?? 'Insurance' }));
    const inScope = state.spec?.inScopePaths ?? Object.keys(state.spec?.endpoints ?? {});
    for (const ep of inScope) {
      const isActive = state.endpoint === ep;
      const cov = insuranceCoverageForEndpoint(ep);
      const btn = el(
        'button',
        {
          class: `nav-endpoint${isActive ? ' active' : ''}`,
          attrs: { 'aria-current': isActive ? 'true' : null },
          dataset: { endpoint: ep },
          onClick: () => {
            state.endpoint = ep;
            renderInsuranceNavigator();
            renderInsurancePayload();
            renderInsuranceCoverage();
            pushPermalink();
            track('endpoint_nav', { endpoint: ep, domain: state.domain });
          },
        },
        el('span', { class: 'nav-endpoint-label', text: ep }),
      );
      if (cov.total > 0) {
        const meter = el('span', {
          class: 'nav-endpoint-meter',
          attrs: {
            title: `${cov.populated} of ${cov.total} optional leaf fields populated (${cov.pct}%)`,
          },
          text: `${cov.pct}%`,
        });
        btn.appendChild(meter);
      }
      wrap.appendChild(btn);
    }
    nav.appendChild(wrap);
  }

  function insuranceDataForEndpoint(endpoint) {
    switch (endpoint) {
      case '/motor-insurance-policies':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.motorPolicySummaries ?? [] },
        };
      case '/motor-insurance-policies/{InsurancePolicyId}': {
        const policy = state.bundle.motorPolicies?.[0];
        return policy ? { kind: 'detail', Data: policy } : null;
      }
      case '/motor-insurance-policies/{InsurancePolicyId}/payment-details':
        return state.bundle.paymentDetails && state.bundle.line === 'motor'
          ? { kind: 'detail', Data: state.bundle.paymentDetails }
          : null;
      case '/motor-insurance-quotes/{QuoteId}':
        return state.bundle.motorQuote ? { kind: 'detail', Data: state.bundle.motorQuote } : null;
      case '/home-insurance-policies':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.homePolicySummaries ?? [] },
        };
      case '/home-insurance-policies/{InsurancePolicyId}': {
        const policy = state.bundle.homePolicies?.[0];
        return policy ? { kind: 'detail', Data: policy } : null;
      }
      case '/home-insurance-policies/{InsurancePolicyId}/payment-details':
        return state.bundle.paymentDetails && state.bundle.line === 'home'
          ? { kind: 'detail', Data: state.bundle.paymentDetails }
          : null;
      case '/home-insurance-quotes/{QuoteId}':
        return state.bundle.homeQuote ? { kind: 'detail', Data: state.bundle.homeQuote } : null;
      case '/health-insurance-policies':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.healthPolicySummaries ?? [] },
        };
      case '/health-insurance-policies/{InsurancePolicyId}': {
        const policy = state.bundle.healthPolicies?.[0];
        return policy ? { kind: 'detail', Data: policy } : null;
      }
      case '/health-insurance-policies/{InsurancePolicyId}/payment-details':
        return state.bundle.paymentDetails && state.bundle.line === 'health'
          ? { kind: 'detail', Data: state.bundle.paymentDetails }
          : null;
      case '/health-insurance-quotes/{QuoteId}':
        return state.bundle.healthQuote ? { kind: 'detail', Data: state.bundle.healthQuote } : null;
      case '/life-insurance-policies':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.lifePolicySummaries ?? [] },
        };
      case '/life-insurance-policies/{InsurancePolicyId}': {
        const policy = state.bundle.lifePolicies?.[0];
        return policy ? { kind: 'detail', Data: policy } : null;
      }
      case '/life-insurance-policies/{InsurancePolicyId}/payment-details':
        return state.bundle.paymentDetails && state.bundle.line === 'life'
          ? { kind: 'detail', Data: state.bundle.paymentDetails }
          : null;
      case '/life-insurance-quotes/{QuoteId}':
        return state.bundle.lifeQuote ? { kind: 'detail', Data: state.bundle.lifeQuote } : null;
      case '/travel-insurance-policies':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.travelPolicySummaries ?? [] },
        };
      case '/travel-insurance-policies/{InsurancePolicyId}': {
        const policy = state.bundle.travelPolicies?.[0];
        return policy ? { kind: 'detail', Data: policy } : null;
      }
      case '/travel-insurance-policies/{InsurancePolicyId}/payment-details':
        return state.bundle.paymentDetails && state.bundle.line === 'travel'
          ? { kind: 'detail', Data: state.bundle.paymentDetails }
          : null;
      case '/travel-insurance-quotes/{QuoteId}':
        return state.bundle.travelQuote ? { kind: 'detail', Data: state.bundle.travelQuote } : null;
      case '/renters-insurance-policies':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.rentersPolicySummaries ?? [] },
        };
      case '/renters-insurance-policies/{InsurancePolicyId}': {
        const policy = state.bundle.rentersPolicies?.[0];
        return policy ? { kind: 'detail', Data: policy } : null;
      }
      case '/renters-insurance-policies/{InsurancePolicyId}/payment-details':
        return state.bundle.paymentDetails && state.bundle.line === 'renters'
          ? { kind: 'detail', Data: state.bundle.paymentDetails }
          : null;
      case '/renters-insurance-quotes/{QuoteId}':
        return state.bundle.rentersQuote
          ? { kind: 'detail', Data: state.bundle.rentersQuote }
          : null;
      case '/employment-insurance-policies':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.employmentPolicySummaries ?? [] },
        };
      case '/employment-insurance-policies/{InsurancePolicyId}': {
        const policy = state.bundle.employmentPolicies?.[0];
        return policy ? { kind: 'detail', Data: policy } : null;
      }
      case '/employment-insurance-policies/{InsurancePolicyId}/payment-details':
        return state.bundle.paymentDetails && state.bundle.line === 'employment'
          ? { kind: 'detail', Data: state.bundle.paymentDetails }
          : null;
      case '/employment-insurance-quotes/{QuoteId}':
        return state.bundle.employmentQuote
          ? { kind: 'detail', Data: state.bundle.employmentQuote }
          : null;
      case '/insurance-consents':
        return {
          kind: 'list',
          Data: { Policies: state.bundle.consents ?? [] },
        };
      case '/insurance-consents/{ConsentId}': {
        const consent = state.bundle.consents?.[0];
        return consent ? { kind: 'detail', Data: consent } : null;
      }
      default:
        return null;
    }
  }

  function renderInsuranceCalibrationBanner() {
    // Insurance shipped as GA in Phase 2.1 (30 endpoints across 7 lines)
    // but populate-rate band calibration is still maturing — the
    // lfi-bands.insurance.yaml starter file covers only the headline
    // paths. The banner sets that expectation up-front and routes users
    // who arrived here by mistake back to banking.
    const wrap = el('div', { class: 'insurance-empty-banner', attrs: { role: 'note' } });
    wrap.appendChild(el('strong', { text: 'Insurance is in early calibration.' }));
    wrap.appendChild(
      document.createTextNode(
        ' The 30 endpoints across 7 lines are spec-anchored and deterministic, but populate-rate bands are still maturing — treat the LFI Rich/Median/Sparse axis as indicative until v1.1.',
      ),
    );
    const link = el('a', {
      class: 'insurance-empty-link',
      text: 'Switch to Banking →',
      attrs: {
        href: '#',
        title: 'Back to the banking domain (18 personas, 12 endpoints, fully calibrated).',
      },
    });
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = new URL(window.location.href);
      url.searchParams.delete('domain');
      // Drop persona/endpoint too — switching domain re-picks defaults.
      url.searchParams.delete('persona');
      url.searchParams.delete('endpoint');
      window.location.href = url.toString();
    });
    wrap.appendChild(link);
    return wrap;
  }

  function renderInsurancePayload() {
    const body = document.getElementById('payload-body');
    const epLabel = document.getElementById('endpoint-label');
    if (!body) return;
    body.replaceChildren();
    if (epLabel) epLabel.textContent = state.endpoint ?? '';

    // Sync the rendered/raw toggle aria state so a switch from the banking flow
    // (where the toggle was already wired) stays consistent.
    document.getElementById('view-rendered')?.classList.toggle('active', state.view === 'rendered');
    document.getElementById('view-raw')?.classList.toggle('active', state.view === 'raw');
    document
      .getElementById('view-rendered')
      ?.setAttribute('aria-selected', state.view === 'rendered');
    document.getElementById('view-raw')?.setAttribute('aria-selected', state.view === 'raw');

    // PR #9 — insurance early-calibration banner.
    body.appendChild(renderInsuranceCalibrationBanner());

    const slice = insuranceDataForEndpoint(state.endpoint);
    if (!slice) {
      body.appendChild(
        el('p', {
          text: `No data for ${state.endpoint} in this bundle.`,
          attrs: { style: 'color:var(--text-muted);padding:8px 12px' },
        }),
      );
      return;
    }

    // Build a shared field-name → metadata map from the parsed spec so the
    // tree renderer can attach status badges, formats, and enum chips.
    const fields = leafFields(state.spec, state.endpoint);
    const fieldsByName = new Map();
    for (const f of fields) fieldsByName.set(f.name, f);

    if (state.view === 'raw') {
      body.appendChild(
        el('pre', {
          class: 'payload-raw',
          text: JSON.stringify(slice.Data, null, 2),
        }),
      );
      return;
    }

    const wrap = el('div', { class: 'payload-rendered insurance-payload' });

    if (slice.kind === 'list') {
      const policies = slice.Data.Policies ?? [];
      if (policies.length === 0) {
        wrap.appendChild(el('p', { text: 'No policies.' }));
      } else {
        const summary = el('div', {
          class: 'insurance-list-summary',
          text: `${policies.length} ${policies.length === 1 ? 'policy' : 'policies'} on this persona`,
        });
        wrap.appendChild(summary);
        for (const p of policies) {
          wrap.appendChild(insuranceRecordCard(p, fieldsByName));
        }
      }
    } else {
      wrap.appendChild(insuranceRecordCard(slice.Data, fieldsByName));
    }

    body.appendChild(wrap);
  }

  function insuranceRecordCard(record, fieldsByName) {
    const card = el('div', { class: 'insurance-record' });
    card.appendChild(renderFieldTree(record, fieldsByName, el));
    return card;
  }

  // Coverage for the active insurance endpoint: of the leaf optional fields
  // the spec defines, how many actually carry a value in the rendered slice.
  // A simple, domain-honest metric — banking's spec-anchored probes don't
  // translate to motor-insurance shapes, and the lfi-bands.insurance.yaml
  // starter only calibrates four paths, so band-segmented coverage isn't
  // honest yet.
  function insuranceCoverageForEndpoint(endpoint) {
    const fields = leafFields(state.spec, endpoint);
    const optional = fields.filter((f) => f.status !== 'mandatory');
    if (optional.length === 0) return { populated: 0, total: 0, pct: 0 };
    const slice = insuranceDataForEndpoint(endpoint);
    if (!slice) return { populated: 0, total: optional.length, pct: 0 };
    const valuesByName = collectValuesByFieldName(slice.Data);
    let populated = 0;
    for (const f of optional) {
      const values = valuesByName.get(f.name);
      if (
        values &&
        values.some((v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
      ) {
        populated += 1;
      }
    }
    return {
      populated,
      total: optional.length,
      pct: Math.round((populated / optional.length) * 100),
    };
  }

  function collectValuesByFieldName(value, out = new Map()) {
    if (value == null || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
      for (const v of value) collectValuesByFieldName(v, out);
      return out;
    }
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(v);
      collectValuesByFieldName(v, out);
    }
    return out;
  }

  function renderInsuranceCoverage() {
    const cov = insuranceCoverageForEndpoint(state.endpoint);
    const pctEl = document.getElementById('coverage-pct');
    if (pctEl) pctEl.textContent = cov.total > 0 ? `${cov.pct}%` : '—';
    // Banking band cells don't translate to insurance preview — clear them
    // rather than render a misleading per-band breakdown against an
    // uncalibrated band map.
    document.getElementById('coverage-bands')?.replaceChildren();
  }

  return { renderInsuranceBundle };
}

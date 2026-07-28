// EXP-16 Compare-LFIs view. Renders the active LFI (state.lfi) against
// a partner (state.compareWith) side-by-side, with diff highlighting:
// green = present only on this side, amber = changed value, red =
// missing here. Pure UI module; takes state + DOM helper + the
// underscore-prefix stripper as deps so it can live outside src/app.js.

// C-P1 perf — the async lazy generator entry (banking static, other domains
// dynamic-imported). Compare-mode is banking-only today, so in practice the
// pipeline is always already loaded by the time this runs.
import { buildBundle } from '../generator/lazy.js';
import { leafFields } from '../shared/spec-helpers.js';
import { statusPill } from '../shared/dom.js';

// C-P2 — compare-mode bundle memo cap. Small on purpose: one compare session
// touches at most a handful of (persona, lfi, seed) tuples; the cache exists
// to stop every re-render re-generating two full bundles.
const BUNDLE_CACHE_MAX = 6;

export function createCompareView(deps) {
  const { state, el, stripInternal, personaAvatarEl, localizedName } = deps;

  // C-P2 — memoized compare bundles, keyed (personaId, lfi, seed). The cached
  // entry also pins the persona OBJECT it was built from: the custom persona
  // keeps its 'custom' id across re-applies of a new recipe, so object
  // identity (a fresh object per expansion) is the invalidation signal.
  const bundleCache = new Map();

  async function bundleFor(persona, lfi, now) {
    // Reuse the app's active bundle when this side matches the active LFI —
    // rebuildAndRender guarantees state.bundle corresponds to the current
    // (personaId, lfi, seed) before any compare render runs.
    if (lfi === state.lfi && state.bundle && state.bundle.persona === persona.persona_id) {
      return state.bundle;
    }
    const key = `${persona.persona_id}|${lfi}|${state.seed}`;
    const hit = bundleCache.get(key);
    if (hit && hit.persona === persona) return hit.bundle;
    const bundle = await buildBundle({
      persona,
      lfi,
      seed: state.seed,
      pools: state.data.pools,
      now,
    });
    if (bundleCache.size >= BUNDLE_CACHE_MAX) {
      bundleCache.delete(bundleCache.keys().next().value); // drop the oldest entry
    }
    bundleCache.set(key, { persona, bundle });
    return bundle;
  }

  async function renderCompareView(body) {
    const persona = state.data.personas[state.personaId];
    const now = new Date(state.data.buildInfo.nowIso);
    // Compare-mode renders the active LFI (state.lfi) against a partner
    // (state.compareWith). Lever placement is in the topbar; the in-pane
    // affordance is just a thin context line + diff legend.
    const leftLfi = state.lfi;
    const rightLfi = state.compareWith;
    const leftBundle = await bundleFor(persona, leftLfi, now);
    const rightBundle = await bundleFor(persona, rightLfi, now);

    const leftRows = compareRowsFor(leftBundle);
    const rightRows = compareRowsFor(rightBundle);
    const stats = compareStats(leftRows, rightRows);
    if (personaAvatarEl) {
      body.appendChild(
        el(
          'div',
          { class: 'compare-persona' },
          personaAvatarEl(state.personaId, persona, 'md'),
          el(
            'div',
            { class: 'compare-persona-text' },
            // D-10 — use the localized display name (name_ar under Arabic UI)
            // instead of the raw English manifest name.
            el('div', {
              class: 'compare-persona-name',
              text: localizedName ? localizedName(persona) : persona.name,
            }),
            el('div', { class: 'compare-persona-lfis', text: `${leftLfi} vs ${rightLfi}` }),
          ),
        ),
      );
    }
    body.appendChild(
      el('div', {
        class: 'compare-summary',
        text: `${stats.totalCellsLeft} populated cells on ${leftLfi} · ${stats.totalCellsRight} on ${rightLfi} · ${stats.diffCount} fields differ across ${Math.max(leftRows.length, rightRows.length)} rows. Cells highlighted: green = present only on this side, amber = changed, red = missing.`,
      }),
    );

    // Union of column keys across both sides so each half renders the same
    // columns. That's how a "missing" cell on Sparse gets a column to live in
    // — without it, dropped fields disappear from Sparse's table entirely
    // and the diff classification can't fire.
    const allKeys = new Set();
    for (const r of [...leftRows, ...rightRows]) {
      for (const k of Object.keys(stripInternal(r))) allKeys.add(k);
    }

    const compareWrap = el('div', { class: 'compare-pane' });
    compareWrap.appendChild(renderCompareHalf(leftBundle, leftRows, rightRows, leftLfi, allKeys));
    compareWrap.appendChild(renderCompareHalf(rightBundle, rightRows, leftRows, rightLfi, allKeys));
    body.appendChild(compareWrap);
  }

  function compareRowsFor(bundle) {
    const acc =
      bundle.accounts.find((a) => a.AccountId === state.selectedAccountId) ?? bundle.accounts[0];
    switch (state.endpoint) {
      case '/accounts':
        return bundle.accounts;
      case '/parties':
        return bundle.callingUserParty ? [bundle.callingUserParty] : [];
      case '/accounts/{AccountId}':
        return acc ? [acc] : [];
      case '/accounts/{AccountId}/balances':
        return acc ? bundle.balances.filter((b) => b._accountId === acc.AccountId) : [];
      case '/accounts/{AccountId}/transactions':
        return acc
          ? bundle.transactions.filter((t) => t._accountId === acc.AccountId).slice(0, 60)
          : [];
      case '/accounts/{AccountId}/standing-orders':
        return acc ? bundle.standingOrders.filter((x) => x._accountId === acc.AccountId) : [];
      case '/accounts/{AccountId}/direct-debits':
        return acc ? bundle.directDebits.filter((x) => x._accountId === acc.AccountId) : [];
      case '/accounts/{AccountId}/beneficiaries':
        return acc ? bundle.beneficiaries.filter((x) => x._accountId === acc.AccountId) : [];
      case '/accounts/{AccountId}/scheduled-payments':
        return acc ? bundle.scheduledPayments.filter((x) => x._accountId === acc.AccountId) : [];
      case '/accounts/{AccountId}/product':
        return acc ? bundle.product.filter((x) => x._accountId === acc.AccountId) : [];
      case '/accounts/{AccountId}/parties':
        return acc ? bundle.parties.filter((x) => x._accountId === acc.AccountId) : [];
      case '/accounts/{AccountId}/statements':
        return acc ? bundle.statements.filter((x) => x._accountId === acc.AccountId) : [];
      default:
        return [];
    }
  }

  function rowKey(row) {
    return (
      row.TransactionId ||
      row.AccountId ||
      row.StandingOrderId ||
      row.DirectDebitId ||
      row.BeneficiaryId ||
      row.ScheduledPaymentId ||
      row.ProductId ||
      row.PartyId ||
      row.StatementId ||
      row._accountId ||
      JSON.stringify(row).slice(0, 64)
    );
  }

  function compareStats(leftRows, rightRows) {
    const leftByKey = new Map(leftRows.map((r) => [rowKey(r), r]));
    const rightByKey = new Map(rightRows.map((r) => [rowKey(r), r]));
    let totalCellsLeft = 0;
    let totalCellsRight = 0;
    let diffCount = 0;
    for (const r of leftRows) {
      for (const v of Object.values(stripInternal(r))) if (v != null) totalCellsLeft += 1;
    }
    for (const r of rightRows) {
      for (const v of Object.values(stripInternal(r))) if (v != null) totalCellsRight += 1;
    }
    for (const [key, l] of leftByKey) {
      const r = rightByKey.get(key);
      if (!r) continue;
      const sl = stripInternal(l);
      const sr = stripInternal(r);
      const allKeys = new Set([...Object.keys(sl), ...Object.keys(sr)]);
      for (const k of allKeys) {
        if (JSON.stringify(sl[k]) !== JSON.stringify(sr[k])) diffCount += 1;
      }
    }
    return { totalCellsLeft, totalCellsRight, diffCount };
  }

  function renderCompareHalf(bundle, ownRows, otherRows, lfi, allKeys) {
    const half = el('div', { class: 'compare-half' });
    half.appendChild(
      el('div', {
        class: 'compare-half-header',
        text: `${lfi.toUpperCase()} · ${ownRows.length} row${ownRows.length === 1 ? '' : 's'}`,
      }),
    );
    const inner = el('div', { class: 'payload-body', attrs: { tabindex: '0' } });
    if (ownRows.length === 0) {
      inner.appendChild(
        el('p', { text: 'No records.', attrs: { style: 'color:var(--text-muted);padding:8px' } }),
      );
      half.appendChild(inner);
      void bundle;
      return half;
    }
    const fieldsByName = new Map(
      (leafFields(state.spec, state.endpoint) ?? []).map((f) => [f.name, f]),
    );
    const otherByKey = new Map(otherRows.map((r) => [rowKey(r), r]));

    const wrap = el('div', { class: 'payload-rendered' });
    const table = el('table');
    const thead = el('thead');
    const headRow = el('tr');
    for (const k of allKeys) {
      // C-A2 — column-header semantics for screen-reader table navigation.
      const th = el('th', { attrs: { scope: 'col' } });
      const f = fieldsByName.get(k);
      if (f) th.dataset.status = f.status;
      if (f) {
        th.appendChild(statusPill(f.status));
      }
      th.appendChild(el('span', { class: 'field-name', text: k }));
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const r of ownRows) {
      const stripped = stripInternal(r);
      const otherRow = otherByKey.get(rowKey(r));
      const otherStripped = otherRow ? stripInternal(otherRow) : null;
      const tr = el('tr');
      for (const k of allKeys) {
        const v = stripped[k];
        const ov = otherStripped ? otherStripped[k] : undefined;
        const td = el('td');
        td.textContent = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (otherStripped) {
          const here = v != null;
          const there = ov != null;
          if (here && !there) td.classList.add('diff-only-here');
          else if (!here && there) td.classList.add('diff-missing');
          else if (here && there && JSON.stringify(v) !== JSON.stringify(ov))
            td.classList.add('diff-changed');
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    inner.appendChild(wrap);
    half.appendChild(inner);
    return half;
  }

  return { renderCompareView };
}

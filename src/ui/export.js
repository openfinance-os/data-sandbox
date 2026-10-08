// Compatibility entry; portable adapters import the shared core directly.
export * from '../core/envelopes.js';
import {
  envelopesFromBundle,
  csvForResource,
  downloadJson,
  downloadCsv,
  downloadTarball,
} from '../core/envelopes.js';

// State-bound export actions return an explicit result even when no fixture is available.
export function createActiveExports({ state, exportContext }) {
  function activeEnvelopeKey() {
    if (state.endpoint === '/accounts' || state.endpoint === '/parties') return state.endpoint;
    if (state.selectedAccountId) {
      const tail = state.endpoint.replace('{AccountId}', state.selectedAccountId);
      return tail;
    }
    return state.endpoint;
  }

  function exportActiveJson() {
    if (!state.bundle) return { status: 'failed', reason: 'unavailable' };
    const ctx = exportContext();
    const envelopes = envelopesFromBundle(state.bundle, ctx);
    const key = activeEnvelopeKey();
    const env = envelopes[key] ?? envelopes[state.endpoint];
    if (!env) return { status: 'failed', reason: 'unavailable' };
    const fname = `${state.personaId}-${state.lfi}-seed${state.seed}-${key.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '') || 'root'}.json`;
    return downloadJson(env, fname);
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
    const resource = RESOURCE_FOR_ENDPOINT[state.endpoint];
    if (!resource || state.bundle[resource[0]] == null) return '';
    let rows = state.bundle[resource[0]];
    if (state.selectedAccountId && Array.isArray(rows)) {
      rows = rows.filter((r) => !r._accountId || r._accountId === state.selectedAccountId);
    }
    if (!Array.isArray(rows)) rows = [rows];
    return csvForResource(rows, ctx);
  }
  function exportActiveCsv() {
    if (!state.bundle) return { status: 'failed', reason: 'unavailable' };
    const [, resourceLabel] = RESOURCE_FOR_ENDPOINT[state.endpoint] ?? ['accounts', 'Account'];
    const csv = buildActiveCsvString();
    const fname = `${state.personaId}-${state.lfi}-seed${state.seed}-${resourceLabel}.csv`;
    return downloadCsv(csv, fname);
  }

  function exportTarball() {
    if (!state.bundle) return { status: 'failed', reason: 'unavailable' };
    const ctx = exportContext();
    return downloadTarball(
      state.bundle,
      ctx,
      `${state.personaId}-${state.lfi}-seed${state.seed}.tar`,
    );
  }
  return {
    activeEnvelopeKey,
    buildActiveCsvString,
    exportActiveJson,
    exportActiveCsv,
    exportTarball,
  };
}

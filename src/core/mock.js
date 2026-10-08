import { queryTransactions } from './transaction-query.js';

export const HARNESS_CASES = [
  'success',
  'empty',
  'short-history',
  'optional-absence',
  'missing-permission',
  'expired',
  'revoked',
  'latency',
  'rate-limit',
  'temporary-failure',
];

// Controls and expected observations are harness metadata, never API fields.
export function mockResponse(envelope, { endpoint, scenario = 'success', now, query = {} }) {
  if (!HARNESS_CASES.includes(scenario)) throw new Error(`Unknown harness scenario: ${scenario}`);
  const out = structuredClone(envelope);
  const error = (status, reason) => ({
    status,
    reason,
    delayMs: 0,
    envelope: null,
    harness: { scenario, simulated: true, authority: 'API Hub', referenceDate: now },
  });
  if (['missing-permission', 'expired', 'revoked'].includes(scenario)) return error(403, scenario);
  if (scenario === 'rate-limit') return error(429, 'rate-limit');
  if (scenario === 'temporary-failure') return error(503, 'temporary-failure');
  if (scenario === 'empty') {
    if (!Array.isArray(out.Data.Transaction))
      throw new Error('empty scenario requires a transaction endpoint');
    out.Data.Transaction = [];
  }
  if (scenario === 'short-history') {
    if (!Array.isArray(out.Data.Transaction))
      throw new Error('short-history requires a transaction endpoint');
    const start = new Date(now);
    start.setUTCMonth(start.getUTCMonth() - 2);
    out.Data.Transaction = out.Data.Transaction.filter(
      (t) => Date.parse(t.BookingDateTime) >= start.getTime(),
    );
  }
  // Populate-rate missing fields are produced by the real sparse generator,
  // rather than deleting arbitrary mandatory fields here.
  if (out.Data.Transaction) Object.assign(out, queryTransactions(out, query));
  return {
    status: 200,
    delayMs: scenario === 'latency' ? 250 : 0,
    envelope: out,
    harness: { scenario, endpoint, simulated: true, authority: 'API Hub', referenceDate: now },
  };
}

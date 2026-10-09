// Shared persona-domain normalisation (Phase 2.2 data-model).
//
// Persona records reach the UI in two shapes:
//   - dist/data.json — multi-domain personas carry `domains: [a, b]` and
//     NO singular `domain` key; single-domain personas carry `domain`.
//   - fixtures/v1/manifest.json — the fixture builder additionally stamps
//     the label `domain: 'multi'` alongside the `domains` array.
//
// Every consumer that filters or labels personas by domain must go through
// these helpers rather than reading `p.domain` directly — the singular-key
// comparison is exactly the bug that hid all 8 multi-domain personas from
// the explorer (see APP_IMPROVEMENT_PLAN.md §1 A-1).

/** Membership list for a persona record, whichever shape it arrived in. */
export function normalizeDomains(p) {
  if (Array.isArray(p?.domains) && p.domains.length > 0) return p.domains;
  const single = p?.domain;
  if (single && single !== 'multi') return [single];
  return ['banking'];
}

/** True when the persona belongs to `domain` (multi-domain aware). */
export function personaInDomain(p, domain) {
  return normalizeDomains(p).includes(domain);
}

/**
 * Display label matching the fixture-manifest convention: the single domain
 * id, or 'multi' for personas spanning more than one.
 */
export function domainLabel(p) {
  const domains = normalizeDomains(p);
  return domains.length > 1 ? 'multi' : domains[0];
}

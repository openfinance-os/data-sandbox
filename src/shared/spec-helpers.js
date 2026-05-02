// Spec-helpers — drives the UI's status badges, field cards, citation links
// and coverage meter from the parsed SPEC.json (EXP-01 / EXP-13 / EXP-14 /
// EXP-15). Hand-authored field-status tables are forbidden — this module is
// the only consumer that interprets the parsed spec into UI-shaped records.

const STATUS = Object.freeze({
  MANDATORY: 'mandatory',
  OPTIONAL: 'optional',
  CONDITIONAL: 'conditional',
});

export function statusBadge(status) {
  switch (status) {
    case STATUS.MANDATORY:
      return { label: 'M', shape: 'pill-solid', text: 'Mandatory' };
    case STATUS.CONDITIONAL:
      return { label: 'C', shape: 'pill-conditional', text: 'Conditional' };
    case STATUS.OPTIONAL:
    default:
      return { label: 'O', shape: 'pill-dashed', text: 'Optional' };
  }
}

export function leafFields(spec, endpointPath) {
  const e = spec.endpoints[endpointPath];
  if (!e) return [];
  return e.fields.filter((f) => f.type !== 'object' && f.type !== 'array');
}

export function countByStatus(spec, endpointPath) {
  const fields = leafFields(spec, endpointPath);
  const out = { mandatory: 0, optional: 0, conditional: 0, total: fields.length };
  for (const f of fields) out[f.status] = (out[f.status] ?? 0) + 1;
  return out;
}

export function coverage(bundle) {
  const probes = collectProbes(bundle);
  const populated = probes.filter(([, ok]) => ok).length;
  const total = probes.length || 1;
  return { populated, total, pct: Math.round((populated / total) * 100) };
}

export function coverageForEndpoint(bundle, endpointPath, accountId) {
  const probes = collectProbesForEndpoint(bundle, endpointPath, accountId);
  if (probes.length === 0) return { populated: 0, total: 0, pct: 0 };
  const populated = probes.filter(([, ok]) => ok).length;
  return {
    populated,
    total: probes.length,
    pct: Math.round((populated / probes.length) * 100),
  };
}

// Probe path → populate-rate band (§7.3). Single source of truth shared
// with src/generator/banking/lfi-profile.js so band breakdowns and redaction
// decisions never drift apart.
const PROBE_BAND = Object.freeze({
  'Account.Nickname': 'Common',
  'Account.OpeningDate': 'Common',
  'Transaction.TransactionInformation': 'Universal',
  'Transaction.Flags': 'Common',
  'Transaction.ValueDateTime': 'Universal',
  'Transaction.TransactionReference': 'Common',
  'Transaction.MerchantDetails': 'Variable',
  'Transaction.MerchantDetails.MerchantCategoryCode': 'Variable',
  'Transaction.MerchantDetails.MerchantName': 'Common',
  'Balance.CreditLine': 'Variable',
});

function collectProbes(bundle) {
  const probes = [];
  for (const a of bundle.accounts ?? []) {
    probes.push(['Account.Nickname', a.Nickname != null]);
    probes.push(['Account.OpeningDate', a.OpeningDate != null]);
  }
  for (const t of bundle.transactions ?? []) {
    probes.push(['Transaction.TransactionInformation', t.TransactionInformation != null]);
    probes.push(['Transaction.Flags', Array.isArray(t.Flags) && t.Flags.length > 0]);
    probes.push(['Transaction.ValueDateTime', t.ValueDateTime != null]);
    probes.push(['Transaction.TransactionReference', t.TransactionReference != null]);
    probes.push(['Transaction.MerchantDetails', t.MerchantDetails != null]);
    if (t.MerchantDetails) {
      probes.push(['Transaction.MerchantDetails.MerchantCategoryCode', t.MerchantDetails.MerchantCategoryCode != null]);
      probes.push(['Transaction.MerchantDetails.MerchantName', t.MerchantDetails.MerchantName != null]);
    }
  }
  for (const b of bundle.balances ?? []) {
    probes.push(['Balance.CreditLine', Array.isArray(b.CreditLine)]);
  }
  return probes;
}

// Per-band populate-rate breakdown — same probes as `coverage()`, grouped
// by §7.3 band. Returns { Universal: {pop, total, pct}, Common: {...}, ...}.
// Faisal's JTBD-3.2: "show me the populate-rate distribution across
// optional fields" — the single roll-up percentage is not enough.
export function coverageByBand(bundle) {
  const out = {
    Universal: { populated: 0, total: 0, pct: 0 },
    Common:    { populated: 0, total: 0, pct: 0 },
    Variable:  { populated: 0, total: 0, pct: 0 },
    Rare:      { populated: 0, total: 0, pct: 0 },
  };
  for (const [path, ok] of collectProbes(bundle)) {
    const band = PROBE_BAND[path];
    if (!band || !out[band]) continue;
    out[band].total += 1;
    if (ok) out[band].populated += 1;
  }
  for (const b of Object.values(out)) {
    b.pct = b.total > 0 ? Math.round((b.populated / b.total) * 100) : 0;
  }
  return out;
}

function collectProbesForEndpoint(bundle, endpointPath, accountId) {
  const out = [];
  switch (endpointPath) {
    case '/accounts':
      for (const a of bundle.accounts ?? []) {
        out.push(['Account.Nickname', a.Nickname != null]);
        out.push(['Account.OpeningDate', a.OpeningDate != null]);
      }
      return out;
    case '/accounts/{AccountId}': {
      const a = bundle.accounts?.find((x) => x.AccountId === accountId);
      if (!a) return [];
      out.push(['Account.Nickname', a.Nickname != null]);
      out.push(['Account.OpeningDate', a.OpeningDate != null]);
      return out;
    }
    case '/accounts/{AccountId}/balances':
      for (const b of bundle.balances ?? []) {
        if (b._accountId !== accountId) continue;
        out.push(['Balance.CreditLine', Array.isArray(b.CreditLine)]);
      }
      return out;
    case '/accounts/{AccountId}/transactions':
      for (const t of bundle.transactions ?? []) {
        if (t._accountId !== accountId) continue;
        out.push(['Transaction.TransactionInformation', t.TransactionInformation != null]);
        out.push(['Transaction.Flags', Array.isArray(t.Flags) && t.Flags.length > 0]);
        out.push(['Transaction.ValueDateTime', t.ValueDateTime != null]);
        out.push(['Transaction.TransactionReference', t.TransactionReference != null]);
        out.push(['Transaction.MerchantDetails', t.MerchantDetails != null]);
        if (t.MerchantDetails) {
          out.push(['Transaction.MerchantDetails.MerchantCategoryCode', t.MerchantDetails.MerchantCategoryCode != null]);
          out.push(['Transaction.MerchantDetails.MerchantName', t.MerchantDetails.MerchantName != null]);
        }
      }
      return out;
    default:
      return out;
  }
}

export function specCitationUrl(spec, field) {
  if (!spec || !field) return null;
  if (!spec.upstreamRepo || !spec.pinSha) return null;
  const base = `https://github.com/${spec.upstreamRepo}/blob/${spec.pinSha}/${spec.upstreamPath}`;
  const schemaName = guessSchemaForField(field);
  const lineNo = schemaName && spec.schemaLines?.[schemaName];
  return lineNo ? `${base}#L${lineNo}` : base;
}

const PATH_TO_SCHEMA = Object.freeze({
  Account: 'AEAccountArrayId',
  Balance: 'AEBalance',
  Transaction: 'AETransaction',
  StandingOrder: 'AEStandingOrder',
  DirectDebit: 'AEDirectDebit',
  Beneficiary: 'AEBeneficiary',
  ScheduledPayment: 'AEScheduledPayment',
  Product: 'AEProduct1',
  Party: 'AEPartyIdentityAssurance2',
  Statements: 'AEStatements',
  CurrencyExchange: 'AECurrencyExchange',
  CreditLine: 'AEBalance',
  MerchantDetails: 'AEMerchantDetails1',
});

function guessSchemaForField(field) {
  const path = field.path || '';
  const segs = path.split('.').filter(Boolean);
  const candidate = segs[1] || segs[0] || '';
  return PATH_TO_SCHEMA[candidate.replace(/\[\]$/, '')] ?? null;
}

export function realLfisGuidance(field, lfiBand) {
  if (field.status === STATUS.MANDATORY) {
    return 'Always present per spec. All LFIs populate. Safe to depend on for primary logic.';
  }
  if (field.status === STATUS.CONDITIONAL) {
    return 'Conditional on a parent-field value. When the rule is satisfied populate rates vary across the ecosystem; when not satisfied the field is correctly absent.';
  }
  switch (lfiBand) {
    case 'Universal':
      return 'Optional in spec but populated by all LFIs in practice. Safe to depend on.';
    case 'Common':
      return 'Optional. Common across the ecosystem (Median populate ~70%). Useful but do not gate primary logic on it.';
    case 'Variable':
      return 'Optional. Variable populate rates across LFIs (Median ~40%). Treat as a bonus signal.';
    case 'Rare':
      return 'Optional. Only premium-product or mature-integration LFIs typically populate (Median ~10%).';
    case 'Unknown':
      return 'Optional. No cross-LFI evidence yet -- populate-rate band is unknown.';
    default:
      return 'Optional. Populate-rate band not yet curated for this field.';
  }
}

// Banking-domain fallback. The authoritative source is now
// spec.bandOverrides (parsed from spec/lfi-bands.<domain>.yaml at build
// time); this constant is only used when the caller passes no spec — i.e.
// in legacy / test paths that don't have one to hand. New domains pick up
// their bands automatically from spec.bandOverrides without touching JS.
const FALLBACK_FIELD_BANDS = Object.freeze({
  'Account.Nickname': 'Common',
  'Account.OpeningDate': 'Common',
  'Transaction.TransactionInformation': 'Universal',
  'Transaction.MerchantDetails': 'Variable',
  'Transaction.MerchantDetails.MerchantCategoryCode': 'Variable',
  'Transaction.MerchantDetails.MerchantName': 'Common',
  'Transaction.Flags': 'Common',
  'Transaction.ValueDateTime': 'Universal',
  'Transaction.TransactionReference': 'Common',
  'Balance.CreditLine': 'Variable',
});

export function bandForFieldName(name, endpointPath, spec) {
  const bands = spec?.bandOverrides ?? FALLBACK_FIELD_BANDS;
  const segs = endpointPath.split('/').filter(Boolean);
  const resourceHint = segs[segs.length - 1] || '';
  const trial = `${capitalise(resourceHint.replace(/-/g, ' ').replace(/\s+/g, ''))}.${name}`;
  if (bands[trial]) return bands[trial];
  for (const [k, v] of Object.entries(bands)) {
    if (k.endsWith(`.${name}`)) return v;
  }
  return null;
}

function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export { STATUS };

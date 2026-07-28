// Export — EXP-19 / §6.5.
// Three formats: full OF-spec JSON (per endpoint), flat CSV per resource,
// tarball of all of the above. Every file carries the §6.5 watermark.
// Phase 1 — works in the browser only (no Node-side helpers needed).

import { watermark, watermarkCsvHeader } from '../shared/watermark.js';

// Strip generator-internal underscore-prefixed fields before serialisation.
// `RECORD_LEVEL_METADATA_KEEP` is a curated allowlist of underscore-prefixed
// keys that ARE consumer-facing sandbox metadata and MUST survive serialisation
// (Slice 10: `_vatBreakdown` on B2B transactions). Spec-validation tests
// pre-strip these before running ajv so v2.1 `additionalProperties: false`
// stays satisfied for any strict consumer that wants to ignore the metadata.
const RECORD_LEVEL_METADATA_KEEP = new Set(['_vatBreakdown']);

function strip(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_') && !RECORD_LEVEL_METADATA_KEEP.has(k)) continue;
    out[k] = v;
  }
  return out;
}

const baseLinks = (resource) => ({
  Self: `https://example.test/open-finance/account-information/v2.1/${resource}`,
});

const insuranceBaseLinks = (resource) => ({
  Self: `https://example.test/open-finance/insurance/v2.1/${resource}`,
});

const atmBaseLinks = (resource) => ({
  Self: `https://example.test/open-finance/atm/v2.1/${resource}`,
});

/**
 * Build an envelope object per endpoint shape (mirrors the spec-validation
 * test envelopes) so the JSON exports look like real wire payloads.
 *
 * Banking and insurance bundles flow through the same function: domain is
 * inferred from `bundle.domain` (set by the generator dispatcher), and the
 * matching envelope set is emitted. The MCP fixture package consumes these
 * envelopes for both domains, so the output shape MUST match what the
 * spec-validation tests assert against the AJV-compiled schema.
 */
// Per-domain envelope emitters, keyed identically to the generator's
// DOMAIN_PIPELINES registry (src/generator/index.js). A new domain adds
// one entry here and one there.
const DOMAIN_ENVELOPES = {
  banking: (bundle, ctx) => bankingEnvelopesFromBundle(bundle, ctx),
  insurance: (bundle, ctx) => insuranceEnvelopesFromBundle(bundle, ctx),
  atm: (bundle, ctx) => atmEnvelopesFromBundle(bundle, ctx),
};

export function envelopesFromBundle(bundle, ctx) {
  // Phase 2.2 — multi-domain bundles carry a `domains` array and have
  // both banking and insurance fields populated. Emit both envelope
  // sets so all endpoints land at the same persona path.
  if (Array.isArray(bundle.domains) && bundle.domains.length > 1) {
    const envelopes = {};
    for (const domain of bundle.domains) {
      const emit = DOMAIN_ENVELOPES[domain];
      if (!emit) {
        // Mirror the generator registry's posture: an unknown domain is a
        // hard error, never a silently missing endpoint family (A-6).
        throw new Error(`envelopesFromBundle: unknown bundle domain: ${domain}`);
      }
      Object.assign(envelopes, emit(bundle, ctx));
    }
    return envelopes;
  }
  if (bundle.domain === 'insurance') {
    return insuranceEnvelopesFromBundle(bundle, ctx);
  }
  if (bundle.domain === 'atm') {
    return atmEnvelopesFromBundle(bundle, ctx);
  }
  return bankingEnvelopesFromBundle(bundle, ctx);
}

/**
 * ATM domain envelope — Phase 2.3 GA. Single read endpoint `GET /atms`
 * returning `AEReadAtms1`: { Data: AEReadAtmsData1 (array of ATM
 * records), Meta: AEReadAtmsMeta1 (LastUpdatedDateTime + TotalRecords) }.
 * No Links inside the schema's required set — but the sandbox wraps
 * every envelope with `Links.Self` for consistency with the banking
 * and insurance shapes (TPPs walking results across the three domains
 * shouldn't have to special-case ATM).
 */
function atmEnvelopesFromBundle(bundle, ctx) {
  const envelopes = {};
  const data = (bundle.atms ?? []).map(strip);
  envelopes['/atms'] = wrapAtm(
    {
      Data: data,
      Meta: {
        LastUpdatedDateTime: bundle.meta?.LastUpdatedDateTime,
        TotalRecords: data.length,
      },
    },
    'atms',
    ctx,
  );
  return envelopes;
}

// Project a party record onto the AEPartyIdentityAssurance4 vocabulary
// (PartyId / PartyNumber / PartyCategory / VerifiedClaims) used by the
// bundle-level /parties endpoint.
function toAssurance4(party) {
  const out = {};
  for (const k of ['PartyId', 'PartyNumber', 'PartyCategory', 'VerifiedClaims']) {
    if (party?.[k] !== undefined) out[k] = party[k];
  }
  return out;
}

function bankingEnvelopesFromBundle(bundle, ctx) {
  const envelopes = {};
  envelopes['/accounts'] = wrap({ Data: { Account: bundle.accounts.map(strip) } }, 'accounts', ctx);
  // /parties returns AEReadParty4 whose Party is AEPartyIdentityAssurance4 —
  // it does NOT admit the Assurance2-only keys (PartyType, AccountRole) that
  // the per-account /accounts/{id}/parties (AEReadParty2) shape carries.
  envelopes['/parties'] = wrap(
    { Data: { Party: toAssurance4(strip(bundle.callingUserParty)) } },
    'parties',
    ctx,
  );

  for (const acc of bundle.accounts) {
    const id = acc.AccountId;
    // Account-by-id returns AEReadAccountId: AccountId is hoisted to a
    // Data-level sibling, and the inner AEAccountId object must NOT carry
    // its own AccountId key (additionalProperties: false).
    const { AccountId: _hoisted, ...detailAccount } = strip(acc);
    envelopes[`/accounts/${id}`] = wrap(
      { Data: { AccountId: id, Account: detailAccount } },
      `accounts/${id}`,
      ctx,
    );
    envelopes[`/accounts/${id}/balances`] = wrap(
      {
        Data: {
          AccountId: id,
          Balance: bundle.balances.filter((b) => b._accountId === id).map(strip),
        },
      },
      `accounts/${id}/balances`,
      ctx,
    );
    envelopes[`/accounts/${id}/transactions`] = wrap(
      {
        Data: {
          AccountId: id,
          Transaction: bundle.transactions.filter((t) => t._accountId === id).map(strip),
        },
      },
      `accounts/${id}/transactions`,
      ctx,
    );
    envelopes[`/accounts/${id}/standing-orders`] = wrap(
      {
        Data: {
          AccountId: id,
          StandingOrder: bundle.standingOrders.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/standing-orders`,
      ctx,
    );
    envelopes[`/accounts/${id}/direct-debits`] = wrap(
      {
        Data: {
          AccountId: id,
          DirectDebit: bundle.directDebits.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/direct-debits`,
      ctx,
    );
    envelopes[`/accounts/${id}/beneficiaries`] = wrap(
      {
        Data: {
          AccountId: id,
          Beneficiary: bundle.beneficiaries.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/beneficiaries`,
      ctx,
    );
    envelopes[`/accounts/${id}/scheduled-payments`] = wrap(
      {
        Data: {
          AccountId: id,
          ScheduledPayment: bundle.scheduledPayments.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/scheduled-payments`,
      ctx,
    );
    envelopes[`/accounts/${id}/product`] = wrap(
      {
        Data: {
          AccountId: id,
          Product: bundle.product.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/product`,
      ctx,
    );
    envelopes[`/accounts/${id}/parties`] = wrap(
      {
        Data: {
          AccountId: id,
          Party: bundle.parties.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/parties`,
      ctx,
    );
    envelopes[`/accounts/${id}/statements`] = wrap(
      {
        Data: {
          AccountId: id,
          AccountSubType: acc.AccountSubType,
          Statements: bundle.statements.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/statements`,
      ctx,
    );
  }
  return envelopes;
}

/**
 * Insurance domain envelopes — Phase 2.0 (Motor) + Phase 2.1 (+Home).
 * Mirrors the envelope shapes asserted by `tests/spec-validation.insurance.test.mjs`
 * so the same wire payloads validate against the v2.1-errata1 schemas.
 *
 * Both templated paths (`/motor-insurance-policies/{InsurancePolicyId}` etc.)
 * and resolved paths (with the actual policy / quote id substituted) are
 * emitted, mirroring the banking convention. Callers that don't know the
 * synthetic id can use the templated key; those that do can use the resolved
 * one. A bundle carries exactly one line — the dispatcher in
 * src/generator/insurance/index.js builds either a motor or a home bundle.
 */
function insuranceEnvelopesFromBundle(bundle, ctx) {
  const envelopes = {};
  for (const line of ['motor', 'home', 'health', 'life', 'travel', 'renters', 'employment']) {
    const cap = line.charAt(0).toUpperCase() + line.slice(1);
    emitLineEnvelopes(envelopes, bundle, ctx, {
      line,
      policiesKey: `${line}Policies`,
      summariesKey: `${line}PolicySummaries`,
      quoteKey: `${line}Quote`,
      // Phase 2.2 — multi-domain bundles carry per-line payment-details
      // (e.g. `motorPaymentDetails`) because each insurance line writes
      // its own. emitLineEnvelopes falls back to the singular
      // `paymentDetails` for single-line bundles. The `cap` is just
      // here to keep the per-line variable name readable below.
      paymentDetailsKey: `${line}PaymentDetails`,
      pathPrefix: `${line}-insurance`,
    });
    void cap;
  }
  // Insurance Consents — every insurance bundle carries at least one
  // consent record. Single-line bundles carry one; multi-line
  // (multi-domain) bundles accumulate one per line. The list endpoint
  // returns the full array; every consent gets its own resolved-id
  // detail endpoint, and the FIRST consent additionally backs the
  // templated `/insurance-consents/{ConsentId}` path for callers that
  // don't know the synthetic id.
  if (bundle.consents?.length > 0) {
    envelopes['/insurance-consents'] = wrapInsurance(
      { Data: bundle.consents },
      'insurance-consents',
      ctx,
    );
    for (const consent of bundle.consents) {
      envelopes[`/insurance-consents/${consent.ConsentId}`] = wrapInsurance(
        { Data: consent },
        `insurance-consents/${consent.ConsentId}`,
        ctx,
      );
    }
    const firstConsent = bundle.consents[0];
    envelopes['/insurance-consents/{ConsentId}'] =
      envelopes[`/insurance-consents/${firstConsent.ConsentId}`];
  }
  return envelopes;
}

function emitLineEnvelopes(envelopes, bundle, ctx, cfg) {
  const policy = bundle[cfg.policiesKey]?.[0];
  const quote = bundle[cfg.quoteKey];
  const summaries = bundle[cfg.summariesKey];
  if (!policy && !quote && !summaries) return;

  if (summaries) {
    envelopes[`/${cfg.pathPrefix}-policies`] = wrapInsurance(
      { Data: { Policies: summaries } },
      `${cfg.pathPrefix}-policies`,
      ctx,
    );
  }

  if (policy) {
    const policyId = policy.InsurancePolicyId;
    envelopes[`/${cfg.pathPrefix}-policies/${policyId}`] = wrapInsurance(
      { Data: policy },
      `${cfg.pathPrefix}-policies/${policyId}`,
      ctx,
    );
    envelopes[`/${cfg.pathPrefix}-policies/{InsurancePolicyId}`] =
      envelopes[`/${cfg.pathPrefix}-policies/${policyId}`];

    // Phase 2.2 — prefer the per-line payment-details key (set when a
    // multi-domain persona iterates lines and renames to avoid
    // collision); fall back to the singular `paymentDetails` for
    // single-line insurance bundles.
    const paymentDetails = bundle[cfg.paymentDetailsKey] ?? bundle.paymentDetails;
    envelopes[`/${cfg.pathPrefix}-policies/${policyId}/payment-details`] = wrapInsurance(
      { Data: paymentDetails },
      `${cfg.pathPrefix}-policies/${policyId}/payment-details`,
      ctx,
    );
    envelopes[`/${cfg.pathPrefix}-policies/{InsurancePolicyId}/payment-details`] =
      envelopes[`/${cfg.pathPrefix}-policies/${policyId}/payment-details`];
  }

  if (quote) {
    const quoteId = quote.QuoteId;
    envelopes[`/${cfg.pathPrefix}-quotes/${quoteId}`] = wrapInsurance(
      { Data: quote },
      `${cfg.pathPrefix}-quotes/${quoteId}`,
      ctx,
    );
    envelopes[`/${cfg.pathPrefix}-quotes/{QuoteId}`] =
      envelopes[`/${cfg.pathPrefix}-quotes/${quoteId}`];
  }
}

function wrap(envelope, resourceUri, ctx) {
  return {
    ...envelope,
    Links: baseLinks(resourceUri),
    Meta: { TotalPages: 1 },
    _watermark: watermark(ctx),
    _persona: ctx.personaId,
    _lfi: ctx.lfi,
    _seed: ctx.seed,
    _specVersion: ctx.specVersions?.banking ?? ctx.specVersion ?? null,
    _specSha: ctx.specSha ?? null,
    _retrievedAt: ctx.retrievedAt,
  };
}

function wrapInsurance(envelope, resourceUri, ctx) {
  return {
    ...envelope,
    Links: insuranceBaseLinks(resourceUri),
    Meta: { TotalPages: 1 },
    _watermark: watermark(ctx),
    _persona: ctx.personaId,
    _lfi: ctx.lfi,
    _seed: ctx.seed,
    _domain: 'insurance',
    _specVersion: ctx.specVersions?.insurance ?? ctx.specVersion ?? null,
    _specSha: ctx.specSha ?? null,
    _retrievedAt: ctx.retrievedAt,
  };
}

// ATM envelope keeps the spec's mandatory `Meta` shape (set by
// atmEnvelopesFromBundle) and adds only `Links.Self` for cross-domain
// shape parity. `_specSha` is the ATM-domain pin when available; the
// fixture-package builder injects it as `ctx.specVersions.atm`.
function wrapAtm(envelope, resourceUri, ctx) {
  const { Data, Meta } = envelope;
  return {
    Data,
    Meta,
    Links: atmBaseLinks(resourceUri),
    _watermark: watermark(ctx),
    _persona: ctx.personaId,
    _lfi: ctx.lfi,
    _seed: ctx.seed,
    _domain: 'atm',
    _specVersion: ctx.specVersions?.atm ?? ctx.specVersion ?? null,
    _specSha: ctx.specSha ?? null,
    _retrievedAt: ctx.retrievedAt,
  };
}

/**
 * Build a flat CSV per resource type. Every CSV starts with a `# SYNTHETIC ...`
 * watermark comment line. Empty cells render as the empty string.
 */
export function csvForResource(rows, ctx) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `${watermarkCsvHeader(ctx)}\n# (no rows)\n`;
  }
  const cleaned = rows.map(strip);
  const columns = Array.from(
    cleaned.reduce((set, r) => {
      for (const k of Object.keys(r)) set.add(k);
      return set;
    }, new Set()),
  );
  const escape = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.join(',');
  const body = cleaned.map((r) => columns.map((c) => escape(r[c])).join(',')).join('\n');
  return `${watermarkCsvHeader(ctx)}\n${header}\n${body}\n`;
}

const RESOURCE_TO_BUNDLE_KEY = Object.freeze({
  Account: 'accounts',
  Balance: 'balances',
  Transaction: 'transactions',
  StandingOrder: 'standingOrders',
  DirectDebit: 'directDebits',
  Beneficiary: 'beneficiaries',
  ScheduledPayment: 'scheduledPayments',
  Product: 'product',
  Party: 'parties',
  Statements: 'statements',
});

export function csvBundleByResource(bundle, ctx) {
  const out = {};
  for (const [resource, key] of Object.entries(RESOURCE_TO_BUNDLE_KEY)) {
    out[resource] = csvForResource(bundle[key] ?? [], ctx);
  }
  return out;
}

// --- Browser-only download helpers ---

export function downloadJson(envelope, filename) {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}

export function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

/**
 * Build a *.tar archive in the browser without any dependencies. Each entry
 * gets a 512-byte header followed by the file contents padded to a 512-byte
 * boundary. Two empty 512-byte blocks terminate the archive.
 */
export function buildTar(files) {
  const blocks = [];
  for (const f of files) {
    const content = new TextEncoder().encode(f.contents);
    const header = makeTarHeader(f.name, content.length);
    blocks.push(header);
    blocks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(512));
  blocks.push(new Uint8Array(512));
  return new Blob(blocks, { type: 'application/x-tar' });
}

function makeTarHeader(name, size) {
  const buf = new Uint8Array(512);
  writeTarStr(buf, 0, name, 100);
  writeTarStr(buf, 100, '0000644 ', 8);
  writeTarStr(buf, 108, '0000000 ', 8);
  writeTarStr(buf, 116, '0000000 ', 8);
  writeTarStr(buf, 124, size.toString(8).padStart(11, '0') + ' ', 12);
  writeTarStr(
    buf,
    136,
    Math.floor(Date.now() / 1000)
      .toString(8)
      .padStart(11, '0') + ' ',
    12,
  );
  // Checksum placeholder is 8 spaces; written after sum is computed.
  for (let i = 148; i < 156; i++) buf[i] = 0x20;
  buf[156] = 0x30; // typeflag = '0' regular file
  writeTarStr(buf, 257, 'ustar ', 6);
  buf[263] = 0x20;
  buf[264] = 0;
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += buf[i];
  const csStr = checksum.toString(8).padStart(6, '0');
  writeTarStr(buf, 148, csStr, 6);
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

function writeTarStr(buf, offset, str, len) {
  const enc = new TextEncoder().encode(str);
  for (let i = 0; i < len && i < enc.length; i++) buf[offset + i] = enc[i];
}

function triggerDownload(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }, 0);
}

export function downloadTarball(bundle, ctx, filename = 'sandbox-bundle.tar') {
  const envelopes = envelopesFromBundle(bundle, ctx);
  const csvByResource = csvBundleByResource(bundle, ctx);
  const files = [];
  for (const [endpoint, env] of Object.entries(envelopes)) {
    const safe = endpoint.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '');
    files.push({ name: `json/${safe || 'root'}.json`, contents: JSON.stringify(env, null, 2) });
  }
  for (const [resource, csv] of Object.entries(csvByResource)) {
    files.push({ name: `csv/${resource}.csv`, contents: csv });
  }
  files.push({ name: 'WATERMARK.txt', contents: `${watermark(ctx)}\n` });
  const blob = buildTar(files);
  triggerDownload(blob, filename);
}

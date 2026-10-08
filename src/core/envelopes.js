// Shared deterministic endpoint envelopes and downloads. Underscore metadata is removable; wire fields retain domain-specific closure.

import { scenarioDescriptor } from './scenario.js';
import { watermark, watermarkCsvHeader } from '../shared/watermark.js';
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
const DOMAIN_ENVELOPES = {
  banking: (bundle, ctx) => bankingEnvelopesFromBundle(bundle, ctx),
  insurance: (bundle, ctx) => insuranceEnvelopesFromBundle(bundle, ctx),
  atm: (bundle, ctx) => atmEnvelopesFromBundle(bundle, ctx),
};

export function envelopesFromBundle(bundle, ctx) {
  ctx = {
    ...ctx,
    scenario: scenarioDescriptor({
      ...ctx,
      referenceDate: ctx.referenceDate ?? bundle.nowIso,
      specProvenance: ctx.specProvenance ?? null,
    }),
  };
  if (Array.isArray(bundle.domains) && bundle.domains.length > 1) {
    const envelopes = {};
    for (const domain of bundle.domains) {
      const emit = DOMAIN_ENVELOPES[domain];
      if (!emit) {
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
  envelopes['/parties'] = wrap(
    { Data: { Party: toAssurance4(strip(bundle.callingUserParty)) } },
    'parties',
    ctx,
  );

  for (const acc of bundle.accounts) {
    const id = acc.AccountId;
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

function insuranceEnvelopesFromBundle(bundle, ctx) {
  const envelopes = {};
  for (const line of ['motor', 'home', 'health', 'life', 'travel', 'renters', 'employment']) {
    const cap = line.charAt(0).toUpperCase() + line.slice(1);
    emitLineEnvelopes(envelopes, bundle, ctx, {
      line,
      policiesKey: `${line}Policies`,
      summariesKey: `${line}PolicySummaries`,
      quoteKey: `${line}Quote`,
      paymentDetailsKey: `${line}PaymentDetails`,
      pathPrefix: `${line}-insurance`,
    });
    void cap;
  }
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
    _scenario: ctx.scenario,
    _watermark: watermark(ctx),
    _persona: ctx.personaId,
    _lfi: ctx.lfi,
    _seed: ctx.seed,
    _specVersion: ctx.specVersions?.banking ?? ctx.specVersion ?? null,
    _specSha: ctx.specProvenance?.banking?.commit ?? ctx.specSha ?? null,
    _retrievedAt:
      ctx.specProvenance?.banking?.retrievedAt ?? ctx.retrievedAt ?? ctx.scenario.referenceDate,
  };
}

function wrapInsurance(envelope, resourceUri, ctx) {
  return {
    ...envelope,
    Links: insuranceBaseLinks(resourceUri),
    Meta:
      resourceUri.endsWith('-policies') || resourceUri == 'insurance-consents'
        ? { TotalPages: 1 }
        : {},
    _scenario: ctx.scenario,
    _watermark: watermark(ctx),
    _persona: ctx.personaId,
    _lfi: ctx.lfi,
    _seed: ctx.seed,
    _domain: 'insurance',
    _specVersion: ctx.specVersions?.insurance ?? ctx.specVersion ?? null,
    _specSha: ctx.specProvenance?.insurance?.commit ?? ctx.specSha ?? null,
    _retrievedAt:
      ctx.specProvenance?.insurance?.retrievedAt ?? ctx.retrievedAt ?? ctx.scenario.referenceDate,
  };
}
function wrapAtm(envelope, resourceUri, ctx) {
  const { Data, Meta } = envelope;
  return {
    Data,
    Meta,
    _scenario: ctx.scenario,
    _watermark: watermark(ctx),
    _persona: ctx.personaId,
    _lfi: ctx.lfi,
    _seed: ctx.seed,
    _domain: 'atm',
    _specVersion: ctx.specVersions?.atm ?? ctx.specVersion ?? null,
    _specSha: ctx.specProvenance?.atm?.commit ?? ctx.specSha ?? null,
    _retrievedAt:
      ctx.specProvenance?.atm?.retrievedAt ?? ctx.retrievedAt ?? ctx.scenario.referenceDate,
  };
}

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

export function downloadJson(envelope, filename) {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}

export function downloadCsv(csvText, filename) {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  triggerDownload(blob, filename);
}

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

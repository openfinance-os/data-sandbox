// Export — EXP-19 / §6.5.
// Three formats: full OF-spec JSON (per endpoint), flat CSV per resource,
// tarball of all of the above. Every file carries the §6.5 watermark.
// Phase 1 — works in the browser only (no Node-side helpers needed).

import { watermark, watermarkJsonEnvelope, watermarkCsvHeader } from '../shared/watermark.js';

// Strip generator-internal underscore-prefixed fields before serialisation.
function strip(rec) {
  const out = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

const baseLinks = (resource) => ({
  Self: `https://example.test/open-finance/account-information/v2.1/${resource}`,
});

/**
 * Build an envelope object per endpoint shape (mirrors the spec-validation
 * test envelopes) so the JSON exports look like real wire payloads.
 */
export function envelopesFromBundle(bundle, ctx) {
  const envelopes = {};
  envelopes['/accounts'] = wrap({ Data: { Account: bundle.accounts.map(strip) } }, 'accounts', ctx);
  envelopes['/parties'] = wrap({ Data: { Party: strip(bundle.callingUserParty) } }, 'parties', ctx);

  for (const acc of bundle.accounts) {
    const id = acc.AccountId;
    envelopes[`/accounts/${id}`] = wrap(
      { Data: { AccountId: id, Account: strip(acc) } },
      `accounts/${id}`,
      ctx
    );
    envelopes[`/accounts/${id}/balances`] = wrap(
      { Data: { AccountId: id, Balance: bundle.balances.filter((b) => b._accountId === id).map(strip) } },
      `accounts/${id}/balances`, ctx
    );
    envelopes[`/accounts/${id}/transactions`] = wrap(
      {
        Data: {
          AccountId: id,
          Transaction: bundle.transactions.filter((t) => t._accountId === id).map(strip),
        },
      },
      `accounts/${id}/transactions`, ctx
    );
    envelopes[`/accounts/${id}/standing-orders`] = wrap(
      { Data: { AccountId: id, StandingOrder: bundle.standingOrders.filter((x) => x._accountId === id).map(strip) } },
      `accounts/${id}/standing-orders`, ctx
    );
    envelopes[`/accounts/${id}/direct-debits`] = wrap(
      { Data: { AccountId: id, DirectDebit: bundle.directDebits.filter((x) => x._accountId === id).map(strip) } },
      `accounts/${id}/direct-debits`, ctx
    );
    envelopes[`/accounts/${id}/beneficiaries`] = wrap(
      { Data: { AccountId: id, Beneficiary: bundle.beneficiaries.filter((x) => x._accountId === id).map(strip) } },
      `accounts/${id}/beneficiaries`, ctx
    );
    envelopes[`/accounts/${id}/scheduled-payments`] = wrap(
      { Data: { AccountId: id, ScheduledPayment: bundle.scheduledPayments.filter((x) => x._accountId === id).map(strip) } },
      `accounts/${id}/scheduled-payments`, ctx
    );
    envelopes[`/accounts/${id}/product`] = wrap(
      { Data: { AccountId: id, Product: bundle.product.filter((x) => x._accountId === id).map(strip) } },
      `accounts/${id}/product`, ctx
    );
    envelopes[`/accounts/${id}/parties`] = wrap(
      { Data: { AccountId: id, Party: bundle.parties.filter((x) => x._accountId === id).map(strip) } },
      `accounts/${id}/parties`, ctx
    );
    envelopes[`/accounts/${id}/statements`] = wrap(
      {
        Data: {
          AccountId: id,
          AccountSubType: acc.AccountSubType,
          Statements: bundle.statements.filter((x) => x._accountId === id).map(strip),
        },
      },
      `accounts/${id}/statements`, ctx
    );
  }
  return envelopes;
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
    _specVersion: ctx.specVersion ?? null,
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
    }, new Set())
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
  writeTarStr(buf, 136, Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + ' ', 12);
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

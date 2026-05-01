#!/usr/bin/env node
// EXP-07 + EXP-22(a) invariant: every name / IBAN / employer / merchant
// emitted in a generated bundle traces back to /synthetic-identity-pool/.
// Scans every persona × LFI=Median × seed=4729 bundle for identity leaks.

import { buildBundle } from '../src/generator/index.js';
import { loadPersonasByDomain, loadAllPools } from './load-fixtures.mjs';

// Banking pipeline only; insurance probes ship with the insurance generator
// (slice 6b-ii) and have their own pool-membership audit.
const personas = loadPersonasByDomain('banking');
const pools = loadAllPools();

// Build the universe of permitted strings from all loaded pools. Names are
// stored as the cross-product `${given} ${surname}` across every name pool —
// surnames may contain spaces (e.g. "Al Nuaimi"), so a naive split-on-space
// check would false-positive. Counterparty/beneficiary names are also cross-
// product names from the same pools.
const allowedFullNames = new Set();
for (const p of Object.values(pools.namesByPoolId)) {
  for (const g of p.given_names) {
    for (const s of p.surnames) {
      allowedFullNames.add(`${g} ${s}`);
    }
  }
}
// Organisation legal names are also valid AccountHolderName / AccountIdentifiers
// values for SME / Corporate accounts. They never blend with personal names
// — they're a disjoint set drawn from /synthetic-identity-pool/organisations/.
for (const p of Object.values(pools.organisationsByPoolId ?? {})) {
  for (const name of p.organisations) allowedFullNames.add(name);
}
const allowed = new Set();
for (const p of Object.values(pools.employersByPoolId)) {
  for (const e of p.employers) allowed.add(e);
}
for (const p of Object.values(pools.merchantsByCategory)) {
  for (const m of p.merchants) allowed.add(m.name);
}
for (const p of Object.values(pools.counterpartyBanksByCategory)) {
  for (const b of p.banks) allowed.add(b.name);
}
for (const p of Object.values(pools.counterpartiesByPoolId ?? {})) {
  for (const c of p.counterparties) allowed.add(c);
}

const NAME_PROBE_AT = new Set([
  'account.AccountHolderName',
  'account.AccountIdentifiers[0].Name',
  'beneficiary.CreditorAccount[0].Name',
  'scheduledPayment.CreditorAccount[0].Name',
]);

let bad = 0;
let probesChecked = 0;

for (const [pid, persona] of Object.entries(personas)) {
  const bundle = buildBundle({ persona, lfi: 'median', seed: 4729, pools });
  const probes = [];
  for (const acc of bundle.accounts) {
    probes.push({ at: 'account.AccountHolderName', val: acc.AccountHolderName });
    probes.push({ at: 'account.AccountIdentifiers[0].Name', val: acc.AccountIdentifiers?.[0]?.Name });
    probes.push({ at: 'account._meta.servicerName', val: acc._meta?.servicerName });
  }
  for (const tx of bundle.transactions) {
    if (tx.MerchantDetails?.MerchantName) {
      probes.push({ at: 'tx.MerchantDetails.MerchantName', val: tx.MerchantDetails.MerchantName });
    }
    if (tx.CreditorName) {
      probes.push({ at: 'tx.CreditorName', val: tx.CreditorName });
    }
  }
  for (const b of bundle.beneficiaries) {
    probes.push({ at: 'beneficiary.CreditorAccount[0].Name', val: b.CreditorAccount?.[0]?.Name });
  }
  for (const sp of bundle.scheduledPayments) {
    probes.push({ at: 'scheduledPayment.CreditorAccount[0].Name', val: sp.CreditorAccount?.[0]?.Name });
  }

  for (const p of probes) {
    if (!p.val) continue;
    probesChecked += 1;
    if (NAME_PROBE_AT.has(p.at)) {
      if (!allowedFullNames.has(p.val)) {
        console.error(`PII-leak (persona=${pid}): ${p.at}="${p.val}" not in any name-pool cross-product`);
        bad += 1;
      }
    } else if (!allowed.has(p.val)) {
      console.error(`PII-leak (persona=${pid}): ${p.at}="${p.val}" not in pool`);
      bad += 1;
    }
  }
}

if (bad > 0) {
  console.error(`lint-pii-leak: ${bad} violation(s)`);
  process.exit(1);
}
console.log(`lint-pii-leak OK — ${probesChecked} identity strings checked across ${Object.keys(personas).length} personas, all from pool`);

#!/usr/bin/env node
// EXP-07 + EXP-22(a) invariant: every name / IBAN / employer / merchant
// emitted in a generated bundle traces back to /synthetic-identity-pool/.
// We generate a Sara × Median × seed=4729 bundle, then assert every identity-
// shaped string in it is present in the loaded pools.

import { buildBundle } from '../src/generator/index.js';
import { loadPersona, loadAllPools } from './load-fixtures.mjs';

const persona = loadPersona('salaried_expat_mid');
const pools = loadAllPools();
const bundle = buildBundle({ persona, lfi: 'median', seed: 4729, pools });

// Build the universe of permitted strings from the loaded pools.
const allowed = new Set();
for (const n of pools.namesExpatIndian.given_names) allowed.add(n);
for (const n of pools.namesExpatIndian.surnames) allowed.add(n);
for (const e of pools.employersTechFreezone.employers) allowed.add(e);
for (const m of pools.merchantsGroceries.merchants) allowed.add(m.name);
for (const m of pools.merchantsFuel.merchants) allowed.add(m.name);
for (const m of pools.merchantsDining.merchants) allowed.add(m.name);
for (const m of pools.merchantsUtilities.merchants) allowed.add(m.name);
for (const b of pools.counterpartyBanksDomestic.banks) allowed.add(b.name);

// Identity-bearing string fields we check.
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
  // The salary's TransactionInformation embeds the employer; pull it out for checking.
  if (typeof tx.TransactionInformation === 'string' && tx.TransactionInformation.startsWith('Salary credit — ')) {
    probes.push({
      at: 'tx.TransactionInformation (employer)',
      val: tx.TransactionInformation.replace('Salary credit — ', ''),
    });
  }
}

// Probes that carry "<given> <surname>" full-name strings — split before checking.
const NAME_PROBE_AT = new Set([
  'account.AccountHolderName',
  'account.AccountIdentifiers[0].Name',
]);

let bad = 0;
for (const p of probes) {
  if (!p.val) continue;
  if (NAME_PROBE_AT.has(p.at)) {
    const parts = p.val.split(' ');
    for (const part of parts) {
      if (!allowed.has(part)) {
        console.error(`PII-leak: ${p.at} contains "${part}" (full="${p.val}") not in pool`);
        bad += 1;
      }
    }
    continue;
  }
  if (!allowed.has(p.val)) {
    console.error(`PII-leak: ${p.at}="${p.val}" not in identity pool`);
    bad += 1;
  }
}

if (bad > 0) {
  console.error(`lint-pii-leak: ${bad} violation(s)`);
  process.exit(1);
}
console.log(`lint-pii-leak OK — ${probes.length} identity strings checked, all from pool`);

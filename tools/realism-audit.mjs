#!/usr/bin/env node
// Realism audit — two modes:
//
//   node tools/realism-audit.mjs            → human-readable REPORT mode:
//       prints representative transaction rows + distribution notes for a
//       handful of archetypes so a maintainer can eyeball "does this look
//       like real bank-core output?".
//
//   node tools/realism-audit.mjs --assert   → CI ASSERT mode (T-08c):
//       runs the ENRICHMENT_REALISM_PLAN.md §Verification diversity check —
//       across a deterministic 100-bundle persona×lfi×seed sample, count
//       distinct MCCs, distinct merchant display forms, and distinct
//       narrative shapes, and FAIL (exit 1) below the plan's floors:
//         ≥ 12 distinct MCCs
//         ≥ 80 distinct merchants
//         ≥ 30 distinct narrative shapes
//
// Metric definitions (assert mode):
//   - MCCs: distinct MerchantDetails.MerchantCategoryCode values.
//   - Merchants: distinct merchant DISPLAY FORMS an enrichment engine
//     actually sees — the union of MerchantDetails.MerchantName values and
//     pool-declared display_variants (R2 DBA drift) observed verbatim in
//     TransactionInformation narratives. (The canonical merchant universe
//     is 79 names; the ≥80 floor is only meaningful over display forms,
//     which is exactly what R2's drift exists to diversify.)
//   - Narrative shapes: distinct structural templates of
//     TransactionInformation after collapsing digit runs to '#' and word
//     tokens to 'A' (separators / prefixes / suffix patterns survive, so
//     the count measures grammar variety, not merchant variety).

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { buildBundle } from '../src/generator/index.js';
import { loadAllPersonas, loadPersonasByDomain, loadAllPools, repoRoot } from './load-fixtures.mjs';

const ASSERT_MODE = process.argv.includes('--assert');

const pools = loadAllPools();

// ─── Assert mode (T-08c) ────────────────────────────────────────────────

const FLOORS = {
  mccs: 12,
  merchants: 80,
  narrativeShapes: 30,
};
const SAMPLE_SIZE = 100;

function narrativeShape(info) {
  // Digit runs → '#', word tokens (incl. accented/Arabic letters) → 'A'.
  // Separators (/ * . spaces %) survive, so 'POS/MARKETMARK HYP 84421'
  // and 'TST* OASISGO DXB 30188' count as different shapes.
  return info.replace(/\d+/g, '#').replace(/[A-Za-zÀ-ɏ؀-ۿ][A-Za-zÀ-ɏ؀-ۿ']*/g, 'A');
}

function poolDisplayForms() {
  const forms = new Set();
  const dir = path.join(repoRoot, 'synthetic-identity-pool/merchants');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.yaml')) continue;
    const doc = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const m of doc?.merchants ?? []) {
      if (m.name) forms.add(m.name);
      for (const v of m.display_variants ?? []) forms.add(v);
      for (const v of m.display_variants_ar ?? []) forms.add(v);
    }
  }
  return forms;
}

function sampleCombos() {
  // Deterministic: banking personas sorted by id, LFIs round-robin, four
  // fixed seeds — the same 100 (persona, lfi, seed) tuples on every run.
  const personas = loadPersonasByDomain('banking');
  const pids = Object.keys(personas).sort();
  const lfis = ['rich', 'median', 'sparse'];
  const combos = [];
  let i = 0;
  outer: for (const seed of [4729, 11, 208, 3067]) {
    for (const pid of pids) {
      combos.push({ persona: personas[pid], lfi: lfis[i++ % 3], seed });
      if (combos.length >= SAMPLE_SIZE) break outer;
    }
  }
  return combos;
}

function runAssert() {
  const displayForms = poolDisplayForms();
  const mccs = new Set();
  const merchants = new Set();
  const shapes = new Set();
  const combos = sampleCombos();

  for (const { persona, lfi, seed } of combos) {
    const bundle = buildBundle({ persona, lfi, seed, pools });
    for (const t of bundle.transactions ?? []) {
      if (t.MerchantDetails?.MerchantCategoryCode) mccs.add(t.MerchantDetails.MerchantCategoryCode);
      if (t.MerchantDetails?.MerchantName) merchants.add(t.MerchantDetails.MerchantName);
      const info = t.TransactionInformation;
      if (info) {
        shapes.add(narrativeShape(info));
        for (const form of displayForms) {
          if (info.includes(form)) merchants.add(form);
        }
      }
    }
  }

  const results = [
    { label: 'distinct MCCs', got: mccs.size, floor: FLOORS.mccs },
    { label: 'distinct merchant display forms', got: merchants.size, floor: FLOORS.merchants },
    { label: 'distinct narrative shapes', got: shapes.size, floor: FLOORS.narrativeShapes },
  ];

  let failed = 0;
  for (const r of results) {
    const ok = r.got >= r.floor;
    const line = `realism-audit ${ok ? 'ok' : 'FAIL'} — ${r.label}: ${r.got} (floor ${r.floor}) across ${combos.length} bundles`;
    if (ok) console.log(line);
    else {
      console.error(line);
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error(
      `realism-audit: ${failed} floor(s) breached — the transaction stream has regressed below the ENRICHMENT_REALISM_PLAN.md §Verification minimums`,
    );
    process.exit(1);
  }
  console.log('realism-audit OK — all ENRICHMENT_REALISM_PLAN.md diversity floors met');
}

// ─── Report mode (original human-readable audit) ────────────────────────

function runReport() {
  const personas = loadAllPersonas();
  console.log('=== AUDIT — does the synthetic data look like real bank-core output? ===\n');

  const targetPersonas = [
    'salaried_expat_mid',
    'sme_cash_heavy',
    'hnw_multicurrency',
    'nsf_distressed',
  ];
  for (const pid of targetPersonas) {
    const persona = personas[pid];
    const bundle = buildBundle({ persona, lfi: 'rich', seed: 4729, pools });
    console.log(`--- ${pid} ---`);
    console.log(
      `accounts: ${bundle.accounts.length} | transactions: ${bundle.transactions.length}`,
    );
    // Show representative rows (salary, direct debit, POS, FX/cash if applicable)
    const sample = [
      bundle.transactions.find(
        (t) => t.SubTransactionType === 'Deposit' && t.Flags?.includes('Payroll'),
      ),
      bundle.transactions.find((t) => t.TransactionType === 'BillPayments'),
      bundle.transactions.find((t) => t.TransactionType === 'POS'),
      bundle.transactions.find((t) => t.TransactionType === 'InternationalTransfer'),
      bundle.transactions.find(
        (t) => t.TransactionType === 'Teller' && t.SubTransactionType === 'Deposit',
      ),
      bundle.transactions.find((t) => t.Status === 'Rejected'),
    ].filter(Boolean);
    for (const t of sample) {
      console.log(`  [${t.TransactionType}/${t.SubTransactionType}] ${t.Status}`);
      console.log(`    Ref: "${t.TransactionReference}"`);
      console.log(`    Info: "${t.TransactionInformation || '(none)'}"`);
      console.log(
        `    Booking: ${t.BookingDateTime}  Value: ${t.ValueDateTime || '(missing)'}  TxDate: ${t.TransactionDateTime}`,
      );
      console.log(`    Amount: ${t.Amount.Amount} ${t.Amount.Currency} ${t.CreditDebitIndicator}`);
      if (t.MerchantDetails)
        console.log(
          `    Merchant: "${t.MerchantDetails.MerchantName}" MCC=${t.MerchantDetails.MerchantCategoryCode}`,
        );
      if (t.CurrencyExchange)
        console.log(
          `    FX: ${t.CurrencyExchange.SourceCurrency}->${t.CurrencyExchange.TargetCurrency} @ ${t.CurrencyExchange.ExchangeRate}`,
        );
      if (t.Flags) console.log(`    Flags: ${JSON.stringify(t.Flags)}`);
    }
    // Distribution check
    const dayOfWeek = bundle.transactions.map((t) => new Date(t.BookingDateTime).getUTCDay());
    const fridayCount = dayOfWeek.filter((d) => d === 5).length;
    const totalCount = dayOfWeek.length;
    const statuses = [...new Set(bundle.transactions.map((t) => t.Status))];
    console.log(`  status distribution: ${statuses.join(', ')}`);
    console.log(
      `  Fridays: ${fridayCount}/${totalCount} (${((fridayCount / totalCount) * 100).toFixed(1)}%) — UAE weekend; real cores typically have ~0% on Fridays for retail flows`,
    );
    console.log(
      `  ValueDateTime != BookingDateTime: ${bundle.transactions.filter((t) => t.ValueDateTime && t.ValueDateTime !== t.BookingDateTime).length}/${totalCount}`,
    );
    console.log('');
  }
}

if (ASSERT_MODE) runAssert();
else runReport();

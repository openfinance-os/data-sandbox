#!/usr/bin/env node
// EXP-07 + EXP-22(a) invariant: every name / IBAN / employer / merchant
// emitted in a generated bundle traces back to /synthetic-identity-pool/
// (or, for insurance blocks the schema declares as persona-authored, to the
// persona manifest itself — which is in-repo, reviewed, fictional data).
//
// T-05a: covers ALL THREE domains. Scans every persona × LFI (Rich, Median,
// Sparse) × seed=4729 bundle for identity leaks — all three profiles, so a
// string surviving only one redaction path can't slip through. Multi-domain
// personas are built once per LFI and probed on both their banking and
// insurance halves. No sampling — the full 39-persona × 3-LFI matrix builds
// in a few seconds, well inside CI budget.

import { buildBundle } from '../src/generator/index.js';
import { loadAllPersonas, loadAllPools, personaDomains } from './load-fixtures.mjs';

const personas = loadAllPersonas();
const pools = loadAllPools();

// ─── Allowed-string universes ───────────────────────────────────────────
// Build the universe of permitted strings from all loaded pools. Names are
// stored as the cross-product `${given} ${surname}` across every name pool —
// surnames may contain spaces (e.g. "Al Nuaimi"), so a naive split-on-space
// check would false-positive. Counterparty/beneficiary names are also cross-
// product names from the same pools.
const allowedFullNames = new Set();
const allowedGivenNames = new Set();
const allowedSurnames = new Set();
for (const p of Object.values(pools.namesByPoolId)) {
  for (const g of p.given_names) {
    allowedGivenNames.add(g);
    for (const s of p.surnames) {
      allowedFullNames.add(`${g} ${s}`);
    }
  }
  for (const s of p.surnames) allowedSurnames.add(s);
}
// Organisation legal names are also valid AccountHolderName / AccountIdentifiers
// values for SME / Corporate accounts. They never blend with personal names
// — they're a disjoint set drawn from /synthetic-identity-pool/organisations/.
for (const p of Object.values(pools.organisationsByPoolId ?? {})) {
  for (const name of p.organisations) allowedFullNames.add(name);
}
const allowed = new Set();
const allowedEmployers = new Set();
for (const p of Object.values(pools.employersByPoolId)) {
  for (const e of p.employers) {
    allowed.add(e);
    allowedEmployers.add(e);
  }
}
for (const p of Object.values(pools.merchantsByCategory)) {
  for (const m of p.merchants) allowed.add(m.name);
}
const allowedBankNames = new Set();
for (const p of Object.values(pools.counterpartyBanksByCategory)) {
  for (const b of p.banks) {
    allowed.add(b.name);
    allowedBankNames.add(b.name);
  }
}
for (const p of Object.values(pools.counterpartiesByPoolId ?? {})) {
  for (const c of p.counterparties) allowed.add(c);
}

// Persona-manifest-authored identity strings. The insurance schema
// (personas/_schema.insurance.yaml) lets a persona declare insured-party /
// beneficiary given_name+surname and an employer name literally in the
// manifest; the generator passes them through verbatim. Those literals are
// reviewed, fictional, in-repo data — admit them into the allowed sets so
// the probe asserts "traces to pool OR to the persona's own manifest",
// never to anything the generator invented.
function collectManifestDeclaredIdentity(node) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const v of node) collectManifestDeclaredIdentity(v);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      if (k === 'given_name') allowedGivenNames.add(v);
      if (k === 'surname') allowedSurnames.add(v);
      if (k === 'employer_name') allowedEmployers.add(v);
    } else {
      collectManifestDeclaredIdentity(v);
    }
  }
}
for (const persona of Object.values(personas)) {
  collectManifestDeclaredIdentity(persona.health);
  collectManifestDeclaredIdentity(persona.life);
  collectManifestDeclaredIdentity(persona.travel);
  // employment line: employer.name is the manifest-authored employer.
  const employmentEmployer = persona.employment?.employer?.name;
  if (typeof employmentEmployer === 'string') allowedEmployers.add(employmentEmployer);
}

const NAME_PROBE_AT = new Set([
  'account.AccountHolderName',
  'account.AccountIdentifiers[0].Name',
  'beneficiary.CreditorAccount[0].Name',
  'scheduledPayment.CreditorAccount[0].Name',
]);

const LFI_PROFILES = ['rich', 'median', 'sparse'];
const INSURANCE_LINES = ['motor', 'home', 'health', 'life', 'travel', 'renters', 'employment'];

// ─── ATM domain constants ───────────────────────────────────────────────
// The ATM generator does NOT draw from /synthetic-identity-pool/ — its
// site / district / town vocabulary is a set of in-module synthetic
// constants (src/generator/atm/index.js). These tables MIRROR those
// constants so the lint can assert every emitted location string is
// composed from them and nothing else. If the generator's vocabulary
// changes, this lint fails loudly — update both together.
const ATM_SITE_PREFIXES = new Set([
  'Central',
  'Northern',
  'Southern',
  'Eastern',
  'Western',
  'Downtown',
  'Marina',
  'Mall',
  'Plaza',
  'Tower',
  'Mainstreet',
  'Corniche',
]);
const ATM_SITE_SUFFIXES = new Set(['Branch', 'Lobby', 'Drive-Thru', 'Outlet', 'Hub']);
const ATM_DISTRICTS = new Set([
  // AbuDhabi
  'Al Khalidiyah',
  'Al Muroor',
  'Al Wahda',
  'Khalifa City',
  'Yas Island',
  'Al Reem',
  // Dubai
  'Downtown',
  'Al Quoz',
  'Deira',
  'Jumeirah',
  'Business Bay',
  'Al Barsha',
  'Mirdif',
  // Sharjah
  'Al Majaz',
  'Al Qasimia',
  'Al Nahda',
  'Muweilah',
  'Al Khan',
  // Ajman
  'Al Nuaimiya',
  'Al Rashidiya',
  'Al Jurf',
  'Al Hamidiyah',
  // UmmAlQuwain
  'Al Salamah',
  'Al Madar',
  'Al Raas',
  // RasAlKhaimah
  'Al Nakheel',
  'Al Hamra',
  'Al Rams',
  'Al Mairid',
  // Fujairah
  'Al Faseel',
  'Al Gurfa',
  'Dibba',
  'Al Hayl',
]);
const ATM_TOWNS = new Set([
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
]);
// NG5: the emitting-LFI identity on ATM records must stay anonymous
// (Rich/Median/Sparse profile labels, never a real bank name).
const ATM_BRAND_RE = /^(Rich|Median|Sparse)-profile UAE .* — ATM Network$/;

let bad = 0;
let probesChecked = 0;

function fail(pid, lfi, at, val, universe) {
  console.error(`PII-leak (persona=${pid} lfi=${lfi}): ${at}="${val}" not in ${universe}`);
  bad += 1;
}

function check(pid, lfi, at, val, allowedSet, universe) {
  if (!val) return;
  probesChecked += 1;
  if (!allowedSet.has(val)) fail(pid, lfi, at, val, universe);
}

// ─── Banking probes (unchanged from the banking-only lint) ─────────────
function probeBanking(pid, lfi, bundle) {
  const probes = [];
  for (const acc of bundle.accounts ?? []) {
    probes.push({ at: 'account.AccountHolderName', val: acc.AccountHolderName });
    probes.push({
      at: 'account.AccountIdentifiers[0].Name',
      val: acc.AccountIdentifiers?.[0]?.Name,
    });
    probes.push({ at: 'account._meta.servicerName', val: acc._meta?.servicerName });
  }
  for (const tx of bundle.transactions ?? []) {
    if (tx.MerchantDetails?.MerchantName) {
      probes.push({
        at: 'tx.MerchantDetails.MerchantName',
        val: tx.MerchantDetails.MerchantName,
      });
    }
    if (tx.CreditorName) {
      probes.push({ at: 'tx.CreditorName', val: tx.CreditorName });
    }
  }
  for (const b of bundle.beneficiaries ?? []) {
    probes.push({ at: 'beneficiary.CreditorAccount[0].Name', val: b.CreditorAccount?.[0]?.Name });
  }
  for (const sp of bundle.scheduledPayments ?? []) {
    probes.push({
      at: 'scheduledPayment.CreditorAccount[0].Name',
      val: sp.CreditorAccount?.[0]?.Name,
    });
  }

  for (const p of probes) {
    if (!p.val) continue;
    probesChecked += 1;
    if (NAME_PROBE_AT.has(p.at)) {
      if (!allowedFullNames.has(p.val)) {
        fail(pid, lfi, p.at, p.val, 'any name-pool cross-product');
      }
    } else if (!allowed.has(p.val)) {
      fail(pid, lfi, p.at, p.val, 'pool');
    }
  }
}

// ─── Insurance probes ───────────────────────────────────────────────────
// Deep-walk each per-line policy detail probing every identity-bearing key
// the v2.1-errata1 insurance schemas emit: PolicyHolder first/last names,
// insured-party + beneficiary names, additional-driver full names, employer
// names, and the per-line finance/mortgage bank names. Product marketing
// strings (ProductName, PlanName, CareNetwork, …) are generator constants,
// not identity, and are not probed.
function probeIdentityKeys(pid, lfi, atPrefix, node) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => probeIdentityKeys(pid, lfi, `${atPrefix}[${i}]`, v));
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    const at = `${atPrefix}.${k}`;
    if (typeof v === 'string') {
      if (k === 'FirstName') check(pid, lfi, at, v, allowedGivenNames, 'any name-pool given_names');
      else if (k === 'LastName') check(pid, lfi, at, v, allowedSurnames, 'any name-pool surnames');
      else if (k === 'FullName')
        check(pid, lfi, at, v, allowedFullNames, 'any name-pool cross-product');
      else if (k === 'BankName' || k === 'FinanceProvider')
        check(pid, lfi, at, v, allowedBankNames, 'counterparty-banks pool');
      else if (k === 'EmployerName')
        check(pid, lfi, at, v, allowedEmployers, 'employers pool / persona manifest');
    } else {
      probeIdentityKeys(pid, lfi, at, v);
    }
  }
}

function probeInsurance(pid, lfi, bundle) {
  if (bundle.identity?.fullName) {
    check(
      pid,
      lfi,
      'identity.fullName',
      bundle.identity.fullName,
      allowedFullNames,
      'any name-pool cross-product',
    );
  }
  for (const line of INSURANCE_LINES) {
    for (const policy of bundle[`${line}Policies`] ?? []) {
      probeIdentityKeys(pid, lfi, `${line}Policies`, policy);
    }
    // Payment details: single-line bundles carry `paymentDetails`;
    // multi-domain bundles carry per-line `<line>PaymentDetails`.
    const pd = bundle[`${line}PaymentDetails`];
    if (pd) probePaymentDetails(pid, lfi, `${line}PaymentDetails`, pd);
  }
  if (bundle.paymentDetails) probePaymentDetails(pid, lfi, 'paymentDetails', bundle.paymentDetails);
}

function probePaymentDetails(pid, lfi, at, pd) {
  check(
    pid,
    lfi,
    `${at}.Account.Name`,
    pd.Account?.Name,
    allowedFullNames,
    'name-pool cross-product',
  );
  check(pid, lfi, `${at}.Bank.Name`, pd.Bank?.Name, allowedBankNames, 'counterparty-banks pool');
}

// ─── ATM probes ─────────────────────────────────────────────────────────
function probeAtm(pid, lfi, bundle) {
  for (const atm of bundle.atms ?? []) {
    const brand = atm.LFIBrandId;
    if (brand) {
      probesChecked += 1;
      if (!ATM_BRAND_RE.test(brand)) {
        fail(pid, lfi, 'atm.LFIBrandId', brand, 'anonymous Rich/Median/Sparse LFI identity');
      }
    }
    const siteName = atm.Location?.Site?.Name;
    if (siteName) {
      probesChecked += 1;
      // Site name shape: `${prefix} ${district} ${suffix}` — prefix and
      // suffix are single tokens; district may contain spaces.
      const tokens = siteName.split(' ');
      const prefix = tokens[0];
      const suffix = tokens[tokens.length - 1];
      const middle = tokens.slice(1, -1).join(' ');
      if (
        !ATM_SITE_PREFIXES.has(prefix) ||
        !ATM_SITE_SUFFIXES.has(suffix) ||
        !ATM_DISTRICTS.has(middle)
      ) {
        fail(pid, lfi, 'atm.Location.Site.Name', siteName, 'synthetic site vocabulary');
      }
    }
    const addr = atm.Location?.PostalAddress;
    if (addr?.DistrictName) {
      check(
        pid,
        lfi,
        'atm.Location.PostalAddress.DistrictName',
        addr.DistrictName,
        ATM_DISTRICTS,
        'synthetic district list',
      );
    }
    if (addr?.TownName) {
      check(
        pid,
        lfi,
        'atm.Location.PostalAddress.TownName',
        addr.TownName,
        ATM_TOWNS,
        'emirate town list',
      );
    }
    if (addr?.StreetName) {
      probesChecked += 1;
      const m = addr.StreetName.match(/^(.*) Street$/);
      if (!m || !ATM_DISTRICTS.has(m[1])) {
        fail(
          pid,
          lfi,
          'atm.Location.PostalAddress.StreetName',
          addr.StreetName,
          'synthetic "<district> Street" shape',
        );
      }
    }
  }
}

// ─── Run the matrix ─────────────────────────────────────────────────────
for (const [pid, persona] of Object.entries(personas)) {
  const domains = personaDomains(persona);
  for (const lfi of LFI_PROFILES) {
    const bundle = buildBundle({ persona, lfi, seed: 4729, pools });
    if (domains.includes('banking')) probeBanking(pid, lfi, bundle);
    if (domains.includes('insurance')) probeInsurance(pid, lfi, bundle);
    if (domains.includes('atm')) probeAtm(pid, lfi, bundle);
  }
}

if (bad > 0) {
  console.error(`lint-pii-leak: ${bad} violation(s)`);
  process.exit(1);
}
console.log(
  `lint-pii-leak OK — ${probesChecked} identity strings checked across ${Object.keys(personas).length} personas (banking + insurance + atm) × ${LFI_PROFILES.length} LFI profiles, all from pool`,
);

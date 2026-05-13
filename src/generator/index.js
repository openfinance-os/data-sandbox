// Generator orchestrator — entry point that turns (persona, lfi, seed) into a
// payload bundle. Phase 2.0: dispatches to the per-domain generator based on
// persona.domain. Banking covers 12 v2.1 Account-Information endpoints;
// insurance covers the motor-MVP triad (slice 6b-ii).
//
// EXP-05 / §8.3 invariant: the bundle is a pure function of
// (persona, lfi, seed, now). `now` defaults to a build-time anchor so that
// two visitors hitting the same URL on different days see byte-identical
// bundles.

import { makePrng } from '../prng.js';
import { drawName, drawOrganisationName } from './identity.js';
import { generateAccounts } from './accounts.js';
import { generateBalances } from './balances.js';
import { generateTransactions } from './transactions.js';
import { generateStandingOrders } from './standing-orders.js';
import { generateDirectDebits } from './direct-debits.js';
import { generateBeneficiaries } from './beneficiaries.js';
import {
  buildCrossLfiSelfBeneficiaries,
  computeCrossLfiLedger,
  derivePrimaryAccountIban,
} from './multi-lfi.js';
import { generateScheduledPayments } from './scheduled-payments.js';
import { generateParties } from './parties.js';
import { generateStatements } from './statements.js';
import { generateProducts } from './product.js';
import { applyLfiProfile } from './banking/lfi-profile.js';
import { buildInsuranceBundle } from './insurance/index.js';
import { buildEnrichment } from './enrichment.js';

const DEFAULT_NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

// Pool category → pool_id we expect to find in the indexed-pools structure.
// Defaults are used for any pools the persona doesn't reference directly.
const DEFAULT_BANKS_POOL = 'counterparty_banks_uae_real';
const DEFAULT_IBANS_POOL = 'ibans_synthetic';
const DEFAULT_GROCERIES = 'merchants_groceries';
const DEFAULT_FUEL = 'merchants_fuel';
const DEFAULT_DINING = 'merchants_dining';
const DEFAULT_UTILITIES = 'merchants_utilities';

// Extended-spend pools (Phase R1 of the enrichment-realism plan). Map of
// transactions.js pool key → pool_id in synthetic-identity-pool/merchants/.
// Resolved lazily — a pool missing from the indexed set is left undefined,
// and the dispatcher in transactions.js skips it.
const EXTENDED_POOL_IDS = {
  ride_hailing: 'merchants_ride_hailing',
  ecommerce: 'merchants_ecommerce',
  healthcare: 'merchants_healthcare',
  transport: 'merchants_transport',
  government: 'merchants_government',
  entertainment: 'merchants_entertainment',
  subscriptions: 'merchants_subscriptions',
  travel_air: 'merchants_travel_air',
  travel_hotel: 'merchants_travel_hotel',
  education: 'merchants_education',
  telecom: 'merchants_telecom',
  atm: 'merchants_atm',
};

function resolvePools(persona, indexedPools) {
  const namePool = indexedPools.namesByPoolId[persona.demographics.nationality_pool];
  if (!namePool) {
    throw new Error(
      `name pool '${persona.demographics.nationality_pool}' not found for persona ${persona.persona_id}`
    );
  }
  const employerPoolId = persona.income?.primary_employer_pool;
  const employerPool = employerPoolId ? indexedPools.employersByPoolId[employerPoolId] : null;
  if (employerPoolId && !employerPool) {
    throw new Error(`employer pool '${employerPoolId}' not found for persona ${persona.persona_id}`);
  }
  const orgPoolId = persona.organisation?.legal_name_pool;
  const orgPool = orgPoolId
    ? (indexedPools.organisationsByPoolId ?? {})[orgPoolId]
    : null;
  if (orgPoolId && !orgPool) {
    throw new Error(
      `organisation pool '${orgPoolId}' not found for persona ${persona.persona_id}`
    );
  }
  // Resolve signatory name pools eagerly so parties.js can draw without
  // having to plumb the indexed-pools structure through.
  const signatoryPools = [];
  for (const sig of persona.organisation?.signatories ?? []) {
    const poolId = sig.signatory_pool;
    if (!poolId) continue;
    const pool = indexedPools.namesByPoolId[poolId];
    if (!pool) {
      throw new Error(
        `signatory name pool '${poolId}' not found for persona ${persona.persona_id}`
      );
    }
    signatoryPools.push(pool);
  }
  return {
    names: namePool,
    employers: employerPool,
    organisation: orgPool,
    signatoryPools,
    groceries: indexedPools.merchantsByCategory[DEFAULT_GROCERIES],
    fuel: indexedPools.merchantsByCategory[DEFAULT_FUEL],
    dining: indexedPools.merchantsByCategory[DEFAULT_DINING],
    utilities: indexedPools.merchantsByCategory[DEFAULT_UTILITIES],
    ...extendedPools(indexedPools),
    counterpartyBanks: indexedPools.counterpartyBanksByCategory[DEFAULT_BANKS_POOL],
    ibans: indexedPools.ibansByCategory[DEFAULT_IBANS_POOL],
  };
}

function extendedPools(indexedPools) {
  const out = {};
  for (const [key, poolId] of Object.entries(EXTENDED_POOL_IDS)) {
    out[key] = indexedPools.merchantsByCategory[poolId];
  }
  return out;
}

export function buildBundle(args) {
  const domain = args.persona?.domain ?? 'banking';
  if (domain === 'banking') return buildBankingBundle(args);
  if (domain === 'insurance') return buildInsuranceBundle(args);
  throw new Error(`unknown persona domain: ${domain}`);
}

function buildBankingBundle({ persona, lfi, seed, pools, now = DEFAULT_NOW }) {
  // The generator's main RNG is independent of `lfi` — mandatory content must
  // be identical across Rich/Median/Sparse for the same (persona, seed). The
  // LFI profile's redaction PRNG is seeded separately in lfi-profile.js.
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const p = resolvePools(persona, pools);
  const name = drawName(rng, p.names);
  const identity = {
    fullName: name.full,
    given: name.given,
    surname: name.surname,
    namePoolId: persona.demographics.nationality_pool,
  };

  // Resolve organisation legal name + signatory names deterministically up
  // front so accounts.js and parties.js can read from persona._resolved
  // without re-drawing.
  const enrichedPersona = enrichPersona(persona, p, rng);

  const accounts = generateAccounts({
    persona: enrichedPersona,
    identity,
    rng,
    pools: { counterpartyBanks: p.counterpartyBanks, ibans: p.ibans },
    now,
  });

  const transactions = [];
  const runningBalance = { balance: 0 };
  const txState = { counter: 0 };
  for (const acc of accounts) {
    const accTx = generateTransactions({
      persona,
      account: acc,
      rng,
      pools: {
        groceries: p.groceries,
        fuel: p.fuel,
        dining: p.dining,
        utilities: p.utilities,
        employers: p.employers,
        // Phase R1 — extended-spend pools. Missing keys are tolerated by
        // the dispatcher (it skips the category), so a partial deployment
        // still builds.
        ride_hailing: p.ride_hailing,
        ecommerce: p.ecommerce,
        healthcare: p.healthcare,
        transport: p.transport,
        government: p.government,
        entertainment: p.entertainment,
        subscriptions: p.subscriptions,
        travel_air: p.travel_air,
        travel_hotel: p.travel_hotel,
        education: p.education,
        telecom: p.telecom,
        atm: p.atm,
        // Slice 10: B2B inflows / outflows resolve cash_flow.*.counterparty_pool
        // against the indexed pools structure. Empty `{}` for personas
        // whose load fixtures don't include a counterparties index.
        counterparties: pools.counterpartiesByPoolId ?? {},
      },
      runningBalance,
      now,
      txState,
    });
    transactions.push(...accTx);
  }

  // Slice 7 (D-14): cross-LFI mirror ledger. For personas with
  // `multi_lfi_footprint`, append monthly self-sweep transactions
  // per declared non-primary slot. The same pure-function ledger is
  // computed for primary AND role bundles — primary gets the outflow
  // half (CreditDebitIndicator='Debit'), role bundles get the inflow
  // half ('Credit'). Each pair shares TransactionDateTime + Amount +
  // Reference + counterparty IBAN, so a TPP-side accounting integration
  // (Naqood-grade) can reconcile by IBAN identity.
  const sourcePersona = persona._sourcePersona ?? persona;
  if (sourcePersona.multi_lfi_footprint) {
    const isProjection = persona._projectedRoleSlot != null;
    const slotKey = isProjection ? persona._projectedRoleSlot : 'primary';
    // Primary's anchor account = first CurrentAccount in the source
    // persona's account list. Its IBAN was overridden in accounts.js
    // to a deterministic synthetic AE99/999 value (see
    // derivePrimaryAccountIban).
    const firstCurrentIdx = (sourcePersona.accounts ?? []).findIndex((s) => s.type === 'CurrentAccount');
    const primaryAccountId = firstCurrentIdx >= 0
      ? `${sourcePersona.persona_id.replace(/_/g, '-')}-acct-${String(firstCurrentIdx + 1).padStart(2, '0')}`
      : null;
    const primaryIban = firstCurrentIdx >= 0
      ? derivePrimaryAccountIban(sourcePersona.persona_id, firstCurrentIdx)
      : null;
    if (primaryAccountId && primaryIban) {
      const ledger = computeCrossLfiLedger({
        persona: sourcePersona,
        primaryAccountId,
        primaryIban,
        counterpartyBanksPool: p.counterpartyBanks,
        now,
      });
      transactions.push(...(ledger[slotKey] ?? []));
    }
  }

  const balances = generateBalances({ accounts, transactions, now });

  const standingOrders = generateStandingOrders({
    persona,
    accounts,
    rng,
    pools: { counterpartyBanks: p.counterpartyBanks, ibans: p.ibans },
    now,
  });
  const directDebits = generateDirectDebits({ persona, accounts, rng, now });
  // Phase D-lite (D-14): build cross-LFI self-beneficiaries FIRST so we
  // know which banks they reserve, then exclude those banks from the
  // regular-beneficiary draw — the rendered bundle's multi-bank surface
  // stays visually distinct (no coincidental overlap between a regular
  // beneficiary and a self-to-<role> link).
  const crossLfiSelfBeneficiaries = buildCrossLfiSelfBeneficiaries({
    persona, accounts, identity,
    pools: { counterpartyBanks: p.counterpartyBanks },
  });
  const reservedBankNames = crossLfiSelfBeneficiaries
    .map((b) => b.CreditorAgent?.Name)
    .filter(Boolean);
  const beneficiaries = generateBeneficiaries({
    persona,
    accounts,
    rng,
    pools: { counterpartyBanks: p.counterpartyBanks, ibans: p.ibans, names: p.names },
    excludeBankNames: reservedBankNames,
  });
  beneficiaries.push(...crossLfiSelfBeneficiaries);
  const scheduledPayments = generateScheduledPayments({
    persona,
    accounts,
    rng,
    pools: { counterpartyBanks: p.counterpartyBanks, ibans: p.ibans, names: p.names },
    now,
  });
  const productRecords = generateProducts({ accounts });
  const partyResult = generateParties({ persona: enrichedPersona, accounts, identity, rng, now });
  const statements = generateStatements({ accounts, transactions, rng, now });

  // Phase R1.5 — transaction enrichment sidecar. Computed BEFORE
  // applyLfiProfile() so the sidecar is LFI-independent and stays
  // complete even when Sparse redacts MerchantDetails out of the wire
  // payload. The bundle carries it as the underscore-prefixed key
  // `_enrichment` — strips on export per the standard convention in
  // src/ui/export.js, and the fixture-package builder + stage-site
  // pipe it through to a separate per-(persona, seed) sidecar URL.
  const enrichment = buildEnrichment(transactions);

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    identity,
    accounts,
    balances,
    transactions,
    standingOrders,
    directDebits,
    beneficiaries,
    scheduledPayments,
    parties: partyResult.perAccount,
    callingUserParty: partyResult.callingUser,
    statements,
    product: productRecords,
    _enrichment: enrichment,
  };

  return applyLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

// Resolve organisation legal name + signatory display names deterministically
// from the persona's pool refs, so downstream generators can read a stable
// `_resolved` block instead of re-drawing.
function enrichPersona(persona, p, rng) {
  if (!persona.organisation) return persona;
  const legalName = p.organisation
    ? drawOrganisationName(rng, p.organisation)
    : null;
  const signatories = (persona.organisation.signatories ?? []).map((sig, i) => {
    const namePool = p.signatoryPools[i];
    const name = namePool ? drawName(rng, namePool) : null;
    return {
      ...sig,
      _resolved: name
        ? { fullName: name.full, given: name.given, surname: name.surname }
        : null,
    };
  });
  return {
    ...persona,
    organisation: {
      ...persona.organisation,
      _resolved: { legalName },
      signatories,
    },
  };
}

export { DEFAULT_NOW };

// Banking pipeline — the v2.1 Account-Information generator, extracted from
// the orchestrator (src/generator/index.js) so the browser's lazy entry
// (src/generator/lazy.js) can load banking without statically dragging the
// insurance + ATM trees onto the cold path (C-P1 / EXP-24). Logic is moved
// verbatim from the pre-split orchestrator — determinism (EXP-05) depends on
// the draw order in buildBankingBundle staying byte-identical.

import { makePrng } from '../../prng.js';
import { drawName, drawOrganisationName } from '../identity.js';
import { generateAccounts, derivePrimaryAnchor } from '../accounts.js';
import { generateBalances } from '../balances.js';
import { generateTransactions } from '../transactions.js';
import { generateStandingOrders } from '../standing-orders.js';
import { generateDirectDebits } from '../direct-debits.js';
import { generateBeneficiaries } from '../beneficiaries.js';
import { buildCrossLfiSelfBeneficiaries, computeCrossLfiLedger } from '../multi-lfi.js';
import { generateScheduledPayments } from '../scheduled-payments.js';
import { generateParties } from '../parties.js';
import { generateStatements } from '../statements.js';
import { generateProducts } from '../product.js';
import { applyLfiProfile } from './lfi-profile.js';
import { buildEnrichment } from '../enrichment.js';
import { DEFAULT_NOW } from '../dispatch.js';

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
      `name pool '${persona.demographics.nationality_pool}' not found for persona ${persona.persona_id}`,
    );
  }
  const employerPoolId = persona.income?.primary_employer_pool;
  const employerPool = employerPoolId ? indexedPools.employersByPoolId[employerPoolId] : null;
  if (employerPoolId && !employerPool) {
    throw new Error(
      `employer pool '${employerPoolId}' not found for persona ${persona.persona_id}`,
    );
  }
  const orgPoolId = persona.organisation?.legal_name_pool;
  const orgPool = orgPoolId ? (indexedPools.organisationsByPoolId ?? {})[orgPoolId] : null;
  if (orgPoolId && !orgPool) {
    throw new Error(`organisation pool '${orgPoolId}' not found for persona ${persona.persona_id}`);
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
        `signatory name pool '${poolId}' not found for persona ${persona.persona_id}`,
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
    // Phase R2 — flat family-groups registry, resolved by id from the
    // synthetic UAE-conglomerate pool. The narrative-grammar helpers in
    // realism.js look up a merchant's `parent_group` here to get the
    // group's acronym for the narrative prefix.
    familyGroups: indexedPools.familyGroupsById ?? {},
    // Phase R3 — MCC confusion table. Indexed { correctMcc → [{wrong,
    // reason}] }. The noise applier in mcc-noise.js consults this on
    // every POS / ECommerce tx; absent → no noise (passes through).
    mccConfusion: indexedPools.mccConfusion ?? null,
  };
}

function extendedPools(indexedPools) {
  const out = {};
  for (const [key, poolId] of Object.entries(EXTENDED_POOL_IDS)) {
    out[key] = indexedPools.merchantsByCategory[poolId];
  }
  return out;
}

export function buildBankingBundle({ persona, lfi, seed, pools, now = DEFAULT_NOW }) {
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
        // Phase R2 — narrative dirtying needs the family-group registry
        // so parentGroupPrefix can resolve a merchant's owner.
        familyGroups: p.familyGroups,
        // Phase R3 — MCC misrouting noise table.
        mccConfusion: p.mccConfusion,
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
  // can reconcile by IBAN identity.
  const sourcePersona = persona._sourcePersona ?? persona;
  if (sourcePersona.multi_lfi_footprint) {
    const isProjection = persona._projectedRoleSlot != null;
    const slotKey = isProjection ? persona._projectedRoleSlot : 'primary';
    // Primary's anchor account, via the same slot-filtered indexing the
    // account generator uses. Do NOT recompute from the raw declared
    // account list: accounts.js filters `at_slot`-tagged accounts to the
    // primary slot before indexing, so a raw-list index diverges the
    // moment a multi-product persona doesn't lead with a primary-slot
    // CurrentAccount — yielding ledger rows whose _accountId matches no
    // emitted account (silently dropped by envelopesFromBundle).
    const anchor = derivePrimaryAnchor(sourcePersona);
    const primaryAccountId = anchor?.accountId ?? null;
    const primaryIban = anchor?.iban ?? null;
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
    persona,
    accounts,
    identity,
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
  const legalName = p.organisation ? drawOrganisationName(rng, p.organisation) : null;
  const signatories = (persona.organisation.signatories ?? []).map((sig, i) => {
    const namePool = p.signatoryPools[i];
    const name = namePool ? drawName(rng, namePool) : null;
    return {
      ...sig,
      _resolved: name ? { fullName: name.full, given: name.given, surname: name.surname } : null,
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

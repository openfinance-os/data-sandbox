// Generator orchestrator — entry point that turns (persona, lfi, seed) into a
// payload bundle covering the v1 endpoints (Phase 1 — all 12 endpoints).
//
// EXP-05 / §8.3 invariant: the bundle is a pure function of
// (persona, lfi, seed, now). `now` defaults to a build-time anchor so that
// two visitors hitting the same URL on different days see byte-identical
// bundles.

import { makePrng } from '../prng.js';
import { drawName } from './identity.js';
import { generateAccounts } from './accounts.js';
import { generateBalances } from './balances.js';
import { generateTransactions } from './transactions.js';
import { generateStandingOrders } from './standing-orders.js';
import { generateDirectDebits } from './direct-debits.js';
import { generateBeneficiaries } from './beneficiaries.js';
import { generateScheduledPayments } from './scheduled-payments.js';
import { generateParties } from './parties.js';
import { generateStatements } from './statements.js';
import { generateProducts } from './product.js';
import { applyLfiProfile } from './lfi-profile.js';

const DEFAULT_NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

// Pool category → pool_id we expect to find in the indexed-pools structure.
// Defaults are used for any pools the persona doesn't reference directly.
const DEFAULT_BANKS_POOL = 'counterparty_banks_domestic';
const DEFAULT_IBANS_POOL = 'ibans_synthetic';
const DEFAULT_GROCERIES = 'merchants_groceries';
const DEFAULT_FUEL = 'merchants_fuel';
const DEFAULT_DINING = 'merchants_dining';
const DEFAULT_UTILITIES = 'merchants_utilities';

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
  return {
    names: namePool,
    employers: employerPool,
    groceries: indexedPools.merchantsByCategory[DEFAULT_GROCERIES],
    fuel: indexedPools.merchantsByCategory[DEFAULT_FUEL],
    dining: indexedPools.merchantsByCategory[DEFAULT_DINING],
    utilities: indexedPools.merchantsByCategory[DEFAULT_UTILITIES],
    counterpartyBanks: indexedPools.counterpartyBanksByCategory[DEFAULT_BANKS_POOL],
    ibans: indexedPools.ibansByCategory[DEFAULT_IBANS_POOL],
  };
}

export function buildBundle({ persona, lfi, seed, pools, now = DEFAULT_NOW }) {
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

  const accounts = generateAccounts({
    persona,
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
      },
      runningBalance,
      now,
      txState,
    });
    transactions.push(...accTx);
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
  const beneficiaries = generateBeneficiaries({
    persona,
    accounts,
    rng,
    pools: { counterpartyBanks: p.counterpartyBanks, ibans: p.ibans, names: p.names },
  });
  const scheduledPayments = generateScheduledPayments({
    persona,
    accounts,
    rng,
    pools: { counterpartyBanks: p.counterpartyBanks, ibans: p.ibans, names: p.names },
    now,
  });
  const productRecords = generateProducts({ accounts });
  const partyResult = generateParties({ persona, accounts, identity, rng, now });
  const statements = generateStatements({ accounts, transactions, rng, now });

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
  };

  return applyLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

export { DEFAULT_NOW };

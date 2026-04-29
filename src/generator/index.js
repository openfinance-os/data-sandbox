// Generator orchestrator — entry point that turns (persona, lfi, seed) into a
// payload bundle covering the v1 endpoints. Phase 0 covers /accounts,
// /accounts/{AccountId}/balances, /accounts/{AccountId}/transactions for one
// persona under one LFI profile. The remaining endpoints are stubbed for now.
//
// EXP-05 / §8.3 invariant: the bundle is a pure function of
// (persona, lfi, seed, now). `now` defaults to a build-time anchor so that
// two visitors hitting the same URL on different days see byte-identical
// bundles. Tests pass an explicit anchor; the browser reads it from
// dist/BUILD_INFO.json.

import { makePrng } from '../prng.js';
import { drawName } from './identity.js';
import { generateAccounts } from './accounts.js';
import { generateBalances } from './balances.js';
import { generateTransactions } from './transactions.js';
import { applyLfiProfile } from './lfi-profile.js';

// A reasonable default — used by tests that don't pin `now`. Pegged to the
// first day of 2026-04 so the 12-month window is stable in unit tests.
const DEFAULT_NOW = new Date(Date.UTC(2026, 3, 1, 0, 0, 0));

export function buildBundle({ persona, lfi, seed, pools, now = DEFAULT_NOW }) {
  // The generator's main RNG is independent of `lfi` — mandatory content must
  // be identical across Rich/Median/Sparse for the same (persona, seed). The
  // LFI profile's redaction PRNG is seeded separately in lfi-profile.js.
  const rng = makePrng(persona.persona_id, 'generator', seed);
  const namePool = pools.namesByPoolId[persona.demographics.nationality_pool];
  const name = drawName(rng, namePool);

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
    pools: {
      counterpartyBanks: pools.counterpartyBanksDomestic,
      ibans: pools.ibansSynthetic,
    },
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
        groceries: pools.merchantsGroceries,
        fuel: pools.merchantsFuel,
        dining: pools.merchantsDining,
        utilities: pools.merchantsUtilities,
        employers: pools.employersTechFreezone,
      },
      runningBalance,
      now,
      txState,
    });
    transactions.push(...accTx);
  }

  const balances = generateBalances({ accounts, transactions, now });

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    identity,
    accounts,
    balances,
    transactions,
    standingOrders: [],
    directDebits: [],
    beneficiaries: [],
    scheduledPayments: [],
    parties: [],
    statements: [],
    product: [],
  };

  return applyLfiProfile({
    bundle,
    personaId: persona.persona_id,
    lfi,
    seed,
  });
}

export { DEFAULT_NOW };

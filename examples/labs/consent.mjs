import process from 'node:process';
const base = process.argv[2] ?? 'http://127.0.0.1:8788';
const accounts = await fetch(`${base}/scenarios/salaried_expat_mid/accounts`).then((r) => r.json());
const route = `${base}/scenarios/salaried_expat_mid/accounts/${accounts.Data.Account[0].AccountId}/transactions?limit=5`;
const success = await fetch(route);
if (success.status !== 200) throw new Error('Expected authorised synthetic response');
const page = await success.json();
const revoked = await fetch(`${route}&case=revoked`);
if (revoked.status !== 403) throw new Error('Expected simulated revocation');
const denial = await revoked.json();
console.log(
  JSON.stringify(
    {
      observedBeforeRevocation: page.Data.Transaction.length,
      revoked: revoked.status,
      authority: denial._harness.authority,
      decision: 'insufficient-authority',
      currentFinancialAnswer: null,
      instruction: 'Do not present cached observations as a currently authorised result.',
    },
    null,
    2,
  ),
);

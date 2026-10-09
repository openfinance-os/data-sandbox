import fs from 'node:fs';
import path from 'node:path';
import {
  incomeAndCommitments,
  reconcileSweeps,
  insuranceCommitments,
} from '../src/core/analysis.js';
const root = 'packages/sandbox-fixtures';
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
const labs = [
  {
    id: 'income',
    title: 'Income and fixed commitments',
    persona: 'salaried_expat_mid',
    task: 'Calculate observed April 2026 payroll and fixed-payment debits by currency. Compare Rich and Sparse; explain unknowns.',
    method: 'incomeAndCommitments',
    commands: 'node examples/labs/run.mjs income',
  },
  {
    id: 'reconciliation',
    title: 'Multi-bank SME reconciliation',
    persona: 'sme_rak_trading_emirati',
    task: 'Match self-sweeps across primary and role accounts. Preserve both booked currencies and any conversion.',
    method: 'reconcileSweeps',
    commands: 'node examples/labs/run.mjs reconciliation',
  },
  {
    id: 'consent',
    title: 'Consent-aware personal finance',
    persona: 'salaried_expat_mid',
    task: 'Read a successful transaction page, then simulate revoked consent. Stop using the stale result and explain the API Hub authority.',
    method: 'mock',
    commands: 'npm run mock\n# In another terminal:\nnode examples/labs/consent.mjs',
  },
  {
    id: 'cover',
    title: 'Banking and insurance commitments',
    persona: 'retail_multi_banker',
    task: 'Describe observed payments, declared policy premiums, end dates and cover. Explicitly list information that is unknown.',
    method: 'insuranceCommitments',
    commands: 'node examples/labs/run.mjs cover',
  },
];
const read = (fx) =>
  Object.fromEntries(
    Object.entries(fx.endpoints)
      .filter(([e]) => !e.includes('{'))
      .map(([e, rel]) => [e, JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'))]),
  );
const answers = {};
for (const lab of labs) {
  if (lab.id === 'consent') {
    answers[lab.id] = {
      successful: 200,
      revoked: 403,
      authority: 'API Hub',
      action: 'Abstain after revocation; do not reuse a cached result as current authority.',
    };
    continue;
  }
  const seed = manifest.personas[lab.persona].default_seed;
  answers[lab.id] = {};
  for (const lfi of ['rich', 'median', 'sparse']) {
    const primary = read(manifest.fixtures[`${lab.persona}|${lfi}|${seed}`]);
    const roles = Object.fromEntries(
      Object.entries(manifest.roleFixtures)
        .filter(([, fx]) => fx.personaId === lab.persona && fx.lfi === lfi)
        .map(([k, fx]) => [k, read(fx)]),
    );
    answers[lab.id][lfi] =
      lab.id === 'income'
        ? incomeAndCommitments(primary)
        : lab.id === 'reconciliation'
          ? reconcileSweeps(primary, roles)
          : { banking: incomeAndCommitments(primary), insurance: insuranceCommitments(primary) };
  }
}
fs.writeFileSync(
  'dist/labs.json',
  JSON.stringify(
    { corpusVersion: manifest.corpusVersion, referenceDate: manifest.nowAnchor, labs },
    null,
    2,
  ),
);
fs.writeFileSync('dist/lab-answers.json', JSON.stringify(answers, null, 2));
console.log(`Built ${labs.length} guided labs and source-backed answer keys`);

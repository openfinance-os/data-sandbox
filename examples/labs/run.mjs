// Run after npm run build:site. Inputs are wire payloads only.
import fs from 'node:fs';
import process from 'node:process';
import { loadJourney, listRoleBundles } from '@openfinance-os/sandbox-fixtures';
import {
  incomeAndCommitments,
  reconcileSweeps,
  insuranceCommitments,
} from '../../src/core/analysis.js';
const { labs } = JSON.parse(fs.readFileSync('dist/labs.json', 'utf8'));
const lab = labs.find((l) => l.id === process.argv[2]);
if (!lab) throw new Error('Use income | reconciliation | cover');
const lfi = process.argv[3] ?? 'rich';
const journey = loadJourney({ persona: lab.persona, lfi });
const roles = Object.fromEntries(
  listRoleBundles(lab.persona).map((role) => [
    role,
    loadJourney({ persona: lab.persona, lfi, lfi_role: role }).endpoints,
  ]),
);
console.log(
  JSON.stringify(
    lab.id === 'income'
      ? incomeAndCommitments(journey.endpoints)
      : lab.id === 'reconciliation'
        ? reconcileSweeps(journey.endpoints, roles)
        : {
            banking: incomeAndCommitments(journey.endpoints),
            insurance: insuranceCommitments(journey.endpoints),
          },
    null,
    2,
  ),
);

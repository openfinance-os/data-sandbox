import fs from 'node:fs';
import { loadJourney } from '@openfinance-os/sandbox-fixtures';
import { normalizedTables } from '../src/core/analysis.js';
const persona = process.argv[2] ?? 'salaried_expat_mid';
const out = `artifacts/tables/${persona}`;
fs.mkdirSync(out, { recursive: true });
const journey = loadJourney({ persona, lfi: process.argv[3] ?? 'rich' });
const tables = normalizedTables(journey.endpoints);
fs.writeFileSync(
  `${out}/scenario.json`,
  JSON.stringify(Object.values(journey.endpoints)[0]._scenario, null, 2),
);
const cell = (v) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
for (const [name, rows] of Object.entries(tables)) {
  const keys = Object.keys(rows[0] ?? {});
  fs.writeFileSync(
    `${out}/${name}.csv`,
    '# SYNTHETIC DATA — no real financial records\n' +
      keys.join(',') +
      '\n' +
      rows.map((r) => keys.map((k) => cell(r[k])).join(',')).join('\n') +
      '\n',
  );
}
fs.writeFileSync(
  `${out}/README.txt`,
  'Join on account_id; transaction_id and statement_id are stable within the complete scenario identity. Amounts are unsigned decimal strings in the named currency; direction carries sign. Dates are UTC. Empty optional cells mean unknown, never zero. Source JSON is authoritative.\n',
);
console.log(`Exported normalized tables to ${out}`);

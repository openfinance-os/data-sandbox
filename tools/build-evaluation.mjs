// An opt-in evaluation pack. Observed inputs and synthetic labels are in
// separate directories. Holdouts exclude both persona families and merchant
// entities seen in training; changing a seed is not an independent holdout.
import fs from 'node:fs';
import path from 'node:path';
import { stripAnnotations } from './schema-validator.mjs';
const root = 'packages/sandbox-fixtures',
  out = 'artifacts/evaluation';
const manifest = JSON.parse(fs.readFileSync(`${root}/manifest.json`, 'utf8'));
fs.rmSync(out, { force: true, recursive: true });
for (const folder of ['observed', 'labels']) fs.mkdirSync(`${out}/${folder}`, { recursive: true });
const family = (id) =>
  id.startsWith('hnw_')
    ? 'hnw'
    : /^sme_(rak_trading|trading_business)/.test(id)
      ? 'sme_trading'
      : id;
const holdoutFamilies = new Set(['hnw', 'sme_trading', 'domestic_worker']);
const holdoutPersonas = new Set(
  Object.keys(manifest.personas).filter((id) => holdoutFamilies.has(family(id))),
);
const candidates = [];
for (const fx of Object.values(manifest.fixtures)) {
  const info = manifest.personas[fx.personaId];
  if (!info.enrichmentFiles) continue;
  const gold = JSON.parse(
    fs.readFileSync(path.join(root, info.enrichmentFiles[String(fx.seed)]), 'utf8'),
  );
  const labels = gold.records;
  for (const [endpoint, rel] of Object.entries(fx.endpoints)) {
    if (!endpoint.endsWith('/transactions') || endpoint.includes('{')) continue;
    const env = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
    for (const row of env.Data.Transaction)
      candidates.push({
        persona: fx.personaId,
        seed: fx.seed,
        profile: fx.lfi,
        row: stripAnnotations(row),
        label: labels[row.TransactionId] ?? null,
      });
  }
}
if (candidates.some((c) => c.label == null)) throw new Error('Unlabelled corpus record');
const entities = [...new Set(candidates.map((c) => c.label?.logoSlug).filter(Boolean))].sort();
const holdoutEntities = new Set(entities.filter((_, n) => n % 5 === 0));
const splits = { train: [], holdout: [] };
for (const c of candidates) {
  const entity = c.label?.logoSlug;
  const heldPersona = holdoutPersonas.has(c.persona),
    heldEntity = entity && holdoutEntities.has(entity);
  if (heldPersona && (!entity || heldEntity)) splits.holdout.push(c);
  if (!heldPersona && (!entity || !heldEntity)) splits.train.push(c);
}
for (const [split, rows] of Object.entries(splits)) {
  if (!rows.length) throw new Error(`Empty evaluation split: ${split}`);
  fs.writeFileSync(
    `${out}/observed/${split}.jsonl`,
    rows
      .map((c) =>
        JSON.stringify({
          id: `${c.persona}|${c.profile}|${c.seed}|${c.row.TransactionId}`,
          persona: c.persona,
          profile: c.profile,
          seed: c.seed,
          transaction: c.row,
        }),
      )
      .join('\n') + '\n',
  );
  fs.writeFileSync(
    `${out}/labels/${split}.jsonl`,
    rows
      .map((c) =>
        JSON.stringify({
          id: `${c.persona}|${c.profile}|${c.seed}|${c.row.TransactionId}`,
          expected: c.label,
          booked: c.row.Status === 'Booked',
          tasks: {
            categorization:
              c.row.MerchantDetails?.MerchantCategoryCode || c.row.TransactionInformation
                ? 'evaluate'
                : 'abstain',
            income: c.row.Flags ? 'evaluate' : 'abstain',
            refund: c.label.refundOf ? 'positive' : 'negative',
            transfer: /transfer/i.test(c.label.category) ? 'positive' : 'negative',
          },
        }),
      )
      .join('\n') + '\n',
  );
}
fs.writeFileSync(
  `${out}/manifest.json`,
  JSON.stringify(
    {
      corpusVersion: manifest.corpusVersion,
      syntheticOnly: true,
      referenceDate: manifest.nowAnchor,
      observedIncludesLabels: false,
      splitUnit: 'persona family and merchant entity',
      holdoutPersonas: [...holdoutPersonas],
      holdoutEntities: [...holdoutEntities],
      counts: Object.fromEntries(Object.entries(splits).map(([k, v]) => [k, v.length])),
      limitations: [
        'Synthetic scores do not estimate real-world accuracy.',
        'IDs and generator-specific narrative conventions may allow shortcuts.',
        'Seed variants are correlated, and must remain in the same split.',
      ],
    },
    null,
    2,
  ),
);
console.log(
  'Built opt-in evaluation pack:',
  Object.fromEntries(Object.entries(splits).map(([k, v]) => [k, v.length])),
);

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { it, expect } from 'vitest';
it('holds out families and merchant entities without hidden labels in observed inputs', () => {
  execFileSync(process.execPath, ['tools/build-evaluation.mjs']);
  const lines = (file) =>
    fs.readFileSync(`artifacts/evaluation/${file}`, 'utf8').trim().split('\n').map(JSON.parse);
  const sets = {};
  const tasks = new Set();
  const forbidden = /_enrichment|_merchant|_mcc|refundOf|mccMisrouted|logoSlug/;
  for (const split of ['train', 'holdout']) {
    const observed = lines(`observed/${split}.jsonl`),
      labels = lines(`labels/${split}.jsonl`);
    expect(observed.length).toBe(labels.length);
    expect(observed.map((r) => r.id)).toEqual(labels.map((r) => r.id));
    expect(new Set(observed.map((r) => r.id)).size).toBe(observed.length);
    expect(forbidden.test(JSON.stringify(observed))).toBe(false);
    sets[split] = {
      personas: new Set(observed.map((r) => r.persona)),
      entities: new Set(labels.map((r) => r.expected.logoSlug).filter(Boolean)),
    };
    for (const row of labels)
      for (const [task, result] of Object.entries(row.tasks)) tasks.add(`${task}:${result}`);
  }
  expect([...sets.train.personas].some((p) => sets.holdout.personas.has(p))).toBe(false);
  expect([...sets.train.entities].some((p) => sets.holdout.entities.has(p))).toBe(false);
  for (const outcome of [
    'categorization:evaluate',
    'income:abstain',
    'refund:positive',
    'transfer:positive',
  ])
    expect(tasks.has(outcome), outcome).toBe(true);
});

// Immutable downloadable snapshots, with optional domain/evaluation packs.
// Release version reuse with different canonical bytes is a hard failure.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const source = 'packages/sandbox-fixtures';
const manifest = JSON.parse(fs.readFileSync(`${source}/manifest.json`, 'utf8'));
const release = `artifacts/releases/${manifest.corpusVersion}`;
const digest = crypto.createHash('sha256');
const rels = [
  ...new Set(
    [...Object.values(manifest.fixtures), ...Object.values(manifest.roleFixtures)].flatMap((f) =>
      Object.values(f.endpoints),
    ),
  ),
].sort();
for (const rel of rels)
  digest
    .update(rel)
    .update('\0')
    .update(fs.readFileSync(path.join(source, rel)));
const corpusHash = digest.digest('hex');
const previous =
  fs.existsSync(`${release}/release.json`) &&
  JSON.parse(fs.readFileSync(`${release}/release.json`, 'utf8'));
if (previous && previous.corpusHash !== corpusHash)
  throw new Error('Immutable corpus version already exists with different bytes; bump version');
if (previous) {
  console.log(`Immutable release ${release} already exists`);
  process.exit(0);
}
fs.mkdirSync(release, { recursive: true });
const archives = {};
for (const domain of ['banking', 'insurance', 'atm']) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `sandbox-${domain}-`));
  const subset = structuredClone(manifest);
  const belongs = (e) =>
    domain === 'atm'
      ? e === '/atms'
      : domain === 'insurance'
        ? e.includes('-insurance-') || e.startsWith('/insurance-consents')
        : e.startsWith('/accounts') || e === '/parties';
  for (const field of ['fixtures', 'roleFixtures']) {
    subset[field] = Object.fromEntries(
      Object.entries(subset[field])
        .map(([key, fx]) => [
          key,
          {
            ...fx,
            endpoints: Object.fromEntries(Object.entries(fx.endpoints).filter(([e]) => belongs(e))),
          },
        ])
        .filter(([, fx]) => Object.keys(fx.endpoints).length),
    );
    for (const fx of Object.values(subset[field]))
      for (const rel of new Set(Object.values(fx.endpoints))) {
        fs.mkdirSync(path.dirname(path.join(temp, rel)), { recursive: true });
        fs.copyFileSync(path.join(source, rel), path.join(temp, rel));
      }
  }
  const included = new Set(
    [...Object.values(subset.fixtures), ...Object.values(subset.roleFixtures)].map(
      (fx) => fx.personaId,
    ),
  );
  subset.personas = Object.fromEntries(
    Object.entries(subset.personas)
      .filter(([id]) => included.has(id))
      .map(([id, p]) => [id, { ...p, domain, domains: [domain] }]),
  );
  subset.domains = [domain];
  subset.pack = domain;
  fs.writeFileSync(`${temp}/manifest.json`, JSON.stringify(subset, null, 2));
  const file = `corpus-${manifest.corpusVersion}-${domain}.tar.gz`;
  execFileSync('tar', ['-czf', path.resolve(release, file), '-C', temp, '.']);
  archives[domain] = { file, bytes: fs.statSync(`${release}/${file}`).size };
  fs.rmSync(temp, { recursive: true });
}
const full = `corpus-${manifest.corpusVersion}-full.tar.gz`;
execFileSync('tar', ['-czf', path.resolve(release, full), '-C', source, '.']);
archives.full = { file: full, bytes: fs.statSync(`${release}/${full}`).size };
if (fs.existsSync('artifacts/evaluation/manifest.json')) {
  const file = `evaluation-${manifest.corpusVersion}.tar.gz`;
  execFileSync('tar', ['-czf', path.resolve(release, file), '-C', 'artifacts/evaluation', '.']);
  archives.evaluation = { file, bytes: fs.statSync(`${release}/${file}`).size };
}
for (const item of Object.values(archives))
  item.sha256 = crypto
    .createHash('sha256')
    .update(fs.readFileSync(`${release}/${item.file}`))
    .digest('hex');
fs.writeFileSync(
  `${release}/release.json`,
  JSON.stringify(
    {
      corpusVersion: manifest.corpusVersion,
      corpusHash,
      referenceDate: manifest.nowAnchor,
      specProvenance: manifest.specProvenance,
      revision: manifest.revision,
      immutable: true,
      archives,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ release, corpusHash, archives }, null, 2));

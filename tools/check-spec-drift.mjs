#!/usr/bin/env node
// Compare official revisions AND effective stable per-file content. Never
// re-vendor automatically; partial verification can never report current.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DOMAINS } from './domains.config.mjs';
const baseline = JSON.parse(fs.readFileSync('spec/provenance.json', 'utf8'));
const dryRun = process.argv.includes('--dry-run');
const report = [],
  errors = [];
const key = (v) =>
  v
    ?.match(/^v(\d+)\.(\d+)(?:-errata(\d+))?$/)
    ?.slice(1)
    .map((n) => Number(n ?? 0));
const compare = (a, b) => {
  const x = key(a),
    y = key(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
if (dryRun) {
  console.log(
    'Would check official consolidated page revision/content and latest stable per-file hashes for banking, insurance and ATM; previews reported separately.',
  );
  process.exit(0);
}
const get = async (url, github = false) => {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      'Cache-Control': 'no-cache',
      'User-Agent': 'of-sandbox-drift-v2',
      ...(github && token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}`);
  return response;
};
try {
  const page = await (
    await get(
      'https://openfinanceuae.atlassian.net/wiki/rest/api/content/1366294554?expand=body.storage,version',
    )
  ).json();
  if (
    page.version.number !== baseline.officialErrata.pageVersion ||
    page.version.when !== baseline.officialErrata.modifiedAt ||
    crypto.createHash('sha256').update(page.body.storage.value).digest('hex') !==
      baseline.officialErrata.storageSha256
  )
    report.push(
      'Official consolidated errata revision changed; review every correction even if the numbered group is unchanged.',
    );
} catch (e) {
  errors.push(`Official document unverified: ${e.message}`);
}
try {
  const tree = await (
    await get(
      'https://api.github.com/repos/Nebras-Open-Finance/api-specs/git/trees/main?recursive=1',
      true,
    )
  ).json();
  if (tree.truncated) throw new Error('Incomplete tree');
  const paths = tree.tree.map((e) => e.path);
  const stable = [...new Set(paths.map((p) => p.split('/')[2]).filter((p) => key(p)))].sort(
    compare,
  );
  const latestLine = stable.at(-1).split('-')[0];
  if (latestLine !== baseline.baseline)
    report.push(`New stable baseline ${latestLine}; current ${baseline.baseline}`);
  const previews = [
    ...new Set(
      paths
        .filter((p) => /^dist\/standards\/v\d+\.\d+-(?:rc|draft)\d+\//.test(p))
        .map((p) => p.split('/')[2]),
    ),
  ];
  console.log(`Previews (not adopted): ${previews.join(', ')}`);
  for (const domain of DOMAINS) {
    const filename = domain.specPath.split('/').at(-1);
    const candidates = paths.filter(
      (p) =>
        p.startsWith(`dist/standards/${latestLine}`) &&
        p.endsWith(`/${filename}`) &&
        key(p.split('/')[2]),
    );
    const file = candidates.sort((a, b) => compare(a.split('/')[2], b.split('/')[2])).at(-1);
    if (!file) throw new Error(`No effective file for ${domain.id}`);
    const bytes = Buffer.from(
      await (
        await get(
          `https://raw.githubusercontent.com/Nebras-Open-Finance/api-specs/${tree.sha}/${file}`,
        )
      ).arrayBuffer(),
    );
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (file !== baseline.domains[domain.id].path || hash !== baseline.domains[domain.id].sha256)
      report.push(`${domain.id}: effective file/path changed (${file}, ${hash})`);
  }
} catch (e) {
  errors.push(`Wire schemas unverified: ${e.message}`);
}
const body = [...report, ...errors].join('\n');
if (process.env.GITHUB_OUTPUT && body)
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `drift<<DRIFT_EOF\n${body}\nDRIFT_EOF\n`);
if (body) console.log(body);
else
  console.log(
    'Reviewed official revision and all effective stable wire hashes match; official/community errata disagreement remains documented.',
  );
process.exit(errors.length ? 1 : report.length ? 2 : 0);

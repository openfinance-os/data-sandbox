#!/usr/bin/env node
// Spec-drift watch — D-01 / R-EXP-01.
//
// Each domain vendors its OpenAPI YAML pinned by commit SHA (D-01: one
// pinned SHA per domain, no version toggle). Nothing tells the maintainer
// when upstream publishes past that pin, so a stale pin can sit unnoticed
// indefinitely. This script asks the upstream repo for commits touching
// each domain's `upstreamPath` since that domain's recorded `retrieved`
// timestamp and reports what it finds.
//
// It NEVER re-vendors or bumps a pin — re-vendoring is a deliberate human
// decision (a new errata can add mandatory fields, which the lfi-bands
// mandatory-overlap gate would then flag). The script only removes the
// silence.
//
// Exit codes: 0 = no drift (or --dry-run), 2 = drift found, 1 = error.
// `--dry-run` prints the query plan without any network call.
// Auth: GITHUB_TOKEN / GH_TOKEN if present (higher rate limit); the
// public API works unauthenticated for public repos.

import fs from 'node:fs';
import path from 'node:path';
import { DOMAINS } from './domains.config.mjs';
import { repoRoot } from './load-fixtures.mjs';

const dryRun = process.argv.includes('--dry-run');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

// Every value that reaches the outbound request is read from a file in
// this repo, so each is validated against a strict shape first. These are
// repo-controlled inputs, not user input, but an unvalidated pin file
// would otherwise be able to steer the request path — cheap to forbid.
const SHA_RE = /^[0-9a-f]{40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const PATH_RE = /^[A-Za-z0-9._\-/]+$/;

function readTrimmed(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8').trim();
}

function readValidated(rel, re, label) {
  const value = readTrimmed(rel);
  if (!re.test(value)) {
    throw new Error(`${label} in ${rel} is malformed: ${JSON.stringify(value.slice(0, 40))}`);
  }
  return value;
}

function validate(value, re, label) {
  if (typeof value !== 'string' || !re.test(value)) {
    throw new Error(`${label} is malformed: ${JSON.stringify(String(value).slice(0, 40))}`);
  }
  return value;
}

// Watch the whole standards directory that contains the pinned file, not
// just the file itself: a new errata lands as a sibling directory
// (v2.1-errata2/…) and would be invisible to a file-scoped query.
function standardsDirOf(upstreamPath) {
  const parts = upstreamPath.split('/');
  parts.pop(); // drop the filename → dist/standards/<version>
  parts.pop(); // drop the version   → dist/standards
  return parts.join('/');
}

async function commitsSince({ repo, dirPath, since }) {
  // Re-validate at the sink and assemble structurally: the host is a
  // fixed literal, the repo slug is checked to be exactly `owner/name`
  // (so it cannot escape the /repos/ prefix), and the file-derived
  // values ride in searchParams rather than raw string concatenation.
  const [owner, name] = validate(repo, REPO_RE, 'upstreamRepo').split('/');
  const url = new URL(`https://api.github.com/repos/${owner}/${name}/commits`);
  url.searchParams.set('path', validate(dirPath, PATH_RE, 'upstream path'));
  url.searchParams.set('since', validate(since, ISO_RE, 'retrieved timestamp'));
  url.searchParams.set('per_page', '20');

  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'of-data-sandbox-drift' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} for ${repo}:${dirPath} — ${await res.text()}`);
  }
  return res.json();
}

const report = [];
let failed = false;

for (const domain of DOMAINS) {
  // Validate at the source too, so a malformed pin file fails loudly with
  // the offending path named rather than at the request sink.
  const pin = readValidated(domain.pinPath, SHA_RE, 'pinned SHA');
  const retrieved = readValidated(domain.retrievedPath, ISO_RE, 'retrieved timestamp');
  const dirPath = standardsDirOf(domain.upstreamPath);

  if (dryRun) {
    console.log(
      `${domain.id}: would query ${domain.upstreamRepo}:${dirPath} since ${retrieved} (pin ${pin.slice(0, 7)})`,
    );
    continue;
  }

  try {
    const commits = await commitsSince({ repo: domain.upstreamRepo, dirPath, since: retrieved });
    // The pinned commit itself can satisfy `since=` on the exact boundary.
    const newer = commits.filter((c) => c.sha !== pin);
    if (newer.length > 0) {
      report.push({
        domain: domain.id,
        pin,
        retrieved,
        dirPath,
        commits: newer.map((c) => ({
          sha: c.sha.slice(0, 7),
          date: c.commit?.committer?.date ?? '',
          message: (c.commit?.message ?? '').split('\n')[0],
        })),
      });
    }
  } catch (err) {
    console.error(`spec-drift: ${domain.id} check failed — ${err.message}`);
    failed = true;
  }
}

if (dryRun) process.exit(0);

if (failed && report.length === 0) process.exit(1);

if (report.length === 0) {
  console.log(`spec-drift OK — all ${DOMAINS.length} domain pins are current against upstream.`);
  process.exit(0);
}

const lines = [];
for (const r of report) {
  lines.push(`### ${r.domain} (pinned \`${r.pin.slice(0, 7)}\`, retrieved ${r.retrieved})`);
  lines.push(`Upstream commits under \`${r.dirPath}\` since the pin:`);
  for (const c of r.commits) lines.push(`- \`${c.sha}\` ${c.date} — ${c.message}`);
  lines.push('');
}
const body = lines.join('\n');
console.log(body);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `drift<<DRIFT_EOF\n${body}\nDRIFT_EOF\n`);
}
process.exit(2);

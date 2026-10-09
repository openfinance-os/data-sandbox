// Run from a trusted default-branch checkout, before release credentials are
// made available. Only a successful CI push from this repository is eligible.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const repo = process.env.GITHUB_REPOSITORY;
let sha;
if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
  const run = event.workflow_run;
  if (
    run?.conclusion !== 'success' ||
    run.event !== 'push' ||
    run.head_branch !== 'main' ||
    run.head_repository?.full_name !== repo
  )
    throw new Error('Untrusted or unsuccessful CI run');
  sha = run.head_sha;
} else {
  const publishing = process.argv.includes('--publish');
  const allowedTag = /^refs\/tags\/(fixtures|mcp)-v\d+\.\d+\.\d+$/.test(
    process.env.GITHUB_REF ?? '',
  );
  if (process.env.GITHUB_REF !== 'refs/heads/main' && !(publishing && allowedTag))
    throw new Error('Manual production releases require main');
  sha = process.env.GITHUB_SHA;
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&status=success`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (!response.ok) throw new Error('Cannot verify CI status');
  const { workflow_runs: runs } = await response.json();
  if (
    !runs?.some(
      (r) =>
        r.head_sha === sha && r.head_branch === 'main' && r.head_repository?.full_name === repo,
    )
  )
    throw new Error('No successful main CI for the requested revision');
}
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid release revision');
execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main']);
execFileSync('git', ['checkout', '--detach', sha], { stdio: 'inherit' });
fs.appendFileSync(process.env.GITHUB_OUTPUT, `revision=${sha}\n`);

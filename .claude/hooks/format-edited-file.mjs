#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit) formatter.
// Runs prettier --write + eslint --fix on the single file just edited, so diffs
// stay clean mid-session (husky only does this at commit time via lint-staged).
// Best-effort and silent: never fails the tool call.
import { execFileSync } from 'node:child_process';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let file = '';
  try {
    file = JSON.parse(raw || '{}').tool_input?.file_path || '';
  } catch {
    process.exit(0);
  }
  if (!/\.(mjs|cjs|js)$/.test(file)) process.exit(0);
  const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  for (const args of [
    ['prettier', '--write', file],
    ['eslint', '--fix', file],
  ]) {
    try {
      execFileSync('npx', args, { cwd, stdio: 'ignore' });
    } catch {
      /* formatting is advisory — ignore failures (e.g. eslint rule errors) */
    }
  }
  process.exit(0);
});

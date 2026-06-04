#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit) formatter.
// Runs prettier --write on the single file just edited, so diffs stay clean
// mid-session (husky lint-staged only formats at commit time).
//
// Deliberately prettier-ONLY (no `eslint --fix`): eslint's autofixes can change
// code, not just whitespace, which risks fighting Claude's next edit. Formatting
// alone keeps the file's content stable. We invoke the local prettier binary
// directly (not `npx`) to avoid per-edit resolution latency. Best-effort and
// silent: never fails the tool call.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

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
  const bin = path.join(cwd, 'node_modules', '.bin', 'prettier');
  if (!existsSync(bin)) process.exit(0);
  try {
    execFileSync(bin, ['--write', file], { cwd, stdio: 'ignore' });
  } catch {
    /* formatting is advisory — ignore failures (e.g. unparseable file) */
  }
  process.exit(0);
});

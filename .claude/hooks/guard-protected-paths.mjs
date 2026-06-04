#!/usr/bin/env node
// PreToolUse(Edit|Write|MultiEdit) guard.
// Blocks edits to artifacts that must never be hand-authored:
//   • spec/uae-*-openapi.yaml — vendored & pinned by SHA (invariant #1/#7);
//     re-vendor + re-pin, never edit in place.
//   • dist/**                 — build output; regenerate via npm run build:*.
// Exit 2 + stderr = block the tool call (Claude sees the message and adapts).
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let file = '';
  try {
    file = JSON.parse(raw || '{}').tool_input?.file_path || '';
  } catch {
    /* not JSON we understand — allow */
  }
  const isVendoredSpec = /\/spec\/uae-[^/]*-openapi\.ya?ml$/.test(file);
  const isDistOutput = /(^|\/)dist\//.test(file);
  if (isVendoredSpec || isDistOutput) {
    const why = isVendoredSpec
      ? 'spec/*-openapi.yaml is vendored and pinned by commit SHA (invariant #1/#7). Re-vendor from the upstream api-specs repo and re-pin the SHA — do not hand-edit.'
      : 'dist/ is a build output. Regenerate it with `npm run build:spec` / `npm run build:data` instead of editing by hand.';
    process.stderr.write(`Blocked edit to ${file}.\n${why}\n`);
    process.exit(2);
  }
  process.exit(0);
});

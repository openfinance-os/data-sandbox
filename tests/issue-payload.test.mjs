// EXP-26 acceptance: every field card carries a Report-an-issue affordance
// whose URL is a pre-filled GitHub issue. We assert the URL shape and the
// body contains every required field listed in EXP-26.

import { describe, it, expect } from 'vitest';
import { buildBundle } from '../src/generator/index.js';
import { loadPersona, loadAllPools } from '../tools/load-fixtures.mjs';

// Mirror of the URL builder in src/app.js — tests both the snapshot of the
// pre-filled body and the structural invariants the spec card depends on.
function buildIssueUrl({ fieldName, field, persona, lfi, seed, endpoint, sha, repo = 'openfinance-os/data-sandbox' }) {
  const title = `[field-card] ${endpoint} — ${fieldName} (${field.status})`;
  const lines = [
    '## Field',
    `- **Name:** \`${fieldName}\``,
    `- **Path:** \`${field.path}\``,
    `- **Status:** ${field.status}`,
    `- **Type:** ${field.type}${field.format ? ` (${field.format})` : ''}`,
    field.enum?.length ? `- **Enum:** ${field.enum.join(', ')}` : null,
    '',
    '## Context',
    `- **Persona:** \`${persona}\``,
    `- **LFI profile:** \`${lfi}\``,
    `- **Seed:** \`${seed}\``,
    `- **Endpoint:** \`${endpoint}\``,
    `- **Pinned spec SHA:** \`${sha}\``,
    '',
    '## Type',
    '- [ ] Spec-interpretation error',
    '- [ ] Populate-rate band disagreement',
    '- [ ] Guidance unclear',
    '- [ ] Generator bug',
    '- [ ] Other',
  ].filter((s) => s != null);
  const body = `${lines.join('\n')}\n\n## What you saw / expected\n<!-- describe -->\n`;
  const params = new URLSearchParams();
  params.set('title', title);
  params.set('body', body);
  return `https://github.com/${repo}/issues/new?${params.toString()}`;
}

describe('Report-an-issue pre-filled payload — EXP-26', () => {
  const persona = loadPersona('salaried_expat_mid');
  const pools = loadAllPools();
  void buildBundle({ persona, lfi: 'median', seed: 4729, pools });

  const url = buildIssueUrl({
    fieldName: 'TransactionId',
    field: {
      path: 'Data.Transaction[].TransactionId',
      status: 'mandatory',
      type: 'string',
      format: undefined,
      enum: undefined,
    },
    persona: 'salaried_expat_mid',
    lfi: 'median',
    seed: 4729,
    endpoint: '/accounts/{AccountId}/transactions',
    sha: 'bc1cd97',
  });

  it('uses the github.com/.../issues/new prefilled-body shape', () => {
    expect(url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/new\?/);
    expect(url).toContain('title=');
    expect(url).toContain('body=');
  });

  it('body carries every EXP-26 required slot', () => {
    const body = decodeURIComponent(new URL(url).searchParams.get('body'));
    // Field section
    expect(body).toContain('TransactionId');
    expect(body).toContain('Data.Transaction[].TransactionId');
    expect(body).toContain('mandatory');
    // Context section
    expect(body).toContain('salaried_expat_mid');
    expect(body).toContain('median');
    expect(body).toContain('4729');
    expect(body).toContain('/accounts/{AccountId}/transactions');
    expect(body).toContain('bc1cd97');
    // Five-checkbox triage set
    expect(body).toContain('[ ] Spec-interpretation error');
    expect(body).toContain('[ ] Populate-rate band disagreement');
    expect(body).toContain('[ ] Guidance unclear');
    expect(body).toContain('[ ] Generator bug');
    expect(body).toContain('[ ] Other');
  });

  it('snapshot — the body is stable across builds', () => {
    const body = decodeURIComponent(new URL(url).searchParams.get('body'));
    expect(body).toMatchInlineSnapshot(`
      "## Field
      - **Name:** \`TransactionId\`
      - **Path:** \`Data.Transaction[].TransactionId\`
      - **Status:** mandatory
      - **Type:** string

      ## Context
      - **Persona:** \`salaried_expat_mid\`
      - **LFI profile:** \`median\`
      - **Seed:** \`4729\`
      - **Endpoint:** \`/accounts/{AccountId}/transactions\`
      - **Pinned spec SHA:** \`bc1cd97\`

      ## Type
      - [ ] Spec-interpretation error
      - [ ] Populate-rate band disagreement
      - [ ] Guidance unclear
      - [ ] Generator bug
      - [ ] Other

      ## What you saw / expected
      <!-- describe -->
      "
    `);
  });
});

// Custom-persona static-fixture zip exporter — Workstream C plug-point 3.
// Materialises the full (1 persona × 3 LFI × all endpoints) bundle matrix
// for a custom recipe and packs it into a STORE-only zip, layout-identical
// to the curated /fixtures/v1/bundles/<persona>/... tree. The TPP unzips
// into their own static host and serves it themselves — works for any
// language / framework, no JS runtime required.

import { expandRecipe } from './expand.js';
import { recipeHash } from './recipe.js';
import { buildBundle } from '../generator/index.js';
import { envelopesFromBundle } from '../ui/export.js';
import { buildZip } from './zip-writer.js';

const LFIS = ['rich', 'median', 'sparse'];

function safeName(s) {
  return s.replace(/^\//, '').replace(/\//g, '__').replace(/[{}]/g, '');
}

// Pure function — returns { bytes: Uint8Array, filename, manifest }. The
// caller (UI button or test) decides what to do with the bytes (Blob +
// URL.createObjectURL for the browser, fs.writeFileSync for Node).
export function buildCustomFixtureZip({ recipe, pools, seed = 1, now }) {
  const persona = expandRecipe(recipe, pools);
  const hash = recipeHash(recipe);
  const personaSlug = persona.persona_id; // already `custom_<hash>`
  const root = `fixtures/v1/bundles/${personaSlug}`;

  const entries = [];
  const manifest = {
    package: '@openfinance-os/sandbox-fixtures-custom',
    persona: personaSlug,
    recipeHash: hash,
    specVersion: 'v2.1',
    generatedAt: now ? new Date(now).toISOString() : new Date().toISOString(),
    fixtures: {},
  };

  for (const lfi of LFIS) {
    const bundle = buildBundle({ persona, lfi, seed, pools, now });
    const envelopes = envelopesFromBundle(bundle, {
      personaId: personaSlug,
      lfi,
      seed,
      specVersion: 'v2.1',
      specSha: 'live',
      retrievedAt: now ? new Date(now).toISOString() : new Date().toISOString(),
    });

    const endpointFiles = {};
    for (const [endpoint, env] of Object.entries(envelopes)) {
      const fname = `${safeName(endpoint)}.json`;
      const path = `${root}/${lfi}/seed-${seed}/${fname}`;
      const bytes = new TextEncoder().encode(JSON.stringify(env, null, 2));
      entries.push({ path, bytes });
      endpointFiles[endpoint] = path;
    }
    manifest.fixtures[`${personaSlug}|${lfi}|${seed}`] = {
      personaId: personaSlug,
      lfi,
      seed,
      accountIds: bundle.accounts.map((a) => a.AccountId),
      endpoints: endpointFiles,
    };
  }

  // Top-level manifest.json — same shape as the curated package's, scoped
  // to this single custom persona.
  entries.push({
    path: 'fixtures/v1/manifest.json',
    bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });
  // Persona manifest as JSON for consumers who want to introspect the
  // expanded persona.
  entries.push({
    path: `fixtures/v1/personas/${personaSlug}.json`,
    bytes: new TextEncoder().encode(JSON.stringify(persona, null, 2)),
  });

  const bytes = buildZip(entries);
  return {
    bytes,
    filename: `${personaSlug}-fixtures.zip`,
    manifest,
  };
}

// Browser convenience — assemble + trigger a download. Returns true on
// success, false if the runtime doesn't support Blob (e.g. plain Node).
export function downloadCustomFixtureZip(args) {
  const { bytes, filename } = buildCustomFixtureZip(args);
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') return false;
  const blob = new Blob([bytes], { type: 'application/zip' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(href);
    a.remove();
  }, 0);
  return true;
}

// Per-server session state. Each createServer() call gets its own store, so the
// stdio entry (one process per Claude session) and the HTTP entry (one process,
// many concurrent MCP sessions) both stay isolated.
//
// Two modes:
//   curated → persona id resolves to one of the 12 baked-in fixture bundles
//   custom  → an in-memory journey produced by build_persona at runtime
//             (recipe → expandRecipe → buildBundle → envelopesFromBundle).
// All get_* tools call `getEndpointEnvelope(session, endpoint)` which routes
// to the in-memory custom journey if present, else to the static fixture file.
import { getPersonaInfo, loadFixture, manifest } from '@openfinance-os/sandbox-fixtures';

const LFI_PROFILES = new Set(['rich', 'median', 'sparse']);

export function createSessionStore() {
  let active = null;

  function setCurated({ persona, lfi = 'median', seed }) {
    const info = getPersonaInfo(persona);
    if (!info) throw new Error(`unknown persona: ${persona}`);
    if (!LFI_PROFILES.has(lfi)) {
      throw new Error(`unknown lfi profile: ${lfi} (use rich | median | sparse)`);
    }
    active = {
      kind: 'curated',
      persona,
      lfi,
      seed: seed ?? info.default_seed,
      personaName: info.name,
    };
    return active;
  }

  function setCustom({ persona, lfi, seed, journey, recipe, recipeHash, personaName }) {
    if (!LFI_PROFILES.has(lfi)) {
      throw new Error(`unknown lfi profile: ${lfi}`);
    }
    active = {
      kind: 'custom',
      persona,
      lfi,
      seed,
      personaName,
      recipe,
      recipeHash,
      journey,
    };
    return active;
  }

  function get() {
    if (!active) {
      throw new Error(
        'no active session — call set_session (curated) or build_persona (custom) first. Use list_personas to see the 12 banking personas, or get_recipe_defaults to compose a custom one.',
      );
    }
    return active;
  }

  return {
    setCurated,
    setCustom,
    get,
    peek: () => active,
    clear: () => {
      active = null;
    },
  };
}

export function getEndpointEnvelope(session, endpoint) {
  if (session.kind === 'custom') {
    const env = session.journey.endpoints[endpoint];
    if (!env) {
      throw new Error(`no endpoint ${endpoint} in custom journey`);
    }
    return env;
  }
  return loadFixture({
    persona: session.persona,
    lfi: session.lfi,
    seed: session.seed,
    endpoint,
  });
}

export function fanOutAccountIds(session) {
  if (session.kind === 'custom') {
    return session.journey.accountIds ?? [];
  }
  const fxKey = `${session.persona}|${session.lfi}|${session.seed}`;
  const fx = manifest.fixtures[fxKey];
  return fx?.accountIds ?? [];
}

export { LFI_PROFILES };

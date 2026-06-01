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
//
// D-14 / Slice 8: curated sessions also accept an `lfi_role` of
// 'primary' (default), 'secondary', or 'tertiary'. When non-primary,
// getEndpointEnvelope resolves against the persona's role-keyed bundle
// (Phase D Slice 5) — the LLM consumer can ask "what does this persona
// look like at their secondary LFI?" without changing personas.
import {
  getPersonaInfo,
  loadFixture,
  listRoleBundles,
  manifest,
} from '@openfinance-os/sandbox-fixtures';

const LFI_PROFILES = new Set(['rich', 'median', 'sparse']);
// 'primary' is always valid; any non-primary role must have an emitted role
// bundle (discovered per-persona via listRoleBundles, which covers both the
// legacy secondary/tertiary triad and Phase 2.2 N-slot keys).
const LFI_ROLES = new Set(['primary', 'secondary', 'tertiary']);

export function createSessionStore() {
  let active = null;

  function setCurated({ persona, lfi = 'median', seed, lfi_role = 'primary' }) {
    const info = getPersonaInfo(persona);
    if (!info) throw new Error(`unknown persona: ${persona}`);
    if (!LFI_PROFILES.has(lfi)) {
      throw new Error(`unknown lfi profile: ${lfi} (use rich | median | sparse)`);
    }
    if (lfi_role !== 'primary') {
      // A non-primary role is valid iff a role bundle was emitted for it.
      // listRoleBundles returns the actually-emitted slot keys (legacy
      // secondary/tertiary AND Phase 2.2 N-slot keys); some declared slots
      // resolve to candidates outside the counterparty pool and silently
      // drop, so this is the authoritative loadable set.
      const slots = listRoleBundles(persona);
      if (!slots.includes(lfi_role)) {
        const available = ['primary', ...slots].join(' | ');
        throw new Error(
          `persona "${persona}" has no role bundle for lfi_role="${lfi_role}" (available: ${available})`,
        );
      }
    }
    active = {
      kind: 'curated',
      domain: info.domain ?? 'banking',
      persona,
      lfi,
      lfi_role,
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
      // Custom personas are banking-only — the recipe schema in this package
      // covers retail/SME/corporate banking knobs, with no insurance shape.
      domain: 'banking',
      persona,
      lfi,
      lfi_role: 'primary', // Custom personas don't carry multi_lfi_footprint.
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
        'no active session — call set_session (curated) or build_persona (custom) first. Use list_personas to see the 38 curated personas (21 banking + 9 insurance + 8 multi-domain), or get_recipe_defaults to compose a custom one.',
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
    lfi_role: session.lfi_role,
  });
}

export function fanOutAccountIds(session) {
  if (session.kind === 'custom') {
    return session.journey.accountIds ?? [];
  }
  if (session.lfi_role && session.lfi_role !== 'primary') {
    const rkey = `${session.persona}|${session.lfi_role}|${session.lfi}|${session.seed}`;
    const rfx = (manifest.roleFixtures ?? {})[rkey];
    return rfx?.accountIds ?? [];
  }
  const fxKey = `${session.persona}|${session.lfi}|${session.seed}`;
  const fx = manifest.fixtures[fxKey];
  return fx?.accountIds ?? [];
}

export function fixtureEntry(session) {
  if (session.lfi_role && session.lfi_role !== 'primary') {
    const rkey = `${session.persona}|${session.lfi_role}|${session.lfi}|${session.seed}`;
    return (manifest.roleFixtures ?? {})[rkey] ?? null;
  }
  const fxKey = `${session.persona}|${session.lfi}|${session.seed}`;
  return manifest.fixtures[fxKey] ?? null;
}

export { LFI_PROFILES, LFI_ROLES };

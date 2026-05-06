// Per-process session state for stdio MCP. One process == one Claude session,
// so module-level state is per-connection by construction.
import { getPersonaInfo } from '@openfinance-os/sandbox-fixtures';

const LFI_PROFILES = new Set(['rich', 'median', 'sparse']);

let active = null;

export function setSession({ persona, lfi = 'median', seed }) {
  const info = getPersonaInfo(persona);
  if (!info) throw new Error(`unknown persona: ${persona}`);
  if (!LFI_PROFILES.has(lfi)) {
    throw new Error(`unknown lfi profile: ${lfi} (use rich | median | sparse)`);
  }
  active = {
    persona,
    lfi,
    seed: seed ?? info.default_seed,
    personaName: info.name,
  };
  return active;
}

export function getSession() {
  if (!active) {
    throw new Error(
      'no active session — call set_session with a persona (e.g. salaried_expat_mid) first. Use list_personas to see all 12 banking personas.',
    );
  }
  return active;
}

export function peekSession() {
  return active;
}

export function clearSession() {
  active = null;
}

export { LFI_PROFILES };

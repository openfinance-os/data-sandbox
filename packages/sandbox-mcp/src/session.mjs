// Per-server session state. Each createServer() call gets its own store, so the
// stdio entry (one process per Claude session) and the HTTP entry (one process,
// many concurrent MCP sessions) both stay isolated.
import { getPersonaInfo } from '@openfinance-os/sandbox-fixtures';

const LFI_PROFILES = new Set(['rich', 'median', 'sparse']);

export function createSessionStore() {
  let active = null;
  return {
    set({ persona, lfi = 'median', seed }) {
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
    },
    get() {
      if (!active) {
        throw new Error(
          'no active session — call set_session with a persona (e.g. salaried_expat_mid) first. Use list_personas to see all 12 banking personas.',
        );
      }
      return active;
    },
    peek() {
      return active;
    },
    clear() {
      active = null;
    },
  };
}

export { LFI_PROFILES };

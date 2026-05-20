// EXP-27 ergonomic affordance — copy a chrome-less embed iframe
// snippet, pinned to the active persona / LFI / endpoint / seed, to
// the clipboard. Pure UI module; takes state and the two pseudo-
// endpoint identifiers as deps.

import { encodeEmbed } from '../url.js';
import { copyToClipboard } from './clipboard.js';

export function createEmbedSnippet(deps) {
  const { state, OVERVIEW_PSEUDO, UNDERWRITING_PSEUDO } = deps;

  // Pure snippet builder — used by both the legacy clipboard helper and
  // the unified export popover (PR #6).
  function buildEmbedSnippet() {
    const slugBase =
      window.location.origin + window.location.pathname.replace(/\/index\.html$/, '');
    const url =
      slugBase.replace(/\/$/, '') +
      encodeEmbed({
        personaId: state.personaId,
        lfi: state.lfi,
        endpoint:
          state.endpoint === OVERVIEW_PSEUDO || state.endpoint === UNDERWRITING_PSEUDO
            ? '/accounts/{AccountId}/transactions'
            : state.endpoint,
        seed: state.seed,
        height: 600,
      }).replace(/^\/embed/, '/embed.html');
    return `<iframe src="${url}" width="100%" height="600" loading="lazy" title="Open Finance Data Sandbox · ${state.personaId} · ${state.lfi}" referrerpolicy="no-referrer" style="border:1px solid #d9d5cb;border-radius:4px"></iframe>`;
  }
  function copyEmbedSnippet() {
    copyToClipboard(
      buildEmbedSnippet(),
      'Embed snippet copied. Paste into your slide deck or article.',
    );
  }

  return { copyEmbedSnippet, buildEmbedSnippet };
}

// Completion results stay local: EXP-21 permits success events only, with
// the existing share/export properties. Manual selection is not a copy.
export async function copyToClipboard(text, doneLabel, { container = document.body } = {}) {
  document.querySelectorAll('.manual-copy-fallback').forEach((n) => n.remove());
  if (!text) return { status: 'failed', reason: 'unavailable' };
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      showActionToast(doneLabel);
      return { status: 'confirmed-success', method: 'clipboard' };
    } catch {
      // Permission rejection and synchronous API errors both use the fallback.
    }
  }
  const { fallbackCopy } = await import('./manual-copy.js');
  return fallbackCopy(text, doneLabel, container, showActionToast);
}

export function showActionToast(text) {
  document.querySelectorAll('.copy-toast').forEach((n) => n.remove());
  const t = document.createElement('div');
  t.className = 'copy-toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

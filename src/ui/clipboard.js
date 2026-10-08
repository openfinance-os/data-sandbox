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
  return fallbackCopy(text, doneLabel, container);
}

function fallbackCopy(text, doneLabel, container) {
  const previousFocus = document.activeElement;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.setAttribute('aria-label', 'Snippet to copy manually');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  if (!container?.isConnected) return { status: 'failed', reason: 'dismissed' };
  container.appendChild(ta);
  ta.select();
  let reason;
  try {
    if (document.execCommand('copy') === true) {
      ta.remove();
      showActionToast(doneLabel);
      return { status: 'confirmed-success', method: 'execCommand' };
    }
    reason = 'copy-returned-false';
  } catch {
    reason = 'copy-threw';
  }

  // Keep the fallback inside the caller's dialog so its focus trap still
  // lets the user select, copy and dismiss it. Replace it on the next attempt.
  const panel = document.createElement('div');
  panel.className = 'manual-copy-fallback';
  const instructions = document.createElement('p');
  instructions.textContent =
    'Automatic copy blocked. Press ⌘C / Ctrl+C to copy the selected snippet.';
  ta.style.position = 'static';
  ta.style.opacity = '1';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Close manual copy';
  dismiss.addEventListener('click', () => {
    panel.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  });
  panel.append(instructions, ta, dismiss);
  container.appendChild(panel);
  ta.focus();
  ta.select();
  showActionToast('Copy blocked — selecting snippet for ⌘C / Ctrl+C.');
  return { status: 'manual-copy-pending', reason };
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

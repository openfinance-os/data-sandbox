// Manual selection is loaded only when automatic clipboard copying is unavailable.
export function fallbackCopy(text, doneLabel, container, showActionToast) {
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

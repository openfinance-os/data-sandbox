// Best-effort clipboard write with a non-blocking toast on success.
// Uses navigator.clipboard.writeText when available; falls back to a
// hidden textarea + execCommand('copy') so the user can ⌘C / Ctrl+C
// themselves if the browser blocks programmatic clipboard access.
// Pure utility — no state, no DOM helper deps; consumers just call
// copyToClipboard(text, label).

export function copyToClipboard(text, doneLabel) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => showCopyToast(doneLabel),
      () => fallbackCopy(text, doneLabel),
    );
  } else {
    fallbackCopy(text, doneLabel);
  }
}

function fallbackCopy(text, doneLabel) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showCopyToast(doneLabel);
  } catch {
    showCopyToast('Copy blocked — selecting snippet for ⌘C / Ctrl+C.');
    ta.style.opacity = '1';
    return;
  }
  ta.remove();
}

function showCopyToast(text) {
  document.querySelectorAll('.copy-toast').forEach((n) => n.remove());
  const t = document.createElement('div');
  t.className = 'copy-toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

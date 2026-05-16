// /connect page — fills the live build metadata from the deployed
// fixture manifest, matching the pattern used by /about and /integrate
// so the spec SHA / sandbox version / retrieved date shown to TPP
// integrators always matches what /fixtures/v1/ is actually serving.

async function init() {
  let manifest = null;
  try {
    const res = await fetch('../fixtures/v1/manifest.json');
    if (res.ok) manifest = await res.json();
  } catch { /* fall through to SPEC.json fallback */ }

  let spec = null;
  if (!manifest) {
    try {
      const res = await fetch('../dist/SPEC.json');
      if (res.ok) spec = await res.json();
    } catch { /* leave fields as em-dashes */ }
  }

  const sha = (manifest?.specSha ?? spec?.pinSha ?? 'unknown').slice(0, 7);
  document.getElementById('footer-sha').textContent = sha;
  document.getElementById('meta-sha').textContent = manifest?.specSha ?? spec?.pinSha ?? '—';
  document.getElementById('meta-retrieved').textContent = manifest?.nowAnchor ?? spec?.retrievedAt ?? '—';
  document.getElementById('meta-version').textContent = manifest?.version ?? '—';
  document.getElementById('meta-generated').textContent = manifest?.generatedAt ?? '—';
}

init().catch((err) => {
  const banner = document.createElement('pre');
  banner.textContent = `connect init failed: ${String(err.message ?? err)}`;
  banner.style.cssText = 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});

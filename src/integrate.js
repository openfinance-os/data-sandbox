// /integrate page — fills the live build metadata from the deployed
// fixture manifest so the sandbox version / spec SHA / retrieved date
// shown to TPP integrators always matches what /fixtures/v1/ is serving.

async function init() {
  let manifest = null;
  try {
    const res = await fetch('../fixtures/v1/manifest.json');
    if (res.ok) manifest = await res.json();
  } catch { /* fall through to SPEC.json fallback */ }

  // Fall back to the dist SPEC pin if the fixture package isn't staged
  // (e.g. running locally without `npm run build:fixtures`).
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
  banner.textContent = `integrate init failed: ${String(err.message ?? err)}`;
  banner.style.cssText = 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});

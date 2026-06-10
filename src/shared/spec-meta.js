// Live spec-pin metadata fill, shared by the /integrate and /connect pages.
// Reads the deployed fixture manifest (so the version / spec SHA / retrieved
// date shown always matches what /fixtures/v1/ is serving) and falls back to
// the dist SPEC pin when the fixture package isn't staged (e.g. running
// locally without `npm run build:fixtures`). Writes into the standard
// element IDs: footer-sha, meta-sha, meta-retrieved, meta-version,
// meta-generated — pages without one of them simply skip that field.

export async function fillSpecMeta() {
  let manifest = null;
  try {
    const res = await fetch('../fixtures/v1/manifest.json');
    if (res.ok) manifest = await res.json();
  } catch {
    /* fall through to SPEC.json fallback */
  }

  let spec = null;
  if (!manifest) {
    try {
      const res = await fetch('../dist/SPEC.json');
      if (res.ok) spec = await res.json();
    } catch {
      /* leave fields as em-dashes */
    }
  }

  const set = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  const sha = (manifest?.specSha ?? spec?.pinSha ?? 'unknown').slice(0, 7);
  set('footer-sha', sha);
  set('meta-sha', manifest?.specSha ?? spec?.pinSha ?? '—');
  set('meta-retrieved', manifest?.nowAnchor ?? spec?.retrievedAt ?? '—');
  set('meta-version', manifest?.version ?? '—');
  set('meta-generated', manifest?.generatedAt ?? '—');
}

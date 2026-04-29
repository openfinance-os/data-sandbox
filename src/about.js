// /about page — fills the metadata grid from the live SPEC.json so the
// version pin / retrieved date / SHA never drift from what the sandbox is
// actually serving.

async function init() {
  const res = await fetch('../dist/SPEC.json');
  const spec = await res.json();
  const sha = (spec.pinSha || 'unknown').slice(0, 7);
  document.getElementById('footer-sha').textContent = sha;
  document.getElementById('meta-openapi').textContent = spec.openapiVersion ?? '—';
  document.getElementById('meta-repo').textContent = spec.upstreamRepo ?? '—';
  document.getElementById('meta-sha').textContent = spec.pinSha ?? '—';
  document.getElementById('meta-retrieved').textContent = spec.retrievedAt ?? '—';
  document.getElementById('meta-endpoints').textContent = String(Object.keys(spec.endpoints ?? {}).length);

  let total = 0;
  let mandatory = 0;
  for (const e of Object.values(spec.endpoints ?? {})) {
    total += e.fields.length;
    mandatory += e.fields.filter((f) => f.status === 'mandatory').length;
  }
  document.getElementById('meta-fields').textContent = String(total);
  document.getElementById('meta-mandatory').textContent = String(mandatory);
}

init().catch((err) => {
  const banner = document.createElement('pre');
  banner.textContent = `about init failed: ${String(err.message ?? err)}`;
  banner.style.cssText = 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});

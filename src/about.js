// /about page — fills the metadata grid from the live SPEC.json so the
// version pin / retrieved date / SHA never drift from what the sandbox is
// actually serving. Multi-domain (Phase 2.0): fetches the per-domain SPEC
// indicated by ?domain=…, falling back to banking. The footer SHA always
// shows the active domain's pin.

async function init() {
  const params = new URLSearchParams(window.location.search);
  const requestedDomain = params.get('domain');
  const domainsRes = await fetch('../dist/domains.json');
  const domainsManifest = await domainsRes.json();
  const domains = Object.fromEntries(domainsManifest.domains.map((d) => [d.id, d]));
  const domainId = domains[requestedDomain] ? requestedDomain : 'banking';
  const domain = domains[domainId];

  const specRes = await fetch(`..${domain.parsedJsonUrl}`);
  const spec = await specRes.json();

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

  // Surface the active domain so a reader landing on /about?domain=insurance
  // can tell the metadata grid is not banking.
  const baseline = document.querySelector('.meta-grid dd:first-of-type');
  if (baseline && domain.label) {
    baseline.textContent = `${domain.label} (${domain.status === 'preview' ? 'preview' : 'GA'}) — ${baseline.textContent}`;
  }
}

init().catch((err) => {
  const banner = document.createElement('pre');
  banner.textContent = `about init failed: ${String(err.message ?? err)}`;
  banner.style.cssText = 'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});

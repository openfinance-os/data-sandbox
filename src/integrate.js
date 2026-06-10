// /integrate page — fills the live build metadata from the deployed
// fixture manifest so the sandbox version / spec SHA / retrieved date
// shown to TPP integrators always matches what /fixtures/v1/ is serving.
// The fill logic is shared with /connect via shared/spec-meta.js.

import { fillSpecMeta } from './shared/spec-meta.js';

fillSpecMeta().catch((err) => {
  const banner = document.createElement('pre');
  banner.textContent = `integrate init failed: ${String(err.message ?? err)}`;
  banner.style.cssText =
    'background:#fee;color:#600;padding:8px;border-bottom:1px solid #c33;margin:0';
  document.body.insertBefore(banner, document.body.firstChild);
});

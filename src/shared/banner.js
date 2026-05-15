// Synthetic-data disclaimer chrome — PR-10.
//
// The full disclaimer (NG4 / EXP-07) lives inside an expandable popover
// anchored to the `SYNTHETIC ⓘ` chip in the topbar. A 4 px amber stripe
// at the very top of the page keeps the synthetic provenance loud at all
// times. Watermarking on exports (§6.5 / EXP-19) and the /about copy keep
// the synthetic provenance discoverable either way.
//
// State is JS-only per EXP-22 — no localStorage / sessionStorage writes.
// A refresh re-arms the open state by design (the chip never auto-opens;
// the stripe is always visible and that's the load-bearing affordance).

let popoverOpen = false;

function wireChip(chip) {
  if (chip.dataset.chipWired === '1') return;
  chip.dataset.chipWired = '1';

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popoverOpen) closePopover();
    else openPopover();
  });
  // ESC closes from anywhere; click-outside also closes.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popoverOpen) {
      closePopover();
      chip.focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!popoverOpen) return;
    const pop = document.getElementById('banner-popover');
    if (!pop) return;
    if (pop.contains(e.target) || chip.contains(e.target)) return;
    closePopover();
  });
}

function openPopover() {
  const pop = document.getElementById('banner-popover');
  const chip = document.getElementById('banner-chip');
  if (!pop || !chip) return;
  pop.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  popoverOpen = true;
}

function closePopover() {
  const pop = document.getElementById('banner-popover');
  const chip = document.getElementById('banner-chip');
  if (pop) pop.hidden = true;
  if (chip) chip.setAttribute('aria-expanded', 'false');
  popoverOpen = false;
}

// Auxiliary pages (about.html, integrate.html) carry the legacy
// .banner[data-dismissible] block and don't host the topbar chip. Wire
// a session-only × close on those.
function wireLegacyBanner(banner) {
  if (banner.dataset.bannerWired === '1') return;
  banner.dataset.bannerWired = '1';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'banner-close';
  btn.setAttribute('aria-label', 'Dismiss synthetic data notice');
  btn.title = 'Dismiss';
  btn.textContent = '×';
  btn.addEventListener('click', () => { banner.hidden = true; });
  banner.appendChild(btn);
}

function init() {
  const chip = document.getElementById('banner-chip');
  if (chip) wireChip(chip);
  document
    .querySelectorAll('.banner[data-dismissible]')
    .forEach((el) => wireLegacyBanner(el));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

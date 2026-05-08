// Dismissible synthetic-data banner. The banner itself is the load-bearing
// disclaimer (NG4 / EXP-07) and stays in the DOM on first paint; once the
// user closes it we persist the choice so it doesn't reclaim screen real
// estate on every visit. Watermarking on exports (§6.5 / EXP-19) and the
// /about copy keep the synthetic provenance discoverable either way.

const STORAGE_KEY = 'of-sandbox.banner-dismissed.v1';

function isDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode / storage disabled — dismissal is session-only */
  }
}

function wire(banner) {
  if (banner.dataset.bannerWired === '1') return;
  banner.dataset.bannerWired = '1';

  if (isDismissed()) {
    banner.hidden = true;
    return;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'banner-close';
  btn.setAttribute('aria-label', 'Dismiss synthetic data notice');
  btn.title = 'Dismiss';
  btn.textContent = '×';
  btn.addEventListener('click', () => {
    banner.hidden = true;
    persistDismissed();
  });
  banner.appendChild(btn);
}

function init() {
  document
    .querySelectorAll('.banner[data-dismissible]')
    .forEach((el) => wire(el));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

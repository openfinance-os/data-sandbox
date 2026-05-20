// EXP-14 hover preview tooltip — quick field-card peek that opens
// after a 120ms hover delay on field-name buttons in the rendered
// table. Pins on click via the field-card module (see openFieldCard).
// Pure UI module; takes state, the DOM helper, and the field-map
// helper as deps. The hide-timer is closure-private so multiple
// re-renders can't stack timers on it.

import { bandForFieldName, statusBadge, realLfisGuidance } from '../shared/spec-helpers.js';

export function createHoverPreview(deps) {
  const { state, el, endpointFieldsByName } = deps;

  let hoverHideTimer = null;

  function attachHoverPreview(node, fieldName) {
    let openTimer = null;
    const open = () => {
      clearTimeout(hoverHideTimer);
      showHoverPreview(node, fieldName);
    };
    const hide = () => {
      clearTimeout(openTimer);
      hoverHideTimer = setTimeout(hideHoverPreview, 80);
    };
    node.addEventListener('mouseenter', () => {
      openTimer = setTimeout(open, 120);
    });
    node.addEventListener('mouseleave', hide);
    node.addEventListener('focus', open);
    node.addEventListener('blur', hide);
  }

  function showHoverPreview(anchor, fieldName) {
    const fieldsByName = endpointFieldsByName();
    const f = fieldsByName.get(fieldName);
    if (!f) return;
    const card = document.getElementById('hovercard');
    if (!card) return;
    const band = bandForFieldName(fieldName, state.endpoint, state.spec);
    const badge = statusBadge(f.status);

    card.replaceChildren();
    card.appendChild(el('div', { class: 'hc-title', text: fieldName }));
    const status = el('div', { class: 'hc-status' });
    status.appendChild(
      el('span', {
        class: `pill ${badge.shape}`,
        text: badge.label,
        attrs: { 'aria-label': badge.text },
      }),
    );
    status.appendChild(document.createTextNode(badge.text));
    if (band)
      status.appendChild(
        el('span', {
          attrs: { style: 'margin-left:6px;font-size:10px;color:var(--text-muted)' },
          text: ` · ${band} band`,
        }),
      );
    card.appendChild(status);
    card.appendChild(el('div', { class: 'hc-guidance', text: realLfisGuidance(f, band) }));
    const meta = `${f.type}${f.format ? ' · ' + f.format : ''}${Array.isArray(f.enum) ? ` · enum (${f.enum.length})` : ''}`;
    card.appendChild(el('div', { class: 'hc-meta', text: meta }));
    card.appendChild(
      el('div', {
        class: 'hc-meta',
        attrs: { style: 'margin-top:6px;font-style:italic' },
        text: 'Click to pin full card →',
      }),
    );

    // Position next to the anchor — prefer below, flip above if overflowing.
    card.hidden = false;
    const r = anchor.getBoundingClientRect();
    const cardW = Math.min(card.offsetWidth, 320);
    const cardH = card.offsetHeight;
    let left = Math.min(window.innerWidth - cardW - 8, Math.max(8, r.left));
    let top = r.bottom + 6;
    if (top + cardH > window.innerHeight - 8) top = Math.max(8, r.top - cardH - 6);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function hideHoverPreview() {
    const card = document.getElementById('hovercard');
    if (card) card.hidden = true;
  }

  return { attachHoverPreview };
}

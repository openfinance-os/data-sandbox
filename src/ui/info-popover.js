// Info-popover wiring — anchors each `.info-trigger` popover to its
// trigger button (the native HTML Popover API otherwise viewport-centres
// it) and mirrors open/closed state back as `aria-expanded` so screen
// readers announce it. EXP-23.

const GAP = 6;
const PAD = 8;
const MAX_WIDTH = 280;

function positionPopover(trigger, popover) {
  const r = trigger.getBoundingClientRect();
  let left = r.left;
  if (left + MAX_WIDTH > window.innerWidth - PAD) {
    left = Math.max(PAD, window.innerWidth - MAX_WIDTH - PAD);
  }
  popover.style.top = `${r.bottom + GAP}px`;
  popover.style.left = `${left}px`;
}

for (const trigger of document.querySelectorAll('.info-trigger[popovertarget]')) {
  const popover = document.getElementById(trigger.getAttribute('popovertarget'));
  if (!popover) continue;
  popover.addEventListener('beforetoggle', (e) => {
    const opening = e.newState === 'open';
    if (opening) positionPopover(trigger, popover);
    trigger.setAttribute('aria-expanded', String(opening));
  });
}

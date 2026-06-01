// @vitest-environment jsdom
//
// Unit coverage for the shared DOM helpers (src/shared/dom.js). These run in
// jsdom because the helpers produce/inspect real DOM nodes and (for the focus
// trap) drive document.activeElement + keydown handling. The browser-level
// modal wiring is covered by the Playwright e2e suite; this guards the
// helper contracts that the wiring depends on.

import { describe, it, expect, beforeEach } from 'vitest';
import { el, statusPill, syncViewTabs, trapFocus } from '../src/shared/dom.js';

describe('el', () => {
  it('sets class, text, attrs, dataset and appends children', () => {
    const child = el('span', { text: 'kid' });
    const node = el(
      'div',
      { class: 'c', text: 'parent-text-overwritten', attrs: { id: 'x' }, dataset: { kind: 'a' } },
      'tail',
      child,
      null,
    );
    expect(node.className).toBe('c');
    expect(node.getAttribute('id')).toBe('x');
    expect(node.dataset.kind).toBe('a');
    // text is set first, then children appended after it
    expect(node.textContent).toBe('parent-text-overwrittentailkid');
    expect(node.querySelector('span')).toBe(child);
  });

  it('skips null/undefined/false attrs and maps true → empty string', () => {
    const node = el('button', {
      attrs: { disabled: true, hidden: false, 'data-skip': null, 'aria-selected': 'false' },
    });
    expect(node.hasAttribute('disabled')).toBe(true);
    expect(node.getAttribute('disabled')).toBe('');
    expect(node.hasAttribute('hidden')).toBe(false);
    expect(node.hasAttribute('data-skip')).toBe(false);
    // string 'false' is preserved (aria-selected="false" is meaningful)
    expect(node.getAttribute('aria-selected')).toBe('false');
  });

  it('wires onClick / onChange / onInput listeners', () => {
    const calls = [];
    const node = el('input', {
      onClick: () => calls.push('click'),
      onChange: () => calls.push('change'),
      onInput: () => calls.push('input'),
    });
    node.dispatchEvent(new window.Event('click'));
    node.dispatchEvent(new window.Event('change'));
    node.dispatchEvent(new window.Event('input'));
    expect(calls).toEqual(['click', 'change', 'input']);
  });
});

describe('statusPill', () => {
  it('renders the spec-driven pill span for each status', () => {
    const m = statusPill('mandatory');
    expect(m.className).toBe('pill pill-solid');
    expect(m.textContent).toBe('M');
    expect(m.getAttribute('aria-label')).toBe('Mandatory');

    expect(statusPill('conditional').className).toBe('pill pill-conditional');
    expect(statusPill('optional').className).toBe('pill pill-dashed');
  });
});

describe('syncViewTabs', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="view-rendered"></button><button id="view-raw"></button>';
  });

  it('marks the active tab and aria-selected state', () => {
    syncViewTabs('rendered');
    const r = document.getElementById('view-rendered');
    const raw = document.getElementById('view-raw');
    expect(r.classList.contains('active')).toBe(true);
    expect(raw.classList.contains('active')).toBe(false);
    expect(r.getAttribute('aria-selected')).toBe('true');
    expect(raw.getAttribute('aria-selected')).toBe('false');

    syncViewTabs('raw');
    expect(r.classList.contains('active')).toBe(false);
    expect(raw.classList.contains('active')).toBe(true);
    expect(raw.getAttribute('aria-selected')).toBe('true');
  });

  it('is a no-op when the tab elements are absent (embed mode)', () => {
    document.body.innerHTML = '';
    expect(() => syncViewTabs('rendered')).not.toThrow();
  });
});

describe('trapFocus', () => {
  let cleanup;
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="outside">outside</button>
      <div id="dialog">
        <button id="first">first</button>
        <input id="middle" />
        <button id="last">last</button>
      </div>`;
    cleanup = null;
  });

  function tab(shift = false) {
    const ev = new window.KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(ev);
    return ev;
  }

  it('wraps Tab from last → first and Shift+Tab from first → last', () => {
    const dialog = document.getElementById('dialog');
    cleanup = trapFocus(dialog);
    const first = document.getElementById('first');
    const last = document.getElementById('last');

    last.focus();
    const e1 = tab(false);
    expect(e1.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    const e2 = tab(true);
    expect(e2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);

    cleanup();
  });

  it('pulls focus back when it has escaped the container', () => {
    const dialog = document.getElementById('dialog');
    cleanup = trapFocus(dialog);
    document.getElementById('outside').focus();
    const e = tab(false);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.getElementById('first'));
    cleanup();
  });

  it('cleanup removes the trap (Tab no longer redirected)', () => {
    const dialog = document.getElementById('dialog');
    trapFocus(dialog)();
    const last = document.getElementById('last');
    last.focus();
    const e = tab(false);
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('does not throw on a null container', () => {
    expect(() => trapFocus(null)()).not.toThrow();
  });
});

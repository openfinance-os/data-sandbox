// PR #6 — Unified Export popover. Replaces the JSON / CSV / Tarball /
// Embed button row and the toolbar Share button with one Export ▾ button
// that opens a tabbed popover.
//
// Tabs: Permalink · Embed iframe · JSON · CSV · Tarball · npm · Python ·
// curl · MCP. Each tab renders a code/URL snippet (or a Download action for
// Tarball, which is binary) with a Copy button.
//
// Keyboard contract:
//   ⌘E / Ctrl+E              open the popover (handler lives in app.js)
//   Esc                      close (also app.js — checks isOpen, calls close)
//   Tab / Shift+Tab          move between focusable elements
//   Arrow Left / Right       move between tab buttons within the tablist
//   Home / End               first / last tab
// On open the previously-focused trigger is captured and restored on
// close so Tab resumes from the right place (EXP-23). ARIA tab pattern:
// role="tablist" on the strip, role="tab" + aria-controls on each tab,
// role="tabpanel" + aria-labelledby on the body. State is JS-only per
// EXP-22. No analytics events beyond the 'export' / 'share' allowlist.

import { trapFocus } from '../shared/dom.js';

export function createExportPopover(deps) {
  const {
    state,
    el,
    track,
    copyToClipboard,
    exportActiveJson,
    exportActiveCsv,
    exportTarball,
    activeFixtureUrl,
    embedIframeSnippet,
    activeJsonString,
    activeCsvString,
  } = deps;

  let overlay = null;
  let activeTabKey = 'permalink';
  // PR-13 (Greptile P2) — capture the trigger element when the popover
  // opens so focus can return to it on close (EXP-23 keyboard a11y).
  let triggerElement = null;
  // Focus-trap teardown while the popover is open (WCAG 2.4.3 / 2.1.2).
  let releaseTrap = null;

  function snippetForTab(key) {
    const ctx = {
      personaId: state.personaId,
      lfi: state.lfi,
      seed: state.seed,
      endpoint: state.endpoint,
    };
    switch (key) {
      case 'permalink':
        return { lang: 'url', text: window.location.href };
      case 'embed':
        return { lang: 'html', text: embedIframeSnippet() };
      case 'json':
        return { lang: 'json', text: activeJsonString() };
      case 'csv':
        return { lang: 'csv', text: activeCsvString() };
      case 'tarball':
        return {
          lang: 'note',
          text:
            'Tarball is a binary artefact — click "Download" below to save a single .tar with every endpoint + CSV ' +
            `for ${ctx.personaId} / ${ctx.lfi} / seed ${ctx.seed}.`,
          isDownload: true,
        };
      case 'npm':
        return {
          lang: 'javascript',
          text:
            `import { loadJourney } from '@openfinance-os/sandbox-fixtures';\n\n` +
            `const journey = loadJourney({\n` +
            `  persona: '${ctx.personaId}',\n` +
            `  lfi: '${ctx.lfi}',\n` +
            `  seed: ${ctx.seed},\n` +
            `});\n`,
        };
      case 'python':
        return {
          lang: 'python',
          text:
            `from openfinance_os_sandbox_fixtures import load_journey\n\n` +
            `journey = load_journey(\n` +
            `    persona='${ctx.personaId}',\n` +
            `    lfi='${ctx.lfi}',\n` +
            `    seed=${ctx.seed},\n` +
            `)\n`,
        };
      case 'curl':
        return {
          lang: 'bash',
          text:
            `# Active endpoint as v2.1-shaped JSON envelope\n` +
            `curl -s '${activeFixtureUrl()}' | jq .`,
        };
      case 'mcp':
        return {
          lang: 'javascript',
          text:
            `// Open Finance Data Sandbox — MCP server\n` +
            `// Tools: list_personas · set_session · load_journey · get_*\n` +
            `await client.callTool('set_session', {\n` +
            `  persona: '${ctx.personaId}',\n` +
            `  lfi: '${ctx.lfi}',\n` +
            `  seed: ${ctx.seed},\n` +
            `});\n` +
            `const accounts = await client.callTool('get_accounts');\n`,
        };
      default:
        return { lang: 'text', text: '' };
    }
  }

  const TABS = [
    { key: 'permalink', label: 'Permalink' },
    { key: 'embed', label: 'Embed iframe' },
    { key: 'json', label: 'JSON' },
    { key: 'csv', label: 'CSV' },
    { key: 'tarball', label: 'Tarball' },
    { key: 'npm', label: 'npm' },
    { key: 'python', label: 'Python' },
    { key: 'curl', label: 'curl' },
    { key: 'mcp', label: 'MCP' },
  ];

  function open() {
    if (overlay) {
      closeOverlay();
      return;
    }
    // PR-13 (Greptile P2) — remember who opened us so we can return
    // focus on close. Falls back gracefully if document.activeElement
    // is null or body (e.g. ⌘E from outside any focused element).
    triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay = el('div', {
      class: 'export-overlay',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'export-title' },
    });
    const card = el('div', { class: 'export-card' });

    const head = el('div', { class: 'export-head' });
    head.appendChild(
      el('h3', { class: 'export-title', text: 'Export', attrs: { id: 'export-title' } }),
    );
    const closeBtn = el('button', {
      class: 'export-close',
      text: '×',
      attrs: { type: 'button', 'aria-label': 'Close export popover', title: 'Close (Esc)' },
    });
    closeBtn.addEventListener('click', closeOverlay);
    head.appendChild(closeBtn);
    card.appendChild(head);

    const tabStrip = el('div', {
      class: 'export-tabs',
      attrs: { role: 'tablist', 'aria-label': 'Export format' },
    });
    for (const t of TABS) {
      // PR-13 (Greptile P2) — ARIA tab pattern: each tab has a stable
      // id and aria-controls pointing at the panel; arrow-key
      // navigation moves focus within the strip.
      const tabId = `export-tab-${t.key}`;
      const btn = el('button', {
        class: `export-tab${activeTabKey === t.key ? ' is-active' : ''}`,
        text: t.label,
        attrs: {
          type: 'button',
          role: 'tab',
          id: tabId,
          'aria-selected': activeTabKey === t.key ? 'true' : 'false',
          'aria-controls': 'export-body',
          'data-tab-key': t.key,
          // Roving tabindex — only the active tab is in the tab order.
          tabindex: activeTabKey === t.key ? '0' : '-1',
        },
      });
      btn.addEventListener('click', () => {
        activeTabKey = t.key;
        renderActiveTab();
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End')
          return;
        e.preventDefault();
        const idx = TABS.findIndex((x) => x.key === activeTabKey);
        let next;
        if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = TABS.length - 1;
        else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
        else next = (idx + 1) % TABS.length;
        activeTabKey = TABS[next].key;
        renderActiveTab();
        overlay?.querySelector(`.export-tab[data-tab-key="${activeTabKey}"]`)?.focus();
      });
      tabStrip.appendChild(btn);
    }
    card.appendChild(tabStrip);

    const body = el('div', {
      class: 'export-body',
      attrs: {
        id: 'export-body',
        role: 'tabpanel',
        'aria-labelledby': `export-tab-${activeTabKey}`,
        tabindex: '0',
      },
    });
    card.appendChild(body);
    overlay.appendChild(card);

    // Click outside closes.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay();
    });

    document.body.appendChild(overlay);
    releaseTrap = trapFocus(overlay);
    renderActiveTab();
    // Move focus into the popover for keyboard users — the active tab btn.
    overlay.querySelector('.export-tab.is-active')?.focus();
  }

  function closeOverlay() {
    releaseTrap?.();
    releaseTrap = null;
    overlay?.remove();
    overlay = null;
    // PR-13 (Greptile P2) — return focus to the trigger so Tab resumes
    // from the right place. Skip if the trigger has since been
    // removed from the DOM (e.g. persona switch tore down the topbar).
    if (triggerElement && document.body.contains(triggerElement)) {
      triggerElement.focus();
    }
    triggerElement = null;
  }

  function renderActiveTab() {
    if (!overlay) return;
    const body = overlay.querySelector('#export-body');
    body.replaceChildren();
    body.setAttribute('aria-labelledby', `export-tab-${activeTabKey}`);
    // Reflect tab selection in the strip — class for styling, aria-selected
    // for screen readers, roving tabindex for the ARIA tab pattern.
    for (const tab of overlay.querySelectorAll('.export-tab')) {
      const isActive = tab.dataset.tabKey === activeTabKey;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.setAttribute('tabindex', isActive ? '0' : '-1');
    }
    const snip = snippetForTab(activeTabKey);
    if (snip.isDownload) {
      body.appendChild(el('p', { class: 'export-note', text: snip.text }));
      const dl = el('button', {
        class: 'export-copy-btn',
        text: 'Download tarball',
        attrs: { type: 'button' },
      });
      dl.addEventListener('click', () => {
        exportTarball();
        track('export', { format: 'tarball' });
      });
      body.appendChild(dl);
      return;
    }
    const pre = el('pre', { class: `export-pre lang-${snip.lang}` });
    pre.appendChild(document.createTextNode(snip.text));
    body.appendChild(pre);

    const copyRow = el('div', { class: 'export-copy-row' });
    const copyBtn = el('button', {
      class: 'export-copy-btn',
      text: 'Copy',
      attrs: { type: 'button', 'aria-label': 'Copy snippet to clipboard' },
    });
    copyBtn.addEventListener('click', () => {
      copyToClipboard(
        snip.text,
        `${TABS.find((t) => t.key === activeTabKey)?.label ?? 'Snippet'} copied.`,
      );
      // Map tab key → existing analytics format allowlist where possible.
      // Permalink + Embed reuse the 'share' event; the rest fall under 'export'.
      if (activeTabKey === 'permalink') track('share', { kind: 'permalink' });
      else if (activeTabKey === 'embed') track('share', { kind: 'embed' });
      else track('export', { format: activeTabKey });
    });
    copyRow.appendChild(copyBtn);
    // Active-endpoint download shortcuts where available.
    if (activeTabKey === 'json') {
      const dl = el('button', {
        class: 'export-copy-btn export-copy-btn-secondary',
        text: 'Download .json',
        attrs: { type: 'button' },
      });
      dl.addEventListener('click', () => {
        exportActiveJson();
        track('export', { format: 'json' });
      });
      copyRow.appendChild(dl);
    } else if (activeTabKey === 'csv') {
      const dl = el('button', {
        class: 'export-copy-btn export-copy-btn-secondary',
        text: 'Download .csv',
        attrs: { type: 'button' },
      });
      dl.addEventListener('click', () => {
        exportActiveCsv();
        track('export', { format: 'csv' });
      });
      copyRow.appendChild(dl);
    }
    body.appendChild(copyRow);
  }

  // Esc routing is owned by app.js's global keydown handler via
  // exportPopover.isOpen + exportPopover.close() — see PR-13 (Greptile)
  // for why this module no longer ships its own handleKey export.
  return {
    open,
    close: closeOverlay,
    get isOpen() {
      return overlay !== null;
    },
  };
}

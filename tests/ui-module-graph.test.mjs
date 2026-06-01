// @vitest-environment jsdom
//
// Import-graph smoke test for the UI layer. The browser behaviour is covered
// by Playwright e2e, but this guards the refactor's main failure mode without
// a browser: a broken import path or a renamed export after consolidating the
// shared DOM helpers (src/shared/dom.js) and re-pointing app.js + the ui/*
// factory modules at it. Each factory module is imported (proving its whole
// transitive import graph resolves) and its create* export is asserted to be
// callable.

import { describe, it, expect } from 'vitest';

describe('UI module graph resolves after the shared/dom consolidation', () => {
  it('shared/dom exports the helper surface', async () => {
    const dom = await import('../src/shared/dom.js');
    for (const name of ['el', 'statusPill', 'syncViewTabs', 'trapFocus']) {
      expect(typeof dom[name], name).toBe('function');
    }
  });

  it('app/utils re-exports el from shared/dom', async () => {
    const utils = await import('../src/app/utils.js');
    const dom = await import('../src/shared/dom.js');
    expect(utils.el).toBe(dom.el);
  });

  it('every migrated ui/* factory module imports cleanly and exports its factory', async () => {
    const cases = [
      ['../src/ui/field-card.js', 'createFieldCard'],
      ['../src/ui/compare-view.js', 'createCompareView'],
      ['../src/ui/hover-preview.js', 'createHoverPreview'],
      ['../src/ui/insurance.js', 'createInsurance'],
      ['../src/ui/atm.js', 'createAtm'],
      ['../src/ui/tour.js', 'createTour'],
      ['../src/ui/find-box.js', 'createFindBox'],
      ['../src/ui/export-popover.js', 'createExportPopover'],
      ['../src/ui/persona-builder-ui.js', 'mountPersonaBuilder'],
    ];
    for (const [path, exportName] of cases) {
      const mod = await import(path);
      expect(typeof mod[exportName], `${path} → ${exportName}`).toBe('function');
    }
  });
});

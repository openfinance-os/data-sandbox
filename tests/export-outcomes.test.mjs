// @vitest-environment jsdom
// #117: analytics counts confirmed copies and download initiation, never attempts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextEncoder } from 'node:util';
import { el } from '../src/shared/dom.js';
import { copyToClipboard } from '../src/ui/clipboard.js';
import { createExportPopover } from '../src/ui/export-popover.js';
import {
  createActiveExports,
  downloadJson,
  downloadCsv,
  downloadTarball,
} from '../src/ui/export.js';

let popover;
beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue() },
    configurable: true,
  });
  document.execCommand = vi.fn().mockReturnValue(true);
});
afterEach(() => {
  popover?.close();
  popover = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openExport(overrides = {}) {
  const track = vi.fn();
  const deps = {
    state: { personaId: 'example', lfi: 'median', seed: 4729, endpoint: '/accounts', lang: 'en' },
    el,
    track,
    copyToClipboard,
    activeJsonString: () => '{"Data":{}}',
    activeCsvString: () => '# SYNTHETIC\nAccountId\na1\n',
    activeFixtureUrl: () => 'https://example.test/fixtures/accounts.json',
    embedIframeSnippet: () => '<iframe></iframe>',
    exportActiveJson: vi.fn(() => ({ status: 'download-initiated' })),
    exportActiveCsv: vi.fn(() => ({ status: 'download-initiated' })),
    exportTarball: vi.fn(() => ({ status: 'download-initiated' })),
    ...overrides,
  };
  popover = createExportPopover(deps);
  popover.open();
  return { track, deps };
}
function selectTab(key) {
  document.querySelector(`#export-tab-${key}`).click();
}
function copy() {
  document.querySelector('.export-copy-btn').click();
}

describe('export dialog focus restoration', () => {
  it('returns to an explicit trigger even when the clicked button did not receive focus', () => {
    openExport();
    popover.close();
    const trigger = el('button', { text: 'Export' });
    document.body.appendChild(trigger);
    document.activeElement?.blur();
    popover.open(trigger);
    expect(document.activeElement.classList.contains('export-tab')).toBe(true);
    popover.close();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores the keyboard caller and skips a trigger removed while open', () => {
    openExport();
    popover.close();
    const trigger = el('input');
    document.body.appendChild(trigger);
    trigger.focus();
    popover.open();
    popover.close();
    expect(document.activeElement).toBe(trigger);
    popover.open(trigger);
    trigger.remove();
    expect(() => popover.close()).not.toThrow();
    expect(document.querySelector('.export-overlay')).toBeNull();
  });
});

describe('clipboard completion', () => {
  it('does not report success before writeText resolves', async () => {
    let resolve;
    navigator.clipboard.writeText.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const pending = copyToClipboard('snippet', 'Copied');
    expect(document.querySelector('.copy-toast')).toBeNull();
    resolve();
    await expect(pending).resolves.toEqual({ status: 'confirmed-success', method: 'clipboard' });
  });

  it('handles a synchronous clipboard error with a confirmed fallback', async () => {
    navigator.clipboard.writeText.mockImplementation(() => {
      throw new Error('blocked');
    });
    await expect(copyToClipboard('snippet', 'Copied')).resolves.toEqual({
      status: 'confirmed-success',
      method: 'execCommand',
    });
  });

  it('treats false as manual-copy-pending, keeps selection, and allows dismissal', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('blocked'));
    document.execCommand.mockReturnValue(false);
    const trigger = el('button', { text: 'Copy' });
    document.body.appendChild(trigger);
    trigger.focus();
    await expect(copyToClipboard('manual text', 'Copied')).resolves.toEqual({
      status: 'manual-copy-pending',
      reason: 'copy-returned-false',
    });
    const textarea = document.querySelector('textarea');
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe('manual text'.length);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.getAttribute('aria-label')).toBeTruthy();
    expect(document.querySelector('.copy-toast').textContent).not.toContain('Copied');
    document.querySelector('.manual-copy-fallback button').click();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('replaces pending manual snippets and removes them after a successful retry', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand.mockReturnValue(false);
    await copyToClipboard('first', 'Copied');
    await copyToClipboard('second', 'Copied');
    expect(document.querySelectorAll('textarea')).toHaveLength(1);
    expect(document.querySelector('textarea').value).toBe('second');
    document.execCommand.mockReturnValue(true);
    await copyToClipboard('third', 'Copied');
    expect(document.querySelector('.manual-copy-fallback')).toBeNull();
  });

  it('fails without an available snippet or a connected fallback container', async () => {
    await expect(copyToClipboard('', 'Copied')).resolves.toEqual({
      status: 'failed',
      reason: 'unavailable',
    });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    navigator.clipboard.writeText.mockRejectedValue(new Error('blocked'));
    await expect(copyToClipboard('snippet', 'Copied', { container: el('div') })).resolves.toEqual({
      status: 'failed',
      reason: 'dismissed',
    });
    expect(document.execCommand).not.toHaveBeenCalled();
  });
});

describe('export/share event timing', () => {
  it('tracks the clicked tab only after completion even if the active tab changes', async () => {
    let resolve;
    navigator.clipboard.writeText.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { track } = openExport();
    copy();
    expect(track).not.toHaveBeenCalled();
    selectTab('npm');
    resolve();
    await vi.waitFor(() =>
      expect(track).toHaveBeenCalledExactlyOnceWith('share', { kind: 'permalink' }),
    );
  });

  it.each(['permalink', 'embed', 'json', 'csv', 'npm', 'python', 'curl', 'mcp'])(
    '%s emits the original allowlisted event/properties after a confirmed copy',
    async (key) => {
      const { track } = openExport();
      selectTab(key);
      copy();
      const expected =
        key === 'permalink' || key === 'embed'
          ? ['share', { kind: key }]
          : ['export', { format: key }];
      await vi.waitFor(() => expect(track).toHaveBeenCalledExactlyOnceWith(...expected));
    },
  );

  it('tracks a rejected clipboard write only after successful execCommand fallback', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('blocked'));
    const { track } = openExport();
    copy();
    expect(track).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(track).toHaveBeenCalledExactlyOnceWith('share', { kind: 'permalink' }),
    );
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it.each(['false', 'throw'])(
    'never tracks a %s fallback or a manual selection as success',
    async (failure) => {
      navigator.clipboard.writeText.mockRejectedValue(new Error('blocked'));
      document.execCommand.mockImplementation(() => {
        if (failure === 'throw') throw new Error('denied');
        return false;
      });
      const { track } = openExport();
      copy();
      await vi.waitFor(() => expect(document.querySelector('.manual-copy-fallback')).toBeTruthy());
      expect(document.querySelector('#export-body textarea')).toBeTruthy();
      expect(track).not.toHaveBeenCalled();
      document.querySelector('textarea').dispatchEvent(new Event('copy', { bubbles: true }));
      expect(track).not.toHaveBeenCalled();
    },
  );

  it.each(['json', 'csv'])('disables unavailable %s copy/download snippets', (key) => {
    const { track, deps } = openExport({ activeJsonString: () => '', activeCsvString: () => '' });
    selectTab(key);
    for (const button of document.querySelectorAll('.export-copy-btn')) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    expect(track).not.toHaveBeenCalled();
    expect(deps.exportActiveJson).not.toHaveBeenCalled();
    expect(deps.exportActiveCsv).not.toHaveBeenCalled();
  });

  it.each(['json', 'csv', 'tarball'])(
    '%s tracks download initiation after the action result',
    async (key) => {
      let resolve;
      const action = vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      const { track } = openExport({
        exportActiveJson: action,
        exportActiveCsv: action,
        exportTarball: action,
      });
      selectTab(key);
      document
        .querySelector(key === 'tarball' ? '.export-copy-btn' : '.export-copy-btn-secondary')
        .click();
      expect(track).not.toHaveBeenCalled();
      resolve({ status: 'download-initiated' });
      await vi.waitFor(() =>
        expect(track).toHaveBeenCalledExactlyOnceWith('export', { format: key }),
      );
    },
  );

  it.each(['unavailable', 'noop', 'throw'])('never tracks a %s download', async (failure) => {
    const action = () => {
      if (failure === 'throw') throw new Error('failed');
      return failure === 'noop' ? undefined : { status: 'failed', reason: 'unavailable' };
    };
    const { track } = openExport({ exportTarball: action });
    selectTab('tarball');
    copy();
    await vi.waitFor(() =>
      expect(document.querySelector('.copy-toast')?.textContent).toMatch(/could not start/),
    );
    expect(track).not.toHaveBeenCalled();
  });
});

describe('actual fixture download actions', () => {
  let click;
  const ctx = {
    personaId: 'example',
    lfi: 'median',
    seed: 4729,
    retrievedAt: '2026-10-08T00:00:00Z',
  };
  const bundle = { accounts: [], callingUserParty: {}, domain: 'banking' };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('TextEncoder', TextEncoder);
    const OriginalURL = URL;
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static createObjectURL = vi.fn(() => 'blob:https://example.test/fixture');
        static revokeObjectURL = vi.fn();
      },
    );
    click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it.each(['json', 'csv', 'tarball'])(
    '%s returns initiation after creating a blob and clicking, with cleanup',
    (key) => {
      const actions = createActiveExports({
        state: { ...ctx, bundle, endpoint: '/accounts' },
        exportContext: () => ctx,
      });
      const action = {
        json: actions.exportActiveJson,
        csv: actions.exportActiveCsv,
        tarball: actions.exportTarball,
      }[key];
      expect(action()).toEqual({ status: 'download-initiated' });
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      const blob = URL.createObjectURL.mock.calls[0][0];
      expect(blob.size).toBeGreaterThan(0);
      expect(click).toHaveBeenCalledTimes(1);
      expect(document.querySelector('a').download).toMatch(
        new RegExp(`\\.${key === 'tarball' ? 'tar' : key}$`),
      );
      vi.runOnlyPendingTimers();
      expect(document.querySelector('a')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://example.test/fixture');
    },
  );

  it('returns unavailable for missing bundles and endpoints without clicking', () => {
    const state = { ...ctx, bundle: null, endpoint: '/accounts' };
    const actions = createActiveExports({ state, exportContext: () => ctx });
    for (const action of [
      actions.exportActiveJson,
      actions.exportActiveCsv,
      actions.exportTarball,
    ]) {
      expect(action()).toMatchObject({ status: 'failed', reason: 'unavailable' });
    }
    state.bundle = bundle;
    state.endpoint = '/(overview)';
    expect(actions.exportActiveJson()).toMatchObject({ status: 'failed', reason: 'unavailable' });
    expect(actions.buildActiveCsvString()).toBe('');
    expect(actions.exportActiveCsv()).toMatchObject({ status: 'failed', reason: 'unavailable' });
    expect(click).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('does not report initiation when object URL creation fails', () => {
    URL.createObjectURL.mockImplementation(() => {
      throw new Error('failed');
    });
    expect(downloadCsv('csv', 'fixture.csv')).toMatchObject({ status: 'failed' });
    expect(click).not.toHaveBeenCalled();
  });

  it('cleans up immediately when anchor click throws', () => {
    click.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(downloadJson({ Data: {} }, 'fixture.json')).toMatchObject({ status: 'failed' });
    expect(document.querySelector('a')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('rejects missing content and serialization failures before download', () => {
    expect(downloadJson(null, 'fixture.json')).toMatchObject({ status: 'failed' });
    expect(downloadCsv('', 'fixture.csv')).toMatchObject({ status: 'failed' });
    expect(downloadTarball(null, ctx)).toMatchObject({ status: 'failed' });
    const circular = {};
    circular.self = circular;
    expect(downloadJson(circular, 'fixture.json')).toMatchObject({
      status: 'failed',
      reason: 'generation-failed',
    });
    expect(click).not.toHaveBeenCalled();
  });
});

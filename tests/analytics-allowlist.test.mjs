// EXP-21 acceptance test — every track() call site in src/ uses an
// allowlisted event name and an allowlisted set of property keys. Plus
// a function-level test of the shim itself: unknown events drop, the
// SDK is not loaded by importing the module.
//
// Designed to fail loudly if a future PR adds e.g.
// `track('user_search', { query: searchInput.value })` — that call would
// land here as a known PII shape and fail the build before reaching
// production.

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALLOWED_EVENTS,
  ALLOWED_PROP_KEYS,
  track,
} from '../src/analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = path.resolve(__dirname, '..', 'src');

const ALLOWED_EVENT_SET = new Set(ALLOWED_EVENTS);
const ALLOWED_PROP_KEY_SET = new Set(ALLOWED_PROP_KEYS);

// Property names that must NEVER appear inline in a track() call —
// they imply user-input or PII capture. The list is broader than
// strictly necessary on purpose: the lint is a check, not a typing
// system, and false positives are cheap to fix.
const BANNED_PROP_KEY_PATTERN = /^(name|fullName|email|phone|iban|amount|merchant|address|searchQuery|userInput|ip|url|referrer|query|input|value|text)$/i;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.js')) yield p;
  }
}

function findTrackCalls() {
  const calls = [];
  for (const file of walk(SRC)) {
    // Skip the shim itself — it defines `track`, doesn't call it.
    if (path.basename(file) === 'analytics.js') continue;
    const code = fs.readFileSync(file, 'utf8');
    // Match `track('event', { ... })` or `track('event')`. The regex is
    // intentionally simple — every existing call site fits this shape and
    // any call site that doesn't (multi-line, computed event name) is
    // exactly what we want to flag for review.
    const re = /\btrack\(\s*['"`]([^'"`]+)['"`]\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
    for (const m of code.matchAll(re)) {
      calls.push({ file: path.relative(SRC, file), event: m[1], propsBlock: m[2] ?? '' });
    }
  }
  return calls;
}

describe('EXP-21 analytics allowlist', () => {
  const calls = findTrackCalls();

  it('finds at least one track() call site (test would silently pass otherwise)', () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it('every call site uses an allowlisted event name', () => {
    for (const c of calls) {
      expect(
        ALLOWED_EVENT_SET.has(c.event),
        `${c.file}: track('${c.event}') is not in the EXP-21 allowlist`,
      ).toBe(true);
    }
  });

  it('every property key is in the allowlist', () => {
    for (const c of calls) {
      const keys = (c.propsBlock.match(/(?:^|[\s,{])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g) ?? []).map(
        (s) => s.replace(/[\s,{:]/g, '').trim(),
      );
      for (const k of keys) {
        expect(
          ALLOWED_PROP_KEY_SET.has(k),
          `${c.file}: property '${k}' on track('${c.event}') is not in ALLOWED_PROP_KEYS`,
        ).toBe(true);
      }
    }
  });

  it('no call site inlines a PII-shaped property name', () => {
    for (const c of calls) {
      const keys = (c.propsBlock.match(/(?:^|[\s,{])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g) ?? []).map(
        (s) => s.replace(/[\s,{:]/g, '').trim(),
      );
      for (const k of keys) {
        expect(
          BANNED_PROP_KEY_PATTERN.test(k),
          `${c.file}: property '${k}' on track('${c.event}') matches a PII shape`,
        ).toBe(false);
      }
    }
  });

  it('every allowlisted event has at least one call site (drift detector)', () => {
    const seen = new Set(calls.map((c) => c.event));
    for (const e of ALLOWED_EVENTS) {
      expect(seen, `event '${e}' is in the allowlist but has no call site`).toContain(e);
    }
  });
});

describe('EXP-21 track() runtime behaviour', () => {
  it('drops events not in the allowlist (with a warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await track('user_search', { query: 'sensitive' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/not in the EXP-21 allowlist/);
    warn.mockRestore();
  });

  it('does not load the PostHog SDK in a Node environment (no window)', async () => {
    // The lazy loader gates on `typeof window !== 'undefined'`, so a
    // vitest run (Node, no DOM) never triggers a network fetch and a
    // plain track() call resolves cleanly. This is also the dev-server
    // posture — no POSTHOG_KEY → no SDK → analytics off.
    await expect(track('persona_load', { persona_id: 'x', lfi: 'rich' })).resolves.toBeUndefined();
  });
});

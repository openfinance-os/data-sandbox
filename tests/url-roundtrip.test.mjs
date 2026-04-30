import { describe, it, expect } from 'vitest';
import { encodePermalink, encodeEmbed, encodeFixtureUrl, decodeFromUrl, DEFAULTS } from '../src/url.js';

describe('URL shapes — §6.8', () => {
  it('persona permalink encodes persona+lfi+seed', () => {
    const url = encodePermalink({ personaId: 'salaried_expat_mid', lfi: 'median', seed: 4729 });
    expect(url).toBe('/commons/sandbox/p/salaried_expat_mid?lfi=median&seed=4729');
  });

  it('persona permalink → decode round-trips', () => {
    const url = encodePermalink({ personaId: 'salaried_expat_mid', lfi: 'median', seed: 4729 });
    const state = decodeFromUrl(url);
    expect(state.personaId).toBe('salaried_expat_mid');
    expect(state.lfi).toBe('median');
    expect(state.seed).toBe(4729);
  });

  it('embed URL encodes all five params', () => {
    const url = encodeEmbed({
      personaId: 'sara',
      lfi: 'sparse',
      endpoint: '/accounts/{AccountId}/transactions',
      seed: 1,
      height: 600,
    });
    expect(url).toContain('persona=sara');
    expect(url).toContain('lfi=sparse');
    expect(url).toContain('endpoint=');
    expect(url).toContain('seed=1');
    expect(url).toContain('height=600');
  });

  it('decode applies safe defaults for missing/invalid lfi & seed', () => {
    const state = decodeFromUrl('/commons/sandbox/p/sara');
    expect(state.lfi).toBe(DEFAULTS.lfi); // median
    expect(state.seed).toBe(DEFAULTS.seed); // 1
  });

  it('decode normalises an unknown lfi to median', () => {
    const state = decodeFromUrl('/commons/sandbox/p/sara?lfi=GOLDEN&seed=5');
    expect(state.lfi).toBe('median');
    expect(state.seed).toBe(5);
  });

  it('decode handles embed-shape URLs', () => {
    const state = decodeFromUrl('/embed?persona=sara&lfi=rich&seed=12&endpoint=/parties&height=400');
    expect(state.personaId).toBe('sara');
    expect(state.lfi).toBe('rich');
    expect(state.seed).toBe(12);
    expect(state.endpoint).toBe('/parties');
    expect(state.height).toBe(400);
  });

  // EXP-28 — the raw-fixture URL pattern TPP integrations use to fetch
  // sandbox payloads over plain HTTPS (Postman, curl, mobile clients).
  it('encodeFixtureUrl mirrors the on-disk path for templated endpoints', () => {
    const url = encodeFixtureUrl({
      origin: 'https://openfinance-os.org',
      personaId: 'salaried_expat_mid',
      lfi: 'median',
      seed: 4729,
      endpoint: '/accounts/{AccountId}/transactions',
    });
    expect(url).toBe('https://openfinance-os.org/fixtures/v1/bundles/salaried_expat_mid/median/seed-4729/accounts__AccountId__transactions.json');
  });

  it('encodeFixtureUrl handles bundle-level endpoints', () => {
    const url = encodeFixtureUrl({
      origin: 'https://openfinance-os.org',
      personaId: 'hnw_multicurrency',
      lfi: 'rich',
      seed: 2046,
      endpoint: '/accounts',
    });
    expect(url).toBe('https://openfinance-os.org/fixtures/v1/bundles/hnw_multicurrency/rich/seed-2046/accounts.json');
  });

  it('encodeFixtureUrl falls back to /accounts when endpoint omitted', () => {
    const url = encodeFixtureUrl({
      origin: '',
      personaId: 'sara',
      lfi: 'sparse',
      seed: 1,
    });
    expect(url).toBe('/fixtures/v1/bundles/sara/sparse/seed-1/accounts.json');
  });

  // Slice 8 — multi-domain URL state. Banking is the default and stays
  // implicit so existing permalinks remain unchanged; insurance only
  // surfaces when ?preview=1 is set.
  it('decode defaults domain to banking and preview to false', () => {
    const state = decodeFromUrl('/commons/sandbox/p/sara');
    expect(state.domain).toBe('banking');
    expect(state.preview).toBe(false);
  });

  it('decode reads ?domain= and ?preview=1', () => {
    const state = decodeFromUrl(
      '/commons/sandbox/p/motor_comprehensive_mid?lfi=median&seed=4729&domain=insurance&preview=1'
    );
    expect(state.domain).toBe('insurance');
    expect(state.preview).toBe(true);
    expect(state.personaId).toBe('motor_comprehensive_mid');
  });

  it('decode normalises an unknown domain to banking', () => {
    const state = decodeFromUrl('/commons/sandbox/p/sara?domain=open-wealth');
    expect(state.domain).toBe('banking');
  });

  it('encodePermalink omits domain when banking (default)', () => {
    const url = encodePermalink({ personaId: 'salaried_expat_mid', lfi: 'median', seed: 4729 });
    expect(url).not.toContain('domain=');
    expect(url).not.toContain('preview=');
  });

  it('encodePermalink emits domain + preview for insurance', () => {
    const url = encodePermalink({
      personaId: 'motor_comprehensive_mid',
      lfi: 'median',
      seed: 4729,
      domain: 'insurance',
      preview: true,
    });
    expect(url).toContain('domain=insurance');
    expect(url).toContain('preview=1');
  });

  it('encodeEmbed emits domain + preview for insurance', () => {
    const url = encodeEmbed({
      personaId: 'motor_comprehensive_mid',
      lfi: 'rich',
      seed: 4729,
      endpoint: '/motor-insurance-policies',
      domain: 'insurance',
      preview: true,
    });
    expect(url).toContain('domain=insurance');
    expect(url).toContain('preview=1');
    expect(url).toContain('endpoint=');
  });
});

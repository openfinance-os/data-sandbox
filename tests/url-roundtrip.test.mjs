import { describe, it, expect } from 'vitest';
import { encodePermalink, encodeEmbed, decodeFromUrl, DEFAULTS } from '../src/url.js';

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
});

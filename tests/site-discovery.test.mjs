import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { discoveryFiles, ORIGIN, GUIDE_PATH } from '../tools/site-discovery.mjs';

const guide = fs.readFileSync(new URL('../src/integrate.html', import.meta.url), 'utf8');
const files = discoveryFiles(guide);

describe('production discovery contract', () => {
  it('lists only the existing indexable guide with its absolute canonical', () => {
    const urls = [...files['sitemap.xml'].matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(urls).toEqual([ORIGIN + GUIDE_PATH]);
    expect(files['sitemap.xml']).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(guide).toContain(`rel="canonical" href="${urls[0]}"`);
  });

  it('keeps the explorer and its redirect noindex', () => {
    expect(files['index.html']).toContain('name="robots" content="noindex"');
    expect(files['index.html']).toContain(`href="${ORIGIN}/src/index.html"`);
    expect(files['index.html']).toContain('content="0; url=src/index.html"');
    expect(fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8')).toContain(
      'name="robots" content="noindex"',
    );
    expect(files['sitemap.xml']).not.toMatch(/src\/index.html|fixtures|labs|connect|embed/);
    expect(files).not.toHaveProperty('robots.txt');
  });

  it('repairs the public guide link without duplicating contents', () => {
    expect(files['integrate.html']).toContain(`content="0; url=${GUIDE_PATH.slice(1)}"`);
    expect(files['integrate.html']).toContain(`href="${ORIGIN}${GUIDE_PATH}"`);
  });

  it('fails closed when guide indexing policy changes', () => {
    for (const meta of [
      '<meta name="robots" content="noindex">',
      '<meta content="noindex, follow" name="robots">',
    ]) {
      expect(() => discoveryFiles(meta + guide)).toThrow(/noindex/);
    }
  });
});

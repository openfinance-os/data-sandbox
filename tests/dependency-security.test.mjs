import { createRequire } from 'node:module';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const eslintRequire = createRequire(require.resolve('eslint'));
const configArrayRequire = createRequire(require.resolve('@eslint/config-array'));

describe('patched minimatch compatibility', () => {
  for (const [consumer, load] of [
    ['eslint', eslintRequire],
    ['@eslint/config-array', configArrayRequire],
  ]) {
    it(`${consumer} retains the matching APIs used for lint discovery`, () => {
      const { Minimatch } = load('minimatch');
      const pattern = 'src/**/*.{js,mjs,cjs}';
      const matcher = new Minimatch(pattern, { dot: true });
      expect(matcher.pattern).toBe(pattern);
      expect(matcher.match('src/analytics.js')).toBe(true);
      expect(matcher.match('src/nested/module.mjs')).toBe(true);
      expect(matcher.match('src/.hidden/module.cjs')).toBe(true);
      expect(matcher.match('src/nested', true)).toBe(true);
      expect(matcher.match('tools/nested', true)).toBe(false);
      expect(matcher.match('src/styles.css')).toBe(false);
      const negated = new Minimatch('!src/vendor/**', { dot: true, flipNegate: true });
      expect(negated.match('src/vendor/sdk.js')).toBe(true);
      expect(negated.match('src/analytics.js')).toBe(false);
    });
  }

  it('keeps source linting active and generated output ignored', async () => {
    const eslint = new ESLint();
    for (const file of [
      'src/analytics.js',
      'tools/stage-site.mjs',
      'tests/e2e/analytics.spec.mjs',
    ]) {
      expect(await eslint.isPathIgnored(path.resolve(file))).toBe(false);
      expect(await eslint.calculateConfigForFile(file)).toBeDefined();
    }
    for (const file of ['dist/generated.js', '_site/src/analytics.js', 'src/vendor/sdk.js']) {
      expect(await eslint.isPathIgnored(path.resolve(file))).toBe(true);
    }
    const sourceConfig = await eslint.calculateConfigForFile('src/analytics.js');
    expect(sourceConfig.rules['no-unused-vars'][0]).toBe(2);
  });
});

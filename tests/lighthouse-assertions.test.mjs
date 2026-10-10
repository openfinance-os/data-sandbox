import { describe, expect, it } from 'vitest';
import { evaluateAssertions } from '../tools/lighthouse-assertions.mjs';

const report = (score, fcp = 2000) => ({
  categories: { performance: { score } },
  audits: { 'first-contentful-paint': { numericValue: fcp } },
});
const assertions = {
  'categories:performance': ['error', { minScore: 0.6 }],
  'first-contentful-paint': ['warn', { maxNumericValue: 2500 }],
};

describe('Lighthouse gate migration', () => {
  it('preserves optimistic three-run performance and timing gates', () => {
    const result = evaluateAssertions(
      [report(0.39, 3100), report(0.58, 2600), report(0.62)],
      assertions,
    );
    expect(result.map(({ actual, passed }) => ({ actual, passed }))).toEqual([
      { actual: 0.62, passed: true },
      { actual: 2000, passed: true },
    ]);
  });
  it('rejects three runs below the unchanged performance threshold', () => {
    expect(
      evaluateAssertions([report(0.59), report(0.5), report(0.58)], assertions)[0].passed,
    ).toBe(false);
  });
  it.each([null, NaN, undefined])('fails a missing or invalid category score (%s)', (score) => {
    expect(evaluateAssertions([report(0.8), report(score)], assertions)[0].passed).toBe(false);
  });
  it('rejects an empty or unsuccessful collection', () => {
    expect(() => evaluateAssertions([], assertions)).toThrow('No Lighthouse reports');
    expect(() =>
      evaluateAssertions([{ runtimeError: { message: 'Load failed' } }], assertions),
    ).toThrow();
  });
  it('keeps warning violations separate from gate errors', () => {
    const result = evaluateAssertions([report(0.8, 3000)], assertions);
    expect(result[0].passed).toBe(true);
    expect(result[1]).toMatchObject({ level: 'warn', passed: false });
  });
});

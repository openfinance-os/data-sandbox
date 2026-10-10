// Keep the existing Lighthouse CI optimistic (best-of-runs) assertion contract.
// Missing/null/error results must never become a successful gate.
export function evaluateAssertions(reports, assertions) {
  if (!reports.length) throw new Error('No Lighthouse reports');
  if (reports.some((report) => report.runtimeError))
    throw new Error('Lighthouse returned a runtime error');
  return Object.entries(assertions).flatMap(([id, assertion]) => {
    const [level, options = {}] = Array.isArray(assertion) ? assertion : [assertion];
    if (level === 'off') return [];
    if (!['error', 'warn'].includes(level)) throw new Error(`Unknown assertion level: ${level}`);
    if (options.aggregationMethod && options.aggregationMethod !== 'optimistic')
      throw new Error(`Unsupported aggregation: ${options.aggregationMethod}`);
    const isCategory = id.startsWith('categories:');
    const values = reports.map((report) => {
      const result = isCategory ? report.categories?.[id.slice(11)] : report.audits?.[id];
      const value = options.maxNumericValue === undefined ? result?.score : result?.numericValue;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    });
    const complete = values.every((value) => value !== null);
    const actual = complete
      ? options.maxNumericValue === undefined
        ? Math.max(...values)
        : Math.min(...values)
      : null;
    const passed =
      complete &&
      (options.minScore === undefined || actual >= options.minScore) &&
      (options.maxNumericValue === undefined || actual <= options.maxNumericValue);
    if (options.minScore === undefined && options.maxNumericValue === undefined)
      throw new Error(`No threshold configured for ${id}`);
    return [{ id, level, values, actual, passed, options }];
  });
}

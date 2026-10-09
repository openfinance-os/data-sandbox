// An explicit corpus clock; schema retrieval dates never move generated data.
export const CORPUS_VERSION = '0.1.0';
export const REFERENCE_DATE = '2026-05-01T00:00:00.000Z';
export const GENERATOR_VERSION = '2';

export function scenarioDescriptor({
  personaId,
  recipeHash = null,
  role = 'primary',
  lfi,
  seed,
  referenceDate = REFERENCE_DATE,
  specProvenance = null,
}) {
  if (!personaId || !['rich', 'median', 'sparse'].includes(lfi) || !Number.isSafeInteger(seed))
    throw new Error('Invalid scenario identity');
  if (!Number.isFinite(Date.parse(referenceDate))) throw new Error('Invalid reference date');
  return {
    corpusVersion: CORPUS_VERSION,
    generatorVersion: GENERATOR_VERSION,
    personaId,
    recipeHash,
    role,
    lfi,
    seed,
    referenceDate: new Date(referenceDate).toISOString(),
    specProvenance,
  };
}

export const scenarioKey = (scenario) => JSON.stringify(scenario);

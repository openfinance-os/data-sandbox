// Watermark generator — §6.5 / EXP-19.
// Every CSV/JSON/tarball export carries this signature so leaked artefacts
// are immediately recognisable as synthetic.

export function watermark({ personaId, lfi, seed, retrievedAt = new Date().toISOString() }) {
  return (
    'SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · ' +
    `persona:${personaId} lfi:${lfi} seed:${seed} retrieved:${retrievedAt}`
  );
}

export function watermarkJsonEnvelope(bundle, ctx) {
  return {
    _watermark: watermark(ctx),
    _persona: ctx.personaId,
    _lfi: ctx.lfi,
    _seed: ctx.seed,
    _specVersion: ctx.specVersion ?? null,
    _specSha: ctx.specSha ?? null,
    _retrievedAt: ctx.retrievedAt ?? new Date().toISOString(),
    payload: bundle,
  };
}

export function watermarkCsvHeader(ctx) {
  return `# ${watermark(ctx)}`;
}

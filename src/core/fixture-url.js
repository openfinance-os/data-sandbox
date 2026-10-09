// App modules live in src/; fixture storage lives next to src/, including
// when the staged site is hosted below a path prefix.
export function deploymentBase(moduleUrl = import.meta.url) {
  return new URL('../../', moduleUrl).href.replace(/\/$/, '');
}

export function publishedScenario(manifest, { personaId, lfi, seed, role = 'primary' }) {
  if (manifest?.published)
    return manifest.published[personaId]?.includes(`${role}|${lfi}|${seed}`) ? true : null;
  const key =
    role === 'primary' ? `${personaId}|${lfi}|${seed}` : `${personaId}|${role}|${lfi}|${seed}`;
  return (role === 'primary' ? manifest?.fixtures : manifest?.roleFixtures)?.[key] ?? null;
}

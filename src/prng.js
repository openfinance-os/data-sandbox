// Deterministic seeded PRNG — EXP-05.
// mulberry32 produces a 32-bit pseudo-random uint stream from a uint32 seed.
// `seedFromTuple` mixes (persona_id, lfi_profile, seed) into a single uint32 so
// the same tuple always yields the same generator state — across machines,
// across browser cache clears, across cold-start Node processes.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit string hash. Tiny, deterministic, no deps.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedFromTuple(personaId, lfiProfile, seed) {
  // Combine via FNV-mixed string then XOR with the user-visible seed so flipping
  // any single field changes every PRNG output.
  const tag = `${personaId}|${lfiProfile}|${seed}`;
  return (fnv1a(tag) ^ ((seed | 0) * 0x9e3779b1)) >>> 0;
}

// Convenience wrappers used throughout the generator.
export function makePrng(personaId, lfiProfile, seed) {
  return mulberry32(seedFromTuple(personaId, lfiProfile, seed));
}

export function rngInt(rng, minInclusive, maxExclusive) {
  return Math.floor(rng() * (maxExclusive - minInclusive)) + minInclusive;
}

export function rngPick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function rngBool(rng, probability) {
  return rng() < probability;
}

// Shuffle a copy of the array in place using Fisher-Yates with `rng`.
export function rngShuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

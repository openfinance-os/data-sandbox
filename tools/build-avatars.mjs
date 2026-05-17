#!/usr/bin/env node
// Build-time avatar generator — emits dist/avatars.json mapping
// persona_id → an inline SVG string. Two flavours:
//   - retail / individual personas → cartoon face (skin tone keyed off
//     nationality_pool, hair length deterministic from persona_id, senior
//     personas get grey hair, joint personas get two heads).
//   - SME / corporate personas → archetype glyph card (shop, hard hat,
//     stethoscope, package, laptop, container, cash register, skyline).
// Everything is deterministic from the persona manifest — no external
// network calls, no binary assets, ~1–2 KB per persona, well under the
// EXP-24 perf budget. The generator runs purely off persona YAML so it
// does not violate EXP-01 (avatars are presentation chrome, not field
// metadata) or NG4/NG5 (no real names, no institution-bound claims).

import fs from 'node:fs';
import path from 'node:path';
import { loadAllPersonas, repoRoot } from './load-fixtures.mjs';

const OUT = `${repoRoot}/dist/avatars.json`;

// ---- helpers ----------------------------------------------------------

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(arr, seed) {
  // `>>> 0` coerces to uint32 so the modulo never lands on a negative
  // index when callers pass a derived/shifted seed.
  return arr[(seed >>> 0) % arr.length];
}

function initials(name) {
  // Strip the " — <archetype description>" tail; the leading token is
  // either a single first name (retail) or an LLC-style entity name.
  const head = name.split(/\s+[—–-]\s+/)[0].trim();
  // Joint personas read "Maria & Rohan" — collapse to "M&R".
  if (head.includes('&')) {
    return head
      .split('&')
      .map((s) => s.trim()[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('&');
  }
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function svg(width, height, body) {
  // viewBox + preserveAspectRatio so it scales cleanly at any container
  // size. role=img + aria-label set per persona by the caller via wrapper.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body}</svg>`
  );
}

// ---- palettes ---------------------------------------------------------

// Six deterministic background colors — soft, UAE-warm. Picked to read
// well against both light and dark UI chrome.
const BG_PALETTE = [
  { bg: '#F4E0C7', accent: '#B8814A' }, // sand
  { bg: '#E2EAD8', accent: '#5C7A4F' }, // sage
  { bg: '#DBE5EE', accent: '#3F6483' }, // sky
  { bg: '#EFD9DC', accent: '#A95464' }, // rose
  { bg: '#E6DDEC', accent: '#6E548F' }, // lilac
  { bg: '#F1E5C2', accent: '#8A6B1F' }, // ochre
];

const SKIN_BY_POOL = {
  emirati: '#D4A574',
  expat_arab: '#C99A6E',
  expat_indian: '#B98259',
  // Sensible default if a future pool slips through.
  default: '#C99A6E',
};

const HAIR_GREY = '#9C9C9C';
const HAIR_DARK = '#2B2522';
const SHIRT_COLORS = ['#3F6483', '#5C7A4F', '#A95464', '#6E548F', '#8A6B1F'];

// ---- gender heuristic -------------------------------------------------

// The narratives use a small set of named personas. We only need a hint
// to drive the hair-length default; the heuristic is a closed list, not
// open NLP, so it stays robust.
const FEMALE_FIRST_NAMES = new Set([
  'sara', 'aisha', 'layla', 'maria', 'priya', 'tanvi',
]);

function genderHint(name) {
  const head = name.split(/\s+[—–-]\s+/)[0].trim();
  if (head.includes('&')) return 'joint';
  const first = head.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (FEMALE_FIRST_NAMES.has(first)) return 'female';
  return 'male';
}

// ---- face generator ---------------------------------------------------

function faceAvatar(persona) {
  const seed = hashStr(persona.persona_id);
  const palette = pick(BG_PALETTE, seed);
  const skin =
    SKIN_BY_POOL[persona.demographics?.nationality_pool] ?? SKIN_BY_POOL.default;
  const isSenior =
    persona.archetype === 'senior_retiree' ||
    /6[0-9]-/.test(persona.demographics?.age_band ?? '');
  const hairColor = isSenior ? HAIR_GREY : HAIR_DARK;
  const gender = genderHint(persona.name);
  const shirt = pick(SHIRT_COLORS, seed >> 3);

  if (gender === 'joint') {
    // Two heads, offset. Shared shoulders behind.
    return svg(
      120, 120,
      `<rect width="120" height="120" fill="${palette.bg}"/>` +
      // Shoulders
      `<path d="M0 120 Q60 70 120 120 Z" fill="${shirt}"/>` +
      // Head A (left, female default)
      `<circle cx="42" cy="56" r="20" fill="${skin}"/>` +
      `<path d="M22 56 Q22 32 42 32 Q62 32 62 56 L62 64 Q60 50 42 50 Q24 50 22 64 Z" fill="${hairColor}"/>` +
      // Head B (right, male default)
      `<circle cx="82" cy="60" r="20" fill="${skin}"/>` +
      `<path d="M62 50 Q72 38 82 40 Q92 38 102 50 Q100 46 82 46 Q64 46 62 50 Z" fill="${hairColor}"/>`
    );
  }

  // Single-head face — Layered: bg, neck, shoulders/shirt, head, hair,
  // eyes, mouth. Glyph-free, soft, friendly.
  const hairPath =
    gender === 'female'
      // Longer hair, frames the face on both sides.
      ? `<path d="M28 60 Q28 28 60 28 Q92 28 92 60 L92 78 Q88 56 60 56 Q32 56 28 78 Z" fill="${hairColor}"/>`
      // Short top + temple line.
      : `<path d="M30 56 Q34 30 60 30 Q86 30 90 56 Q86 46 60 46 Q34 46 30 56 Z" fill="${hairColor}"/>`;

  return svg(
    120, 120,
    `<rect width="120" height="120" fill="${palette.bg}"/>` +
    // Shoulders / shirt
    `<path d="M0 120 Q60 78 120 120 Z" fill="${shirt}"/>` +
    // Neck
    `<rect x="52" y="78" width="16" height="14" fill="${skin}"/>` +
    // Head
    `<circle cx="60" cy="60" r="26" fill="${skin}"/>` +
    // Hair
    hairPath +
    // Eyes
    `<circle cx="51" cy="62" r="2.2" fill="#1B1B1B"/>` +
    `<circle cx="69" cy="62" r="2.2" fill="#1B1B1B"/>` +
    // Mouth — soft smile
    `<path d="M53 72 Q60 77 67 72" stroke="#5A3A2B" stroke-width="1.6" stroke-linecap="round" fill="none"/>`
  );
}

// ---- glyph generator (SME / corporate) --------------------------------

// Each glyph is a 120×120 SVG body returning a small motif centred in
// the card. Stroke-based so they read at any size.
const GLYPHS = {
  // F&B — coffee cup with steam
  fnb: (a) =>
    `<path d="M36 56 H78 V82 Q78 92 68 92 H46 Q36 92 36 82 Z" fill="${a}"/>` +
    `<path d="M78 62 Q92 62 92 72 Q92 82 78 82" stroke="${a}" stroke-width="4" fill="none"/>` +
    `<path d="M48 36 Q52 44 48 50" stroke="${a}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<path d="M60 32 Q64 42 60 50" stroke="${a}" stroke-width="3" fill="none" stroke-linecap="round"/>` +
    `<path d="M72 36 Q76 44 72 50" stroke="${a}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  // Construction — hard hat
  construction: (a) =>
    `<path d="M30 78 Q30 50 60 50 Q90 50 90 78 Z" fill="${a}"/>` +
    `<rect x="26" y="78" width="68" height="8" rx="2" fill="${a}"/>` +
    `<rect x="56" y="40" width="8" height="14" rx="2" fill="${a}"/>`,
  // Clinic — caduceus-lite (cross + heart)
  clinic: (a) =>
    `<path d="M60 36 C 78 38 86 52 76 66 L 60 88 L 44 66 C 34 52 42 38 60 36 Z" fill="${a}"/>` +
    `<rect x="56" y="50" width="8" height="22" fill="#fff"/>` +
    `<rect x="49" y="57" width="22" height="8" fill="#fff"/>`,
  // E-commerce — package box
  ecommerce: (a) =>
    `<path d="M32 50 L60 38 L88 50 L88 86 L60 98 L32 86 Z" fill="${a}"/>` +
    `<path d="M32 50 L60 62 L88 50" stroke="#fff" stroke-width="2.5" fill="none"/>` +
    `<path d="M60 62 V98" stroke="#fff" stroke-width="2.5"/>` +
    `<path d="M46 44 L74 56" stroke="#fff" stroke-width="2.5"/>`,
  // SaaS — laptop
  saas: (a) =>
    `<rect x="32" y="46" width="56" height="34" rx="3" fill="${a}"/>` +
    `<rect x="38" y="52" width="44" height="22" rx="2" fill="#fff"/>` +
    `<rect x="26" y="80" width="68" height="6" rx="3" fill="${a}"/>` +
    `<rect x="46" y="58" width="28" height="3" fill="${a}" opacity="0.5"/>` +
    `<rect x="46" y="64" width="20" height="3" fill="${a}" opacity="0.5"/>`,
  // Trading — shipping container
  trading: (a) =>
    `<rect x="26" y="50" width="68" height="36" rx="2" fill="${a}"/>` +
    `<rect x="32" y="56" width="4" height="24" fill="#fff" opacity="0.6"/>` +
    `<rect x="40" y="56" width="4" height="24" fill="#fff" opacity="0.6"/>` +
    `<rect x="48" y="56" width="4" height="24" fill="#fff" opacity="0.6"/>` +
    `<rect x="56" y="56" width="4" height="24" fill="#fff" opacity="0.6"/>` +
    `<rect x="64" y="56" width="4" height="24" fill="#fff" opacity="0.6"/>` +
    `<rect x="72" y="56" width="4" height="24" fill="#fff" opacity="0.6"/>` +
    `<rect x="80" y="56" width="4" height="24" fill="#fff" opacity="0.6"/>`,
  // Cash-heavy — banknote stack
  cash: (a) =>
    `<rect x="28" y="56" width="64" height="32" rx="3" fill="${a}"/>` +
    `<circle cx="60" cy="72" r="8" fill="#fff"/>` +
    `<text x="60" y="76" text-anchor="middle" font-family="system-ui, sans-serif" font-size="10" font-weight="700" fill="${a}">د.إ</text>` +
    `<rect x="32" y="48" width="56" height="6" rx="2" fill="${a}" opacity="0.6"/>` +
    `<rect x="36" y="42" width="48" height="4" rx="2" fill="${a}" opacity="0.4"/>`,
  // Corporate — skyline of three towers
  corporate: (a) =>
    `<rect x="30" y="58" width="16" height="34" fill="${a}"/>` +
    `<rect x="52" y="42" width="16" height="50" fill="${a}"/>` +
    `<rect x="74" y="50" width="16" height="42" fill="${a}"/>` +
    `<rect x="34" y="64" width="3" height="3" fill="#fff"/>` +
    `<rect x="40" y="64" width="3" height="3" fill="#fff"/>` +
    `<rect x="56" y="48" width="3" height="3" fill="#fff"/>` +
    `<rect x="62" y="48" width="3" height="3" fill="#fff"/>` +
    `<rect x="56" y="58" width="3" height="3" fill="#fff"/>` +
    `<rect x="62" y="58" width="3" height="3" fill="#fff"/>` +
    `<rect x="78" y="56" width="3" height="3" fill="#fff"/>` +
    `<rect x="84" y="56" width="3" height="3" fill="#fff"/>`,
};

const ARCHETYPE_TO_GLYPH = {
  sme_fnb: 'fnb',
  sme_construction: 'construction',
  sme_clinic: 'clinic',
  sme_ecommerce: 'ecommerce',
  sme_saas: 'saas',
  sme_trading_emirati: 'trading',
  sme_cash: 'cash',
  sme_business: 'trading',
  corporate_treasury: 'corporate',
};

function glyphAvatar(persona, glyphKey) {
  const seed = hashStr(persona.persona_id);
  const palette = pick(BG_PALETTE, seed);
  const glyph = GLYPHS[glyphKey](palette.accent);
  return svg(
    120, 120,
    `<rect width="120" height="120" fill="${palette.bg}"/>` + glyph
  );
}

// ---- dispatch ---------------------------------------------------------

function avatarFor(persona) {
  const glyphKey = ARCHETYPE_TO_GLYPH[persona.archetype];
  if (glyphKey) {
    return { svg: glyphAvatar(persona, glyphKey), initials: initials(persona.name), kind: 'glyph' };
  }
  return { svg: faceAvatar(persona), initials: initials(persona.name), kind: 'face' };
}

// ---- main -------------------------------------------------------------

const personas = loadAllPersonas();
const avatars = {};
let totalBytes = 0;
for (const [id, p] of Object.entries(personas)) {
  const a = avatarFor(p);
  avatars[id] = a;
  totalBytes += a.svg.length;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ avatars }));
const count = Object.keys(avatars).length;
console.log(
  `built ${count} avatars → ${path.relative(repoRoot, OUT)} ` +
    `(avg ${(totalBytes / count).toFixed(0)} B/svg, total ${(totalBytes / 1024).toFixed(1)} KB)`
);

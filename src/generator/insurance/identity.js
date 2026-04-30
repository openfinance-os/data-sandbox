// Insurance identity helpers — Phase 2.0 Motor MVP.
// Synthesizes PolicyHolder + Identity (EmiratesId, Visa) sub-objects from the
// persona's demographics + the synthetic-identity-pool. All output is shaped
// to match the v2.1-errata1 Motor schema's mandatory + format constraints
// (UUID, ISO date, E.164 mobile, 3-letter nationality code, 2-letter country,
// Emirates ID dashed pattern, Visa digits-only).

import { drawName } from '../identity.js';

// nationality_pool → ISO 3166-1 alpha-3 country code for Nationality field.
// Picks a single representative country per pool (the spec only takes one).
const NATIONALITY_BY_POOL = {
  emirati: 'ARE',
  expat_arab: 'EGY',
  expat_indian: 'IND',
};

export function isoDate(now, offsetDays) {
  const d = new Date(now.getTime() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export function genUuid(rng) {
  const hex = () => Math.floor(rng() * 16).toString(16);
  let id = '';
  for (let i = 0; i < 8; i++) id += hex();
  id += '-';
  for (let i = 0; i < 4; i++) id += hex();
  id += '-4'; // version 4
  for (let i = 0; i < 3; i++) id += hex();
  id += '-';
  id += '89ab'[Math.floor(rng() * 4)];
  for (let i = 0; i < 3; i++) id += hex();
  id += '-';
  for (let i = 0; i < 12; i++) id += hex();
  return id;
}

function genEmiratesId(rng) {
  // Pattern: ^784-?[0-9]{4}-?[0-9]{7}-?[0-9]$ — emit dashed form.
  const year = 1960 + Math.floor(rng() * 50);
  const seq = Math.floor(rng() * 9_999_999);
  const check = Math.floor(rng() * 10);
  return `784-${year}-${String(seq).padStart(7, '0')}-${check}`;
}

function genMobileNumber(rng) {
  // E.164: +9715XXXXXXXX (UAE mobile prefix is 5).
  const digits = Math.floor(rng() * 100_000_000);
  return `+9715${String(digits).padStart(8, '0')}`;
}

function genVisaNumber(rng) {
  return String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0');
}

function genDob(persona, rng, now) {
  const [lo, hi] = String(persona.demographics.age_band).split('-').map(Number);
  const age = lo + Math.floor(rng() * (hi - lo + 1));
  const year = now.getUTCFullYear() - age;
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function emailLocal(given, surname) {
  return `${given}.${surname}`.toLowerCase().replace(/[^a-z0-9.+_-]/g, '');
}

export function generateInsuranceIdentity({ persona, names, rng, now }) {
  const name = drawName(rng, names);
  const gender = rng() < 0.5 ? 'Male' : 'Female';
  const nationality = NATIONALITY_BY_POOL[persona.demographics.nationality_pool] ?? 'ARE';

  const policyHolder = {
    FirstName: name.given,
    LastName: name.surname,
    Gender: gender,
    DateOfBirth: genDob(persona, rng, now),
    Nationality: nationality,
    MobileNumber: genMobileNumber(rng),
    EmailAddress: `${emailLocal(name.given, name.surname)}@example.test`,
    Address: [
      {
        AddressLine: [
          `Building ${1 + Math.floor(rng() * 99)}`,
          `Street ${1 + Math.floor(rng() * 30)}`,
          persona.demographics.emirate,
        ],
        Country: 'AE',
      },
    ],
  };

  const identity = {
    EmiratesId: { EmiratesIdNumber: genEmiratesId(rng) },
  };
  if (persona.demographics.has_visa) {
    identity.Visa = {
      VisaType: 'Employment',
      VisaNumber: genVisaNumber(rng),
    };
  }

  return { name, policyHolder, identity };
}

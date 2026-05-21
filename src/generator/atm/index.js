// ATM generator — Phase 2.3 GA.
// Turns the sentinel `atm_directory` persona + (lfi, seed) into a UAE
// ATM Locator bundle that envelopes into a v2.1 `GET /atms` response.
//
// EXP-05 / §8.3: bundle is a pure function of (persona, lfi, seed, now).
// LFI profile drives BOTH fleet size (Rich publishes more terminals than
// Sparse) AND optional-field populate-rates (post-generation redaction in
// lfi-profile.js).
//
// NG5 / D-14: ATMs are owned by the EMITTING LFI (anonymous Rich /
// Median / Sparse identity). The directory does NOT mix real UAE bank
// names — `LFIId` / `LFIBrandId` are synthetic per-profile, since binding
// a real bank name to a populate-rate band would violate the
// institution-leak invariant. Card scheme names on ATMFee.ApplicableNetworks
// (Visa / Mastercard / etc.) come from the spec enum and are explicitly
// permitted.

import { makePrng } from '../../prng.js';
import { applyAtmLfiProfile } from './lfi-profile.js';

// Fleet sizes per LFI profile. The number of ATMs an LFI exposes on its
// directory is a function of its branch network depth — Tier-1 retail
// banks (Rich) publish hundreds of locations across all seven emirates;
// Median LFIs publish a smaller mainland network; Sparse LFIs (digital
// challengers, foreign branches) publish a handful of strategic
// locations. The bands are sized to keep the staged payload under a
// few hundred KB while still exercising the spec's array-rich shape.
const FLEET_BAND_BY_LFI = {
  rich: [120, 160],
  median: [40, 60],
  sparse: [6, 12],
};

// Synthetic per-profile LFI identity. EXP-04 / NG5 forbid binding a
// populate-rate to a real bank name, so we publish anonymous LFI IDs.
const LFI_IDENTITY_BY_PROFILE = {
  rich: { LFIId: 'LFI-ATM-RICH-001', LFIBrandId: 'Rich-profile UAE Retail Bank — ATM Network' },
  median: { LFIId: 'LFI-ATM-MEDIAN-001', LFIBrandId: 'Median-profile UAE Bank — ATM Network' },
  sparse: { LFIId: 'LFI-ATM-SPARSE-001', LFIBrandId: 'Sparse-profile UAE LFI — ATM Network' },
};

// UAE emirate distribution. Weights reflect roughly the share of the
// real ATM footprint across the federation (Dubai + Abu Dhabi dominate;
// Northern Emirates trail). Used to draw a deterministic CountrySubDivision
// for each ATM record.
const EMIRATES = [
  { code: 'AbuDhabi', town: 'Abu Dhabi', weight: 30 },
  { code: 'Dubai', town: 'Dubai', weight: 38 },
  { code: 'Sharjah', town: 'Sharjah', weight: 14 },
  { code: 'Ajman', town: 'Ajman', weight: 5 },
  { code: 'UmmAlQuwain', town: 'Umm Al Quwain', weight: 2 },
  { code: 'RasAlKhaimah', town: 'Ras Al Khaimah', weight: 6 },
  { code: 'Fujairah', town: 'Fujairah', weight: 5 },
];

// Per-emirate centroid (latitude, longitude) + jitter radius (degrees).
// Coordinates are intentionally synthetic — they sit inside each
// emirate's land boundary but do NOT correspond to any real-world
// terminal address.
const EMIRATE_GEO = {
  AbuDhabi: { lat: 24.466, lng: 54.366, jitter: 0.18 },
  Dubai: { lat: 25.215, lng: 55.282, jitter: 0.16 },
  Sharjah: { lat: 25.354, lng: 55.426, jitter: 0.1 },
  Ajman: { lat: 25.405, lng: 55.513, jitter: 0.05 },
  UmmAlQuwain: { lat: 25.564, lng: 55.555, jitter: 0.04 },
  RasAlKhaimah: { lat: 25.692, lng: 55.95, jitter: 0.09 },
  Fujairah: { lat: 25.13, lng: 56.34, jitter: 0.08 },
};

// Synthetic district / area names per emirate. These read like UAE
// neighbourhood names but are themselves invented — no real address
// is encoded. Used for AddressLine + DistrictName.
const DISTRICTS = {
  AbuDhabi: ['Al Khalidiyah', 'Al Muroor', 'Al Wahda', 'Khalifa City', 'Yas Island', 'Al Reem'],
  Dubai: ['Downtown', 'Al Quoz', 'Deira', 'Jumeirah', 'Business Bay', 'Al Barsha', 'Mirdif'],
  Sharjah: ['Al Majaz', 'Al Qasimia', 'Al Nahda', 'Muweilah', 'Al Khan'],
  Ajman: ['Al Nuaimiya', 'Al Rashidiya', 'Al Jurf', 'Al Hamidiyah'],
  UmmAlQuwain: ['Al Salamah', 'Al Madar', 'Al Raas'],
  RasAlKhaimah: ['Al Nakheel', 'Al Hamra', 'Al Rams', 'Al Mairid'],
  Fujairah: ['Al Faseel', 'Al Gurfa', 'Dibba', 'Al Hayl'],
};

// Synthetic site-name building blocks. The Location.Site name reads
// like a UAE branch name (e.g. "Dubai Mall Branch", "Marina Plaza
// Branch") without naming any real venue.
const SITE_PREFIXES = [
  'Central',
  'Northern',
  'Southern',
  'Eastern',
  'Western',
  'Downtown',
  'Marina',
  'Mall',
  'Plaza',
  'Tower',
  'Mainstreet',
  'Corniche',
];
const SITE_SUFFIXES = ['Branch', 'Lobby', 'Drive-Thru', 'Outlet', 'Hub'];

const LOCATION_CATEGORIES = [
  'BranchExternal',
  'BranchInternal',
  'BranchLobby',
  'RetailerOutlet',
  'RemoteUnit',
  'DriveThru',
];

const ATM_SERVICES = [
  'Balance',
  'CashWithdrawal',
  'CashDeposits',
  'ChequeDeposits',
  'BillPayments',
  'MobilePhoneTopUp',
  'FastCash',
  'OrderStatement',
  'PINChange',
  'PINUnblock',
  'MiniStatement',
  'CharityDonation',
  'MobileBankingRegistration',
  'MobilePaymentRegistration',
];

const ACCESSIBILITY_OPTIONS = [
  'AudioCashMachine',
  'AutomaticDoors',
  'ExternalRamp',
  'InductionLoop',
  'InternalRamp',
  'LevelAccess',
  'LowerLevelCounter',
  'WheelchairAccess',
];

const LANGUAGES = ['en', 'ar', 'hi', 'ur', 'tl', 'ml'];

const ATM_FEE_TYPES = [
  'Withdrawal',
  'BalanceInquiry',
  'MiniStatement',
  'PINChange',
  'CashDeposit',
  'CardlessWithdrawal',
  'CrossBankWithdrawal',
  'InternationalWithdrawal',
];

const CARD_NETWORKS = ['Visa', 'Mastercard', 'AmericanExpress', 'Diners'];

// --- pure helpers ---------------------------------------------------------

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickWeighted(rng, table) {
  const total = table.reduce((acc, e) => acc + e.weight, 0);
  let r = rng() * total;
  for (const e of table) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return table[table.length - 1];
}

function pickN(rng, arr, n) {
  const pool = [...arr];
  const out = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function fleetSizeFor(lfi, rng) {
  const band = FLEET_BAND_BY_LFI[lfi] ?? FLEET_BAND_BY_LFI.median;
  const [lo, hi] = band;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

function geoFor(emirateCode, rng) {
  const c = EMIRATE_GEO[emirateCode];
  const lat = c.lat + (rng() * 2 - 1) * c.jitter;
  const lng = c.lng + (rng() * 2 - 1) * c.jitter;
  return { Latitude: lat.toFixed(6), Longitude: lng.toFixed(6) };
}

function buildOperatingHours(rng) {
  // Weekdays 08:00–22:00 most LFIs; weekend half-day or closed at
  // smaller branches. Returns a 1- or 2-entry OperatingHours list.
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'];
  const weekendish = ['Friday', 'Saturday', 'Sunday'];
  const wkOpenHour = 6 + Math.floor(rng() * 4); // 06:00–09:00
  const wkCloseHour = 20 + Math.floor(rng() * 4); // 20:00–23:00
  const weHours =
    rng() < 0.7
      ? {
          Days: weekendish.slice(0, 1 + Math.floor(rng() * 3)),
          OpenTime: '10:00',
          CloseTime: '18:00',
        }
      : null;
  const out = [
    {
      Days: weekdays,
      OpenTime: `${pad(wkOpenHour, 2)}:00`,
      CloseTime: `${pad(wkCloseHour, 2)}:00`,
    },
  ];
  if (weHours) out.push(weHours);
  return out;
}

function buildAtmFees(rng) {
  const types = pickN(rng, ATM_FEE_TYPES, 2 + Math.floor(rng() * 3));
  return types.map((t) => {
    const amount = (1 + Math.floor(rng() * 20)).toFixed(2);
    const fee = {
      Type: t,
      Amount: { Amount: amount, Currency: 'AED' },
    };
    if (rng() < 0.4) {
      fee.Percentage = Number((0.5 + rng() * 2).toFixed(2));
    }
    if (rng() < 0.6) {
      fee.ApplicableNetworks = pickN(rng, CARD_NETWORKS, 1 + Math.floor(rng() * 3));
    }
    return fee;
  });
}

function buildBranch(rng, suffix) {
  return {
    SchemeName: 'Other',
    Identification: `BR-${pad(1 + Math.floor(rng() * 999), 3)}-${suffix}`,
  };
}

function buildAtm({ idx, rng, lfiIdentity }) {
  const emirate = pickWeighted(rng, EMIRATES);
  const district = pick(rng, DISTRICTS[emirate.code]);
  const sitePrefix = pick(rng, SITE_PREFIXES);
  const siteSuffix = pick(rng, SITE_SUFFIXES);
  const locationCategory = pick(rng, LOCATION_CATEGORIES);
  const buildingNumber = String(1 + Math.floor(rng() * 999));
  const buildingName = `${sitePrefix} ${siteSuffix === 'Branch' ? 'House' : siteSuffix}`;
  const streetName = `${district} Street`;
  const idSuffix = pad(idx, 4);

  const atm = {
    LFIId: lfiIdentity.LFIId,
    LFIBrandId: lfiIdentity.LFIBrandId,
    ATMId: `${lfiIdentity.LFIId}-ATM-${idSuffix}`,
    SupportedLanguages: pickN(rng, LANGUAGES, 2 + Math.floor(rng() * 3)),
    Services: pickN(rng, ATM_SERVICES, 3 + Math.floor(rng() * 6)),
    Accessibility: pickN(rng, ACCESSIBILITY_OPTIONS, 1 + Math.floor(rng() * 4)),
    IsAccess24Hour: rng() < 0.55,
    Availability: {
      Status: rng() < 0.93 ? 'Available' : rng() < 0.5 ? 'UnderMaintenance' : 'Unavailable',
      OperatingHours: buildOperatingHours(rng),
    },
    SupportedCurrencies: rng() < 0.25 ? ['AED', 'USD'] : ['AED'],
    MinimumPossibleAmount: { Amount: '100', Currency: 'AED' },
    MaximumPossibleAmount: { Amount: String(2000 + 500 * Math.floor(rng() * 17)), Currency: 'AED' },
    Branch: buildBranch(rng, idSuffix),
    Location: {
      LocationCategory: [locationCategory],
      Site: {
        Identification: `SITE-${pad(1 + Math.floor(rng() * 9999), 4)}`,
        Name: `${sitePrefix} ${district} ${siteSuffix}`,
      },
      PostalAddress: {
        AddressType: 'Business',
        AddressLine: [`${sitePrefix} ${siteSuffix} ${idSuffix}`, `${buildingName}, ${district}`],
        BuildingNumber: buildingNumber,
        BuildingName: buildingName,
        StreetName: streetName,
        DistrictName: district,
        TownName: emirate.town,
        CountrySubDivision: emirate.code,
        Country: 'AE',
      },
      GeoLocation: geoFor(emirate.code, rng),
    },
    ATMFee: buildAtmFees(rng),
    Notes: [`Synthetic ATM record — sandbox seed-locked.`],
    Links: {
      FeesUri: `https://example.test/open-finance/atm/v2.1/atms/${idSuffix}/fees`,
    },
  };
  return atm;
}

/**
 * Build the ATM directory bundle for one (persona, lfi, seed) tuple.
 * The persona dimension is a sentinel — the same bundle shape is
 * emitted for every persona we wire to the ATM domain. Determinism
 * comes from `(persona_id, 'atm-generator', seed)`.
 */
export function buildAtmBundle({ persona, lfi, seed, now }) {
  const rng = makePrng(persona.persona_id, 'atm-generator', seed);
  const lfiIdentity = LFI_IDENTITY_BY_PROFILE[lfi] ?? LFI_IDENTITY_BY_PROFILE.median;
  const fleetSize = fleetSizeFor(lfi, rng);
  const atms = [];
  for (let i = 1; i <= fleetSize; i++) {
    atms.push(buildAtm({ idx: i, rng, lfiIdentity }));
  }
  const lastUpdated = (now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const bundle = {
    persona: persona.persona_id,
    name: persona.name,
    domain: 'atm',
    identity: lfiIdentity,
    atms,
    meta: {
      LastUpdatedDateTime: lastUpdated,
      TotalRecords: atms.length,
    },
  };

  return applyAtmLfiProfile({ bundle, personaId: persona.persona_id, lfi, seed });
}

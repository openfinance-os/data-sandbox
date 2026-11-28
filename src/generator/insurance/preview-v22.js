// Insurance facts the v2.2-rc2 release candidate newly requires
// (PRD D-01 amendment, 28 November 2026).
//
// rc2 replaces the free-text quote `LevelOfCover` with an enumerated
// `CoverType` plus explicit `PolicyStartDate` / `PolicyEndDate`, makes motor
// `Product.Policy.RegistrationType` mandatory, and requires coordinates on
// the insured address of home and renters policies. The stable generator
// already holds every fact needed: each quote is the `PolicyIssued` quote
// for the persona's first policy on that line, so its values are read from
// that policy's stable envelope. Nothing here changes the v2.1 corpus.
//
// Values are enum members of the candidate's schema; tests/preview-v22.test.mjs
// validates every emitted response against the vendored YAML, so a value the
// candidate does not allow fails the build rather than shipping.

/** The insurance line of an endpoint (`/motor-insurance-quotes/<id>` → `motor`). */
export function insuranceLine(endpoint) {
  return endpoint.match(/^\/(\w+)-insurance-(?:policies|quotes)\b/)?.[1] ?? null;
}

// The cover the stable generator issues on each line, expressed in the
// candidate's `CoverType` vocabulary. Lines whose policy envelope already
// carries the fact read it from there; home and renters are generated with a
// single fixed cover (see home-quote.js and renters-quote.js).
const COVER_TYPE = {
  motor: (policy) => policy.TypeOfPolicy,
  health: (policy) => policy.TypeOfPolicy,
  life: (policy) => policy.CoverType,
  employment: (policy) => policy.SchemeCategory,
  travel: (policy) => (policy.MultiTrip ? 'MultiTrip' : 'Single'),
  home: () => 'BuildingsAndContents',
  renters: () => 'ContentsOnly',
};

/** One year after an ISO date (`2026-01-31` → `2027-01-31`), the generator's term. */
function plusOneYear(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(y + 1, m - 1, d));
  return next.toISOString().slice(0, 10);
}

/**
 * Fields to add to a quote's `Data` for the release candidate.
 * @param {string} line  Insurance line (`motor`, `home`, …).
 * @param {object} policyData  `Data` of the line's first stable policy envelope.
 */
export function previewQuoteFields(line, policyData) {
  const policy = policyData?.Product?.Policy;
  if (!policy?.PolicyStartDate) throw new Error(`preview: no ${line} policy for its quote`);
  const coverType = COVER_TYPE[line]?.(policy);
  if (!coverType) throw new Error(`preview: no CoverType rule for ${line}`);
  return {
    CoverType: coverType,
    PolicyStartDate: policy.PolicyStartDate,
    PolicyEndDate: policy.PolicyEndDate ?? plusOneYear(policy.PolicyStartDate),
  };
}

// Emirate centre points, rounded to two decimals (about a kilometre), for
// the insured-address coordinates rc2 newly requires. A city centre, never
// a dwelling: the address itself is synthetic (`Building n, Street n`).
const EMIRATE_CENTRE = {
  AbuDhabi: ['24.45', '54.38'],
  Dubai: ['25.20', '55.27'],
  Sharjah: ['25.35', '55.39'],
  Ajman: ['25.41', '55.44'],
  UmmAlQuwain: ['25.56', '55.55'],
  RasAlKhaimah: ['25.79', '55.94'],
  Fujairah: ['25.13', '56.33'],
};

/**
 * Facts to add to a policy's `Data.Product` for the release candidate, as
 * `{ at, values }` additions for src/core/preview.js.
 * - motor: a vehicle of the policy's own model year is registered new; an
 *   older one is a renewal of an existing registration.
 * - home, renters: the insured address's emirate centre point.
 */
export function previewPolicyAdditions(line, policyData) {
  const product = policyData?.Product;
  if (line === 'motor' && product?.Policy) {
    const modelYear = Number(product.VehicleDetails?.ModelYear);
    const startYear = Number(product.Policy.PolicyStartDate.slice(0, 4));
    return [
      {
        at: ['Data', 'Product', 'Policy'],
        values: { RegistrationType: modelYear >= startYear ? 'New' : 'RenewalOfExistingVehicle' },
      },
    ];
  }
  const address = product?.PropertyDetails?.InsuredPropertyAddress;
  if ((line === 'home' || line === 'renters') && address) {
    const emirate = address.AddressLine?.[address.AddressLine.length - 1];
    const centre = EMIRATE_CENTRE[emirate];
    if (!centre) throw new Error(`preview: no centre point for emirate ${emirate}`);
    return [
      {
        at: ['Data', 'Product', 'PropertyDetails', 'InsuredPropertyAddress'],
        values: { Latitude: centre[0], Longitude: centre[1] },
      },
    ];
  }
  return [];
}

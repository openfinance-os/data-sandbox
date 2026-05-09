// Insurance Consents generator — Phase 2.1.
// Synthesizes the Data block of GET /insurance-consents and
// GET /insurance-consents/{ConsentId}. Each insurance bundle carries one
// consent record covering its own line — the v2.1 surface lets a TPP
// query the consents linked to a base authorisation grant.
//
// AEReadInsuranceConsent1Properties required surface:
//   ConsentId, Permissions[], ExpirationDateTime, OpenFinanceBilling,
//   CreationDateTime, Status, StatusUpdateDateTime
// Permissions[] entries are AEConsentPermissions: { InsuranceType,
// Permissions[] (≥1 of AEConsentPermissionCodes) }.
//
// InsuranceType enum: Employment | Health | Home | Life | Motor |
// Renters | Travel.
// Status enum: Authorized | AwaitingAuthorization | Rejected | Revoked |
// Expired | Suspended.

import { genUuid, isoDate } from './identity.js';

// persona.line → AEConsentPermissions.InsuranceType (title-cased; the
// spec enum is not lowercase). Keeps a single source of truth so a future
// new line lands here at the same time as its generator.
const INSURANCE_TYPE_BY_LINE = {
  motor: 'Motor',
  home: 'Home',
  health: 'Health',
  life: 'Life',
  travel: 'Travel',
  renters: 'Renters',
  employment: 'Employment',
};

// Per-line read-permission set — the data clusters this sandbox actually
// surfaces for each line. Mirrors the bundle's emitted endpoints.
const PERMISSIONS_BY_LINE = {
  motor: [
    'ReadInsurancePolicies',
    'ReadCustomerBasic',
    'ReadCustomerDetail',
    'ReadInsuranceProduct',
    'ReadCustomerClaims',
    'ReadInsurancePremium',
    'ReadCustomerPaymentDetails',
  ],
  home: [
    'ReadInsurancePolicies',
    'ReadCustomerBasic',
    'ReadCustomerDetail',
    'ReadInsuranceProduct',
    'ReadCustomerClaims',
    'ReadInsurancePremium',
    'ReadCustomerPaymentDetails',
  ],
  health: [
    'ReadInsurancePolicies',
    'ReadCustomerBasic',
    'ReadCustomerDetail',
    'ReadInsuranceProduct',
    'ReadCustomerClaims',
    'ReadInsurancePremium',
    'ReadCustomerPaymentDetails',
  ],
  life: [
    'ReadInsurancePolicies',
    'ReadCustomerBasic',
    'ReadCustomerDetail',
    'ReadInsuranceProduct',
    'ReadCustomerClaims',
    'ReadInsurancePremium',
    'ReadCustomerPaymentDetails',
  ],
  travel: [
    'ReadInsurancePolicies',
    'ReadCustomerBasic',
    'ReadInsuranceProduct',
    'ReadCustomerClaims',
    'ReadInsurancePremium',
    'ReadCustomerPaymentDetails',
  ],
  renters: [
    'ReadInsurancePolicies',
    'ReadCustomerBasic',
    'ReadInsuranceProduct',
    'ReadCustomerClaims',
    'ReadInsurancePremium',
    'ReadCustomerPaymentDetails',
  ],
  employment: [
    'ReadInsurancePolicies',
    'ReadCustomerBasic',
    'ReadCustomerDetail',
    'ReadInsuranceProduct',
    'ReadCustomerClaims',
    'ReadInsurancePremium',
    'ReadCustomerPaymentDetails',
  ],
};

// Map a persona line to a plausible TPP-side data-sharing purpose. All
// fall in the spec's AEOpenFinanceBilling.Purpose enum.
const PURPOSE_BY_LINE = {
  motor: 'PremiumHistory',
  home: 'RiskAssessment',
  health: 'ClaimHistory',
  life: 'FinancialAdvice',
  travel: 'PremiumHistory',
  renters: 'PremiumHistory',
  employment: 'Verification',
};

export function generateConsentRecord({ persona, rng, now }) {
  const line = persona.line ?? 'motor';
  const insuranceType = INSURANCE_TYPE_BY_LINE[line];
  const permissionCodes = PERMISSIONS_BY_LINE[line];
  const purpose = PURPOSE_BY_LINE[line] ?? 'Other';

  // Anchor consent issuance ~30 days before policy start; expire 12 months
  // after issuance. Determinism follows the bundle's rng.
  const startOffsetDays = 30 + Math.floor(rng() * 30);
  const creationDate = isoDate(now, -startOffsetDays);
  const creationDateTime = `${creationDate}T08:00:00.000Z`;
  const statusDateTime = `${creationDate}T08:05:00.000Z`;
  const expirationDate = isoDate(now, 365 - startOffsetDays);
  const expirationDateTime = `${expirationDate}T08:00:00.000Z`;

  return {
    ConsentId: genUuid(rng),
    BaseConsentId: genUuid(rng),
    Permissions: [
      {
        InsuranceType: insuranceType,
        Permissions: permissionCodes,
      },
    ],
    ExpirationDateTime: expirationDateTime,
    OpenFinanceBilling: {
      IsLargeCorporate: false,
      Purpose: purpose,
    },
    CreationDateTime: creationDateTime,
    Status: 'Authorized',
    StatusUpdateDateTime: statusDateTime,
  };
}

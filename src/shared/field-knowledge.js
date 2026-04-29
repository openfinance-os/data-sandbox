// Hand-authored field-level knowledge — concrete conditional rules, PII
// flags, and "why is this empty?" reasons for the v2.1 fields the field
// card surfaces. This is the only module in the codebase where field-name
// strings appear as keys; status badges (M/O/C) still flow from the spec
// parser via dist/SPEC.json.
//
// PRD §5.3 / EXP-14: "the conditional rule (if any)" — Phase 1 minimal.
// Phase 1.5 widens the conditional-rule lookup to cover every field with a
// non-trivial rule across the v2.1 spec.

// Conditional-rule prose for the top fields a field card user is likely to
// land on. Keys match the leaf field name (case-sensitive). For ambiguous
// names (e.g. "Amount" appears under many parents), prefer the most common
// reading or split by `Path.Name`.
export const CONDITIONAL_RULES = Object.freeze({
  // CurrencyExchange block — present only on FX-bearing transactions.
  'CurrencyExchange.SourceCurrency':
    'Required when CurrencyExchange is present (i.e. on transactions where TransactionType is InternationalTransfer or otherwise crosses currencies).',
  'CurrencyExchange.TargetCurrency':
    'Required when CurrencyExchange is present.',
  'CurrencyExchange.UnitCurrency':
    'Required when CurrencyExchange is present. The currency the exchange rate is expressed in (e.g. AED in `1 AED = 0.27 USD`).',
  'CurrencyExchange.ExchangeRate':
    'Required when CurrencyExchange is present.',
  'CurrencyExchange.InstructedAmount':
    'Required when CurrencyExchange is present — the amount in the source currency, before conversion.',
  // Balance.CreditLine — only on accounts with a credit facility.
  'CreditLine.Type':
    'Required when CreditLine is populated. Indicates whether the line is Available, Credit, Emergency, Pre-Agreed, or Temporary.',
  'CreditLine.Amount':
    'Required when CreditLine is populated.',
  'CreditLine.Included':
    'Required when CreditLine is populated. Indicates whether the credit line is rolled into the balance Amount.',
  // MerchantDetails — only on POS / ECommerce transactions.
  'MerchantDetails.MerchantName':
    'Optional even when MerchantDetails is present. Population varies — Common-band across the ecosystem.',
  'MerchantDetails.MerchantCategoryCode':
    'Optional. MCC identifies the merchant\'s line of business (e.g. 5411 = grocery). Variable-band populate rate.',
  // StandingOrder amounts — required when the standing order is populated.
  'NextPaymentAmount.Amount':
    'Required when StandingOrder.NextPaymentAmount is present.',
  'FinalPaymentAmount.Amount':
    'Required when StandingOrder.FinalPaymentAmount is present (only on standing orders with a planned end date).',
  // Beneficiary — PostalAddress is required only on the v2.1 international-payment shape.
  'PostalAddress.AddressLine':
    'Required when PostalAddress is populated. v2.1 mandates AddressLine + Country at minimum.',
  'PostalAddress.Country':
    'Required when PostalAddress is populated.',
  // VerifiedClaims — populated only on KYC-rich /parties responses.
  'Verification.TrustFramework':
    'Required when a VerifiedClaim entry is present. Identity-assurance framework reference (per OpenID Connect for Identity Assurance 1.0).',
  // Statements — Summary is per SubTransactionType.
  'Summary.SubTransactionType':
    'Required when a statement Summary entry is present. Aggregates a row per SubTransactionType (Purchase, Deposit, Fee, …).',
});

// Fields that carry PII — for Reem's PDPL JTBD (PRD §3.2 JTBD-12.1).
// Phase 1 marker: a small badge in the column header + field card. Phase 1.5
// expands this into a dedicated PII overlay (per the v0.9 plan footnote on
// Reem's JTBDs).
export const PII_FIELDS = Object.freeze(new Set([
  'AccountHolderName',
  'AccountHolderShortName',
  'Name',                // appears on AccountIdentifiers + CreditorAccount items
  'FullLegalName',
  'EmailAddress',
  'PhoneNumber',
  'BirthDate',
  'Identification',      // IBAN / account number
  'AddressLine',
  'PostCode',
  'GeoLocation',
  'CardInstrument',
  'TerminalId',
  'MandateIdentification',
]));

// Returns the conditional-rule prose for a field, falling back to a generic
// stub when the field isn't in the curated lookup.
export function conditionalRule(fieldName, fieldPath) {
  // Try exact key match first.
  const key = lastTwo(fieldPath || fieldName);
  if (CONDITIONAL_RULES[key]) return CONDITIONAL_RULES[key];
  if (CONDITIONAL_RULES[fieldName]) return CONDITIONAL_RULES[fieldName];
  return null;
}

function lastTwo(path) {
  const segs = String(path || '').split('.').filter((s) => !s.endsWith('[]'));
  if (segs.length < 2) return segs[0] ?? '';
  return `${segs[segs.length - 2]}.${segs[segs.length - 1]}`;
}

export function isPii(fieldName) {
  return PII_FIELDS.has(fieldName);
}

// "Why is this field empty?" — given a field, the active LFI, the persona,
// and the populate-rate band, return a one-sentence explanation users can
// hover for.
export function whyEmpty({ field, lfi, persona, band, parentPopulated, conditionalSatisfied }) {
  if (field.status === 'mandatory') {
    return 'Spec says this is mandatory. If you see it empty, that is a generator bug — please report.';
  }
  if (field.status === 'conditional') {
    if (conditionalSatisfied === false) {
      return 'The conditional rule that gates this field is not satisfied for this row — correctly absent.';
    }
    return 'Conditional field. Empty means either (a) the parent rule was not triggered, or (b) the LFI did not populate it even when triggered.';
  }
  // Optional.
  if (lfi === 'sparse') {
    if (band && band !== 'Universal') {
      return `Dropped by Sparse profile — Sparse populates only Universal-band optional fields. This field is band="${band}".`;
    }
  }
  if (lfi === 'median' && band) {
    const median = { Universal: 1.0, Common: 0.7, Variable: 0.4, Rare: 0.1, Unknown: 0.0 }[band] ?? 0;
    if (median < 1.0) {
      return `Optional with band="${band}" — Median populate probability ${median}. Generator's RNG rolled unfavourably for this row.`;
    }
  }
  if (parentPopulated === false) {
    return 'Parent block not populated for this row — leaf cannot be present.';
  }
  if (persona) {
    // Persona-driven absences (FX, cash deposits) — heuristic.
    if (field.path?.includes('CurrencyExchange') && persona.fx_activity === false) {
      return `Persona has fx_activity=false — generator does not emit CurrencyExchange blocks for this persona.`;
    }
    if (field.name === 'Flags' && persona.income?.flag_payroll === false) {
      return `Persona has income.flag_payroll=false (e.g. gig income) — generator does not stamp Flags=Payroll on credits.`;
    }
  }
  return 'Optional field — not populated for this row. Hover the column header for the populate-rate band.';
}

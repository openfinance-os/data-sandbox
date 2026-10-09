import fs from 'node:fs';
import { it, expect } from 'vitest';
import { createValidators, stripAnnotations } from '../tools/schema-validator.mjs';
import { loadFixture } from '@openfinance-os/sandbox-fixtures';
import { loadFixturePage } from '@openfinance-os/sandbox-fixtures';
const validators = createValidators(fs.readFileSync('spec/uae-insurance-openapi.yaml', 'utf8'), {
  normalization: true,
});
it('accepts non-UUID policy IDs and rates above 100, retaining percentage limits', () => {
  expect(validators.forSchema('AEInsuranceResourceIdentifierType')('POL-2026-0042')).toBe(true);
  expect(validators.forSchema('AEInsuranceResourceIdentifierType')('')).toBe(false);
  expect(validators.forSchema('AEInsuranceServiceRatingRateOrRatio')(125.5)).toBe(true);
  expect(validators.forSchema('AEInsuranceServiceRatingPercentage')(125.5)).toBe(false);
});
it('premium adjustments carry string Credit/Debit directions and unsigned amounts', () => {
  const validate = validators.forSchema('AEInsuranceDataSharingPremiumProperties');
  const premium = {
    TotalPremiumAmount: { Amount: '100.00', Currency: 'AED' },
    PaymentFrequency: 'Monthly',
    Adjustments: [
      { AdjustmentAmount: { Amount: '10.00', Currency: 'AED' }, CreditDebitIndicator: 'Credit' },
    ],
  };
  expect(validate(premium), JSON.stringify(validate.errors)).toBe(true);
  premium.Adjustments[0].CreditDebitIndicator = true;
  expect(validate(premium)).toBe(false);
  delete premium.Adjustments[0].CreditDebitIndicator;
  expect(validate(premium)).toBe(true);
  premium.Adjustments[0].AdjustmentAmount.Amount = '-10.00';
  expect(validate(premium)).toBe(false);
});
it('the saved normalization patch exactly reproduces the reviewed transformed schemas', () => {
  const patch = JSON.parse(
    fs.readFileSync('docs/insurance-quote-normalization.patch.json', 'utf8'),
  );
  expect(patch).toHaveLength(24);
  for (const change of patch)
    expect(change.value).toEqual(validators.spec.components.schemas[change.path.split('/').at(-1)]);
});
it('independently enforces every generic and health quote status branch', () => {
  for (const [prefix, persona, line] of [
    ['AEInsurance', 'motor_comprehensive_mid', 'motor'],
    ['AEHealthInsurance', 'health_family_comprehensive', 'health'],
  ]) {
    const source = stripAnnotations(
      loadFixture({ persona, lfi: 'rich', endpoint: `/${line}-insurance-quotes/{QuoteId}` }),
    ).Data;
    const wrapper = validators.forSchema(`${prefix}QuoteReadResponseProperties`);
    for (const branch of validators.spec.components.schemas[`${prefix}QuoteReadResponseProperties`]
      .oneOf) {
      const schema = validators.spec.components.schemas[branch.$ref.split('/').at(-1)];
      const payload = Object.fromEntries(
        Object.entries(source).filter(([k]) => Object.hasOwn(schema.properties, k)),
      );
      payload.QuoteStatus = schema.properties.QuoteStatus.enum[0];
      expect(wrapper(payload), JSON.stringify(wrapper.errors)).toBe(true);
      expect(wrapper({ ...payload, Invented: true })).toBe(false);
      delete payload[schema.required[0]];
      expect(wrapper(payload)).toBe(false);
    }
  }
});
it('package pagination preserves the ATM wire shape and validates insurance lists', () => {
  const atm = loadFixturePage({ persona: 'atm_directory', endpoint: '/atms', offset: 0, limit: 3 });
  expect(atm.Links).toBeUndefined();
  expect(atm.Meta.TotalPages).toBeUndefined();
  expect(atm._paginationLinks.Next).toBeTruthy();
  const validator = createValidators(
    fs.readFileSync('spec/uae-atm-openapi.yaml', 'utf8'),
  ).forEndpoint('/atms');
  expect(validator(stripAnnotations(atm)), JSON.stringify(validator.errors)).toBe(true);
  const insurance = loadFixturePage({
    persona: 'motor_comprehensive_mid',
    endpoint: '/motor-insurance-policies',
    offset: 0,
    limit: 1,
  });
  const check = validators.forEndpoint('/motor-insurance-policies');
  expect(check(stripAnnotations(insurance)), JSON.stringify(check.errors)).toBe(true);
});

import { postedTransactions, minorUnits, formatMinor } from './ledger.js';
import { REFERENCE_DATE } from './scenario.js';

// Uses only observed wire fields. Missing classification fields trigger an
// explicit unknown count; enrichment/generator truth is never an input.
export function incomeAndCommitments(
  envelopes,
  { month = '2026-04', referenceDate = REFERENCE_DATE } = {},
) {
  const all = Object.entries(envelopes)
    .filter(([p]) => !p.includes('{') && p.endsWith('/transactions'))
    .flatMap(([, e]) => e.Data.Transaction);
  const rows = postedTransactions(all, { now: referenceDate }).filter((t) =>
    t.BookingDateTime.startsWith(month),
  );
  const groups = new Map();
  let unknown = 0;
  for (const t of rows) {
    const flags = t.Flags ?? [];
    const kind =
      t.CreditDebitIndicator === 'Credit' && flags.includes('Payroll')
        ? 'income'
        : t.CreditDebitIndicator === 'Debit' &&
            (flags.includes('StandingOrder') || flags.includes('DirectDebit'))
          ? 'commitments'
          : null;
    if (!kind) {
      if (!t.Flags) unknown++;
      continue;
    }
    const currency = t.Amount.Currency;
    const g = groups.get(currency) ?? {
      currency,
      incomeMinor: 0,
      commitmentsMinor: 0,
      incomeIds: [],
      commitmentIds: [],
    };
    g[`${kind}Minor`] += minorUnits(t.Amount.Amount, currency);
    g[kind === 'income' ? 'incomeIds' : 'commitmentIds'].push(t.TransactionId);
    groups.set(currency, g);
  }
  return {
    month,
    referenceDate,
    status: rows.length && unknown === 0 ? 'observed' : 'insufficient-evidence',
    unknownClassificationCount: unknown,
    bookedCount: rows.length,
    method:
      'Booked credits with Flags.Payroll; booked debits with Flags.StandingOrder or Flags.DirectDebit. Historical observations only.',
    limitations: [
      'Other income or obligations may be unrecognised.',
      'A single observed month does not establish affordability or future commitments.',
    ],
    byCurrency: [...groups.values()].map(({ incomeMinor, commitmentsMinor, ...g }) => ({
      ...g,
      income: formatMinor(incomeMinor, g.currency),
      commitments: formatMinor(commitmentsMinor, g.currency),
      remainder: formatMinor(incomeMinor - commitmentsMinor, g.currency),
    })),
  };
}

export function reconcileSweeps(primary, roleJourneys) {
  const transactions = (journey) =>
    Object.entries(journey)
      .filter(([p]) => !p.includes('{') && p.endsWith('/transactions'))
      .flatMap(([, e]) => e.Data.Transaction);
  const out = transactions(primary).filter(
    (t) =>
      t.Status === 'Booked' &&
      t.CreditDebitIndicator === 'Debit' &&
      t.TransactionReference?.startsWith('XLFI-'),
  );
  const incoming = Object.values(roleJourneys)
    .flatMap(transactions)
    .filter((t) => t.Status === 'Booked' && t.CreditDebitIndicator === 'Credit');
  const matched = [],
    unresolved = [];
  for (const debit of out) {
    const peers = incoming.filter(
      (t) =>
        t.TransactionReference === debit.TransactionReference &&
        t.BookingDateTime === debit.BookingDateTime,
    );
    if (peers.length !== 1) {
      unresolved.push(debit.TransactionId);
      continue;
    }
    const credit = peers[0],
      instructed = debit.CurrencyExchange?.InstructedAmount ?? debit.Amount;
    if (
      instructed.Currency !== credit.Amount.Currency ||
      instructed.Amount !== credit.Amount.Amount
    ) {
      unresolved.push(debit.TransactionId);
      continue;
    }
    matched.push({
      reference: debit.TransactionReference,
      date: debit.BookingDateTime,
      debitId: debit.TransactionId,
      creditId: credit.TransactionId,
      debit: debit.Amount,
      credit: credit.Amount,
      exchange: debit.CurrencyExchange ?? null,
    });
  }
  return {
    status: out.length && unresolved.length === 0 ? 'observed' : 'insufficient-evidence',
    matched,
    unresolved,
    limitations: [
      'Reference, timestamp and directed amount matching is synthetic demo evidence.',
      'Missing references or FX details prevent reconciliation.',
    ],
  };
}

export function insuranceCommitments(envelopes) {
  const policies = Object.entries(envelopes).filter(([p]) =>
    /-insurance-policies\/[^/{]+$/.test(p),
  );
  return {
    status: policies.length ? 'observed' : 'insufficient-evidence',
    policies: policies.map(([endpoint, e]) => ({
      endpoint,
      policyId: e.Data.InsurancePolicyId,
      premium: e.Data.Premium ?? null,
      endDate: e.Data.Product?.Policy?.PolicyEndDate ?? null,
      declaredCover: e.Data.Product?.Policy?.PolicyCoverAndBenefits ?? null,
      unknowns: [
        'Actual eligibility, exclusions and underwriting decisions require policy documents.',
        'Missing values are unknown, not zero or no cover.',
      ],
    })),
  };
}

export function normalizedTables(envelopes) {
  const accounts = envelopes['/accounts']?.Data.Account ?? [];
  const transactions = [],
    balances = [],
    statements = [];
  for (const [p, e] of Object.entries(envelopes)) {
    if (p.includes('{')) continue;
    const id = p.match(/^\/accounts\/([^/]+)\//)?.[1];
    if (p.endsWith('/transactions'))
      for (const t of e.Data.Transaction)
        transactions.push({
          account_id: id,
          transaction_id: t.TransactionId,
          booking_datetime: t.BookingDateTime,
          status: t.Status,
          direction: t.CreditDebitIndicator,
          amount: t.Amount.Amount,
          currency: t.Amount.Currency,
          narrative: t.TransactionInformation ?? null,
          mcc: t.MerchantDetails?.MerchantCategoryCode ?? null,
        });
    if (p.endsWith('/balances'))
      for (const b of e.Data.Balance)
        balances.push({
          account_id: id,
          datetime: b.DateTime,
          type: b.Type,
          direction: b.CreditDebitIndicator,
          amount: b.Amount.Amount,
          currency: b.Amount.Currency,
        });
    if (p.endsWith('/statements'))
      for (const s of e.Data.Statements ?? [])
        statements.push({
          account_id: id,
          statement_id: s.StatementId,
          opening_date: s.OpeningDate,
          closing_date: s.ClosingDate,
          opening_amount: s.OpeningBalance.Amount.Amount,
          opening_direction: s.OpeningBalance.CreditDebitIndicator,
          closing_amount: s.ClosingBalance.Amount.Amount,
          closing_direction: s.ClosingBalance.CreditDebitIndicator,
          currency: s.ClosingBalance.Amount.Currency,
        });
  }
  return {
    accounts: accounts.map((a) => ({
      account_id: a.AccountId,
      currency: a.Currency ?? null,
      subtype: a.AccountSubType ?? null,
      nickname: a.Nickname ?? null,
    })),
    transactions,
    balances,
    statements,
    commitments: Object.entries(envelopes)
      .filter(
        ([p]) =>
          !p.includes('{') && (p.endsWith('/standing-orders') || p.endsWith('/direct-debits')),
      )
      .flatMap(([p, e]) =>
        [...(e.Data.StandingOrder ?? []), ...(e.Data.DirectDebit ?? [])].map((r) => ({
          account_id: p.split('/')[2],
          commitment_id: r.StandingOrderId ?? r.DirectDebitId,
          kind: r.StandingOrderId ? 'standing-order' : 'direct-debit',
          frequency: r.Frequency ?? null,
          amount: (r.NextPaymentAmount ?? r.PreviousPaymentAmount)?.Amount ?? null,
          currency: (r.NextPaymentAmount ?? r.PreviousPaymentAmount)?.Currency ?? null,
          status: r.StandingOrderStatusCode ?? r.DirectDebitStatusCode ?? null,
        })),
      ),
    policies: insuranceCommitments(envelopes).policies.map((p) => ({
      policy_id: p.policyId,
      endpoint: p.endpoint,
      end_date: p.endDate,
      total_premium_amount: p.premium?.TotalPremiumAmount?.Amount ?? null,
      premium_currency: p.premium?.TotalPremiumAmount?.Currency ?? null,
      payment_frequency: p.premium?.PaymentFrequency ?? null,
      declared_cover: p.declaredCover == null ? null : JSON.stringify(p.declaredCover),
    })),
  };
}

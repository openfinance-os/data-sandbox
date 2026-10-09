import { minorUnits, formatMinor } from './ledger.js';

const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stableOrder = (a, b) =>
  ordinal(a.BookingDateTime, b.BookingDateTime) || ordinal(a.TransactionId, b.TransactionId);
const encode = (v) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))));
const decode = (v) =>
  JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0))));

export function summarizeTransactions(rows, { status = 'Booked', referenceDate } = {}) {
  const observed = rows.filter(
    (r) =>
      (status === 'all' || r.Status === status) &&
      (!referenceDate || Date.parse(r.BookingDateTime) <= Date.parse(referenceDate)),
  );
  const groups = new Map();
  for (const r of observed) {
    const currency = r.Amount.Currency,
      bookingStatus = r.Status;
    const key = `${currency}|${bookingStatus}`;
    const g = groups.get(key) ?? {
      currency,
      status: bookingStatus,
      count: 0,
      creditMinor: 0,
      debitMinor: 0,
      sourceIds: [],
    };
    const amount = minorUnits(r.Amount.Amount, currency);
    g[r.CreditDebitIndicator === 'Credit' ? 'creditMinor' : 'debitMinor'] += amount;
    g.count++;
    g.sourceIds.push(r.TransactionId);
    groups.set(key, g);
  }
  return {
    count: observed.length,
    omitted: rows.length - observed.length,
    complete: true,
    scope: { status, referenceDate: referenceDate ?? null, currenciesCombined: false },
    byCurrencyAndStatus: [...groups.values()].map(({ creditMinor, debitMinor, ...g }) => ({
      ...g,
      credit: formatMinor(creditMinor, g.currency),
      debit: formatMinor(debitMinor, g.currency),
      net: formatMinor(creditMinor - debitMinor, g.currency),
    })),
    earliest: observed.length ? [...observed].sort(stableOrder)[0].BookingDateTime : null,
    latest: observed.length ? [...observed].sort(stableOrder).at(-1).BookingDateTime : null,
  };
}

export function queryTransactions(envelope, options = {}) {
  const rows = envelope.Data.Transaction;
  if (!Array.isArray(rows)) throw new Error('Missing transaction array');
  const {
    since,
    until,
    minAmount,
    maxAmount,
    category,
    currency,
    status,
    cursor,
    summary,
    limit = 50,
    scenario = envelope._scenario,
    referenceDate = scenario?.referenceDate,
  } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be 1..500');
  if (status && !['Booked', 'Pending', 'Rejected', 'all'].includes(status))
    throw new Error('Invalid booking status');
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency');
  if ([minAmount, maxAmount].some((v) => v != null && !Number.isFinite(v)))
    throw new Error('Invalid amount filter');
  if (cursor && summary) throw new Error('Cursor pagination applies to records, not summary mode');
  for (const v of [since, until])
    if (v && !Number.isFinite(Date.parse(v))) throw new Error('Invalid date filter');
  const filters = { since, until, minAmount, maxAmount, category, currency, status };
  const identity = JSON.stringify({ scenario, filters, resource: envelope.Links?.Self });
  const filtered = rows
    .filter((r) => {
      const ts = Date.parse(r.BookingDateTime),
        amount = Number(r.Amount.Amount);
      return (
        (!since || ts >= Date.parse(since)) &&
        (!until || ts <= Date.parse(until)) &&
        (minAmount == null || amount >= minAmount) &&
        (maxAmount == null || amount <= maxAmount) &&
        (!currency || r.Amount.Currency === currency) &&
        (!status || r.Status === status) &&
        (!category ||
          `${r.MerchantDetails?.MerchantCategoryCode ?? ''} ${r.TransactionInformation ?? ''}`
            .toLowerCase()
            .includes(category.toLowerCase()))
      );
    })
    .sort(stableOrder);
  if (summary) {
    const totals = summarizeTransactions(filtered, { status: status ?? 'Booked', referenceDate });
    for (const group of totals.byCurrencyAndStatus) {
      const evidenceFilters = {
        ...filters,
        currency: group.currency,
        status: group.status,
        until:
          until && (!referenceDate || Date.parse(until) < Date.parse(referenceDate))
            ? until
            : referenceDate,
      };
      const evidence = queryTransactions(envelope, { ...evidenceFilters, limit: 50, scenario });
      group.sourceIds = evidence.Data.Transaction.map((t) => t.TransactionId);
      group.sourceEvidence = {
        total: group.count,
        returned: group.sourceIds.length,
        complete: !evidence._filter.nextCursor,
        nextCursor: evidence._filter.nextCursor,
        filters: evidenceFilters,
        limit: 50,
        instruction:
          'Use get_transactions with accountId, these filters and nextCursor as cursor to retrieve remaining source records.',
      };
    }
    return {
      ...envelope,
      Data: { ...envelope.Data, Transaction: [] },
      _filter: {
        ...filters,
        total: rows.length,
        matched: filtered.length,
        returned: 0,
        mode: 'summary',
        truncated: false,
      },
      _summary: totals,
    };
  }
  let end = filtered.length;
  if (cursor) {
    let decoded;
    try {
      decoded = decode(cursor);
    } catch {
      throw new Error('Invalid cursor');
    }
    if (
      decoded.identity !== identity ||
      !Number.isInteger(decoded.end) ||
      decoded.end < 0 ||
      decoded.end > end
    )
      throw new Error('Cursor belongs to a different scenario or filter');
    end = decoded.end;
  }
  const start = Math.max(0, end - limit),
    kept = filtered.slice(start, end);
  const nextCursor = start ? encode({ identity, end: start }) : null;
  return {
    ...envelope,
    Data: { ...envelope.Data, Transaction: kept },
    _filter: {
      ...filters,
      limit,
      total: rows.length,
      matched: filtered.length,
      kept: kept.length,
      returned: kept.length,
      truncated: start > 0,
      nextCursor,
      complete: nextCursor === null,
      ...(nextCursor
        ? { _paginationHint: 'Repeat the same filters and accountId with nextCursor as cursor.' }
        : {}),
    },
  };
}

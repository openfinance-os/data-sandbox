import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadFixture } from '@openfinance-os/sandbox-fixtures';
import { createServer } from '../src/server.mjs';

it('answers an April booked-money question with exhaustive source IDs and exact currency totals', async () => {
  const server = createServer();
  const client = new Client({ name: 'numeric-evaluation', version: '1' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError).not.toBe(true);
    const text = r.content.map((c) => c.text ?? '').join('\n');
    return JSON.parse(text.slice(text.indexOf('{')));
  };
  try {
    await client.callTool({
      name: 'set_session',
      arguments: { persona: 'hnw_multicurrency', lfi: 'rich' },
    });
    const accounts = (await call('get_accounts', {})).Data.Account;
    for (const account of accounts) {
      const filters = {
        accountId: account.AccountId,
        since: '2026-04-01T00:00:00Z',
        until: '2026-04-30T23:59:59.999Z',
        status: 'Booked',
        currency: account.Currency,
      };
      const fixture = loadFixture({
        persona: 'hnw_multicurrency',
        lfi: 'rich',
        endpoint: `/accounts/${account.AccountId}/transactions`,
      });
      const expected = fixture.Data.Transaction.filter(
        (t) =>
          t.Status === 'Booked' &&
          t.Amount.Currency === account.Currency &&
          t.BookingDateTime.startsWith('2026-04'),
      );
      const summary = (await call('get_transactions', { ...filters, summary: true }))._summary;
      expect(summary.count).toBe(expected.length);
      expect(summary.complete).toBe(true);
      expect(summary.scope.referenceDate).toBe('2026-05-01T00:00:00.000Z');
      const groups = summary.byCurrencyAndStatus;
      if (!expected.length) {
        expect(groups).toEqual([]);
        continue;
      }
      expect(groups).toHaveLength(1);
      expect(groups[0].currency).toBe(account.Currency);
      // Independent integer oracle, without calling the production ledger.
      const cents = (v) => BigInt(v.replace('.', ''));
      const decimal = (v) => {
        const s = String(v).padStart(3, '0');
        return `${s.slice(0, -2)}.${s.slice(-2)}`;
      };
      const credit = expected
        .filter((t) => t.CreditDebitIndicator === 'Credit')
        .reduce((n, t) => n + cents(t.Amount.Amount), 0n);
      const debit = expected
        .filter((t) => t.CreditDebitIndicator === 'Debit')
        .reduce((n, t) => n + cents(t.Amount.Amount), 0n);
      expect(groups[0].credit).toBe(decimal(credit));
      expect(groups[0].debit).toBe(decimal(debit));
      let cursor;
      const seen = [];
      do {
        const page = await call('get_transactions', {
          ...filters,
          limit: 17,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.Data.Transaction.map((t) => t.TransactionId));
        cursor = page._filter.nextCursor;
      } while (cursor);
      expect(seen.sort()).toEqual(expected.map((t) => t.TransactionId).sort());
      expect(new Set(seen).size).toBe(seen.length);
      expect(groups[0].sourceIds.every((id) => seen.includes(id))).toBe(true);
    }
    // Unsupported authority/data must produce an error, never an invented amount.
    const absent = await client.callTool({
      name: 'get_transactions',
      arguments: { accountId: 'missing', summary: true },
    });
    expect(absent.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});

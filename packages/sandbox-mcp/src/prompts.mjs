import { z } from 'zod';

export function registerPrompts(server) {
  server.registerPrompt(
    'pick-a-persona',
    {
      title: 'Pick a persona and start a PFM session',
      description:
        'Guides the user through picking one of the 12 synthetic UAE banking personas, sets the session, and explains the Rich/Median/Sparse LFI profile choice in one sentence each.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'I want to explore a synthetic UAE Open Finance customer in this sandbox.',
              'Use the `list_personas` tool to show me the available personas (id + name + archetype).',
              'Then, in plain language, ask me to pick one. While you wait, briefly explain the LFI populate-rate profiles:',
              '  • rich   — the bank fills in every optional field.',
              '  • median — typical UAE-market populate rate (default).',
              '  • sparse — the bank returns only mandatory fields plus a few optionals.',
              'Once I pick, call `set_session` with my chosen persona (lfi defaults to median).',
              'Remind me that this is fully synthetic data and that any export should preserve the SYNTHETIC watermark.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'monthly-summary',
    {
      title: 'Monthly PFM summary for the active persona',
      description:
        'Generates a month-end PFM-style summary: total balances, top spend categories, upcoming standing orders, and any distress signals — chained from the granular tools. Always preserves the SYNTHETIC watermark.',
      argsSchema: {
        month: z
          .string()
          .optional()
          .describe('Optional ISO month, e.g. "2026-03". Defaults to the most recent full month in the data.'),
      },
    },
    ({ month } = {}) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Produce a month-end PFM summary${month ? ` for ${month}` : ''} for the active persona.`,
              '',
              'Steps:',
              '  1. Confirm the active session with `get_session`. If none, stop and call `pick-a-persona` first.',
              '  2. Call `get_accounts`. List each account with type and currency.',
              '  3. Call `get_balances` (no accountId — fan out). Sum AED-equivalent balances; flag any non-AED account separately.',
              '  4. Call `get_transactions` (no accountId — fan out) with `summary: true`. The response gives you `byDirection`, `byMonth`, and `topCategories` per account in a small payload that fits within the tool-result cap even for HNW / Corporate / SME volumes. Pull the top 5 categories by absolute outflow from `topCategories`. If you want to call out specific large items, then re-call without summary, with a tight `since`/`until` window or `minAmount` filter to surface only the items of interest.',
              '  5. Call `get_standing_orders` and `get_direct_debits`. List the next 30 days of recurring outflows.',
              '  6. Highlight distress signals if any (NSF events, missed DD, large unscheduled inflows).',
              '',
              'Output format: short executive summary at the top (3 lines), then sections.',
              'IMPORTANT: every tool response carries a `_watermark` like',
              '  "SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · …"',
              'Include this watermark verbatim in a footer line so the user always sees that the data is synthetic.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}

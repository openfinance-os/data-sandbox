import { z } from 'zod';

export function registerPrompts(server) {
  server.registerPrompt(
    'pick-a-persona',
    {
      title: 'Pick a persona and start a PFM session',
      description:
        'Guides the user through picking one of the 39 synthetic UAE personas (banking, insurance, multi-domain, and the ATM directory), sets the session, and explains the Rich/Median/Sparse LFI profile choice in one sentence each.',
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
          .describe(
            'Optional ISO month, e.g. "2026-03". Defaults to the most recent full month in the data.',
          ),
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

  server.registerPrompt(
    'insurance-coverage-review',
    {
      title: 'Insurance coverage review for a persona',
      description:
        'Walks an insurance (or multi-domain) persona through a coverage review: policy summaries, full policy detail, premium and payment details, and quote status for each insurance line the persona carries. Always preserves the SYNTHETIC watermark.',
      argsSchema: {
        persona: z
          .string()
          .optional()
          .describe(
            'Optional persona id (e.g. "motor_comprehensive_mid", "home_mortgage_villa"). Defaults to the active session, or asks the user to pick from list_personas({ domain: "insurance" }).',
          ),
      },
    },
    ({ persona } = {}) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Run an insurance coverage review${persona ? ` for persona "${persona}"` : ''}.`,
              '',
              'Steps:',
              persona
                ? `  1. Call \`set_session\` with { persona: "${persona}" }.`
                : '  1. If there is no active insurance session (`get_session`), call `list_personas` with { domain: "insurance" } and ask me to pick one, then `set_session`.',
              '  2. Call `list_endpoints` to see which insurance line(s) the persona carries (motor / home / health / life / travel / renters / employment). Multi-domain personas can carry several lines.',
              '  3. For EACH line, call the per-line tools: `get_<line>_policies` → `get_<line>_policy` → `get_<line>_payment_details` → `get_<line>_quote`.',
              '  4. Summarise per line: what is covered, sum insured / coverage blocks, premium (amount, frequency, payment IBAN), claims history if present, renewal / expiry dates, and whether the product is Takaful.',
              '  5. Flag anything a broker would raise: lapsed or soon-expiring cover, claims that could affect renewal pricing, obvious coverage gaps (e.g. contents-only home cover with a mortgage).',
              '',
              'Output format: one section per insurance line, then a short "gaps & renewals" list.',
              'IMPORTANT: every tool response carries a `_watermark` such as',
              '  "SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · …"',
              'Include this watermark verbatim in a footer line — the data is fully synthetic.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'multi-lfi-financial-picture',
    {
      title: 'Whole-of-market picture for a multi-LFI, multi-domain persona',
      description:
        'Aggregates a multi-LFI persona across every bank slot in their multi_lfi_footprint (via set_session lfi_role) and every insurance line they carry, into one whole-of-market financial picture — the aggregation story a TPP builds on UAE Open Finance. Always preserves the SYNTHETIC watermark.',
      argsSchema: {
        persona: z
          .string()
          .optional()
          .describe(
            'Optional persona id with a multi_lfi_footprint (e.g. "retail_multi_banker", "sme_fnb_multi_outlet"). Defaults to "retail_multi_banker".',
          ),
      },
    },
    ({ persona } = {}) => {
      const target = persona || 'retail_multi_banker';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Build a whole-of-market financial picture for the multi-LFI persona "${target}".`,
                '',
                'Steps:',
                `  1. Call \`list_personas\` and find "${target}". Note its \`available_lfi_roles\` (the loadable bank slots), \`multi_lfi_footprint\` (declared bank slots + plausible real-UAE candidates), and \`multi_insurer_footprint\` (declared insurance carriers) if present.`,
                '  2. For EACH role in `available_lfi_roles` (starting with "primary"): call `set_session` with { persona, lfi_role: <role> }, then `get_accounts` and `get_balances`. Track which slot each account came from.',
                '  3. Re-pin the primary role and, if the persona is multi-domain, review each insurance line it carries with the per-line `get_<line>_policies` / `get_<line>_policy` tools.',
                '  4. Aggregate: total balances across ALL bank slots (flag non-AED separately), the role each bank plays (salary, everyday card, mortgage, digital sidekick, …), premiums payable across insurers, and cross-domain links (e.g. a home policy tied to the mortgage-lender slot).',
                '  5. Close with what a single-LFI view would have missed — the point of multi-LFI aggregation under UAE Open Finance.',
                '',
                'Remember: LFI slots are anonymous profiles (Rich/Median/Sparse); the named real-UAE banks/insurers in the footprints are plausible candidates only, never an operational claim.',
                'IMPORTANT: every tool response carries a `_watermark` such as',
                '  "SYNTHETIC — Open Finance Data Sandbox · OpenFinance-OS Commons · …"',
                'Include this watermark verbatim in a footer line — the data is fully synthetic.',
              ].join('\n'),
            },
          },
        ],
      };
    },
  );
}

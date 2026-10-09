# Guided labs

Use Node 22: `npm ci && npm run build:site`. Run `node examples/labs/run.mjs income rich`, `reconciliation rich`, or `cover sparse`. These commands read wire payloads, never enrichment labels. The answer keys in `dist/lab-answers.json` are explicit evaluation material. The explorer's Labs page reveals them on demand.

For consent, start `npm run mock` in one terminal and run `node examples/labs/consent.mjs` in another. The runner discovers a synthetic account, reads one page, simulates revocation, and abstains from presenting the cached page as currently authorised. API Hub authority is simulated; no real consent or token is issued.

Compare Rich and Sparse outputs. Missing classifications, references, premiums or cover are unknown. Historical observations do not establish affordability or insurance eligibility. Completion is self-reported; the five-minute target awaits observed user sessions.

# archive/

Historical artefacts kept for traceability. Nothing in here is loaded by the
running app, the build pipeline, or the test suite.

## `of-sandbox-prototype.html`

The original single-file Phase 0 prototype. Superseded by the `src/` build:
`src/index.html` + `src/styles.css` + `src/app.js` (see PRD_OF_Data_Explorer.md
§Phasing and IMPLEMENTATION_PLAN.md). The current sandbox is spec-driven; the
prototype's hand-authored SPEC table and inline JS no longer reflect the v2.1
shape served from `dist/SPEC.json`.

Retained because PRD §Appendix A and several deployment / spec-validation docs
reference it by name. Do **not** edit, run, or deploy this file — open
`src/index.html` instead.

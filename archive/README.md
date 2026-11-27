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

## Planning documents

Moved here on 27 November 2026 because the work they describe has shipped or
been superseded. `APP_IMPROVEMENT_PLAN.md` at the repo root is the current
execution plan, and `PRD_OF_Data_Explorer.md` remains the product spec.

- `IMPLEMENTATION_PLAN.md` — Phase 0–1.5 execution plan.
- `PHASE2_INSURANCE_PLAN.md` — Phase 2.0–2.1 insurance plan, shipped.
- `PRD_OF_Data_Explorer_Review.md` — PRD review trail, folded into the PRD by v0.9.
- `PRD_OF_Data_Explorer_Spec_Validation.md` — corrections to the Phase 0 prototype.
- `PRD_OF_Data_Explorer_Deployment.md` — hosting options, superseded by OF-OS Commons hosting.

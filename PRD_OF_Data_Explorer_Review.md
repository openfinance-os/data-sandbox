# PRD Review — Open Finance Data Sandbox v0.4

> **Status: HISTORICAL.** Tier-1 findings folded into PRD v0.5–v0.8; remaining items closed in PRD v0.9. Retained for traceability of the review trail. Do not action items from this doc directly — cross-check against the live PRD first.

| Field | Value |
|---|---|
| **Document type** | Critical review companion to `PRD_OF_Data_Explorer.md` v0.4 |
| **Date** | 28 April 2026 |
| **Reviewer** | Self-review (Michael Hartmann, Woven Product) |
| **Goal** | Identify concrete gaps and suggest amendments that increase the artefact's value to the OF-OS Commons and to TPP-perspective users. |
| **Verdict** | The PRD is structurally sound and the Commons-contribution framing is the right one. The biggest gaps are (a) under-specified non-anchor users, (b) requirements without acceptance criteria, (c) silent-on a few cross-cutting concerns (i18n, a11y, IP licensing, stewardship), and (d) a missed opportunity to deeply integrate with the companion *Credit Underwriting* article rather than just cross-link to it. None of these are structural — they're concrete additions. |

---

## 0. The headline

The PRD does the strategic work well. Where it's thin is on the **product-spec rigour** that turns a strategy into a buildable artefact. Six gaps in particular materially change the value if filled:

1. **JTBDs for users beyond Sara are missing.** §3.2 lists six other user archetypes as bullets with no jobs-to-be-done. If a Hub71 fintech founder lands on the page, what is she trying to *do*? The PRD doesn't say.
2. **EXP-NN requirements have no acceptance criteria.** Each requirement says *what* but not *how to know it's done*. A v1 build team will argue about every one.
3. **Underwriting Scenario formulas are deferred to "textbook-generic" without specifying which textbook.** This is a guaranteed argument later. Pin them now.
4. **Accessibility, performance, and i18n (Arabic / RTL) are not first-class requirements.** A11y appears as a checklist item; perf and i18n don't appear at all. This artefact targets the UAE market; bilingual support is non-trivial.
5. **IP licensing for the artefact, the personas, the populate-rate bands, and the prototype code is not stated.** A Commons contribution has to declare licence terms.
6. **There is no stewardship / sustainability story.** Who maintains this in 2 years? What happens if Woven loses interest? Without an answer, the Commons is taking on a future maintenance liability.

The next 19 suggestions are organised into three tiers by impact.

---

## Tier 1 — high-impact gaps that materially change the product

These should be added to PRD v0.5 before Phase 0 spike begins.

### T1-1. JTBDs for non-anchor user types (§3.2)

**Gap.** §3.1 develops Sara as a credit underwriter with four detailed JTBDs. §3.2 then lists six other user archetypes (fintech founder, risk modeller, AML analyst, PM, data scientist, developer, sales engineer, journalist) as bullets without any JTBDs. This makes them not-quite-real users.

**Fix.** Add 1–2 JTBDs for each. Concrete starters:

- **Fintech founder (Layla)** — *"Show me what data I'd actually have to work with on day one of a TPP licence, so I can decide whether my use case is feasible before raising the next round."* / *"Compare a Median LFI to a Sparse LFI — my product needs to work even on the worst case, and I need to know if it will."*
- **Risk modeller (Faisal)** — *"Export 5,000 transactions for the Mortgage-DBR persona under Median LFI as CSV so I can prototype an affordability model in my own notebook."* / *"Show me the populate-rate distribution across all optional fields so I know which to feature-engineer and which to skip."*
- **AML analyst (Aisha)** — *"Show me the Cash-Heavy SME persona — where would I expect to see suspicious patterns, and which fields are populated densely enough to design rules on?"*
- **PM (Daniel)** — *"Surface the worst-case (Sparse LFI) shape of every endpoint so I can scope downstream UI for the absent-fields case."*
- **Developer (Yusuf)** — *"Give me a stable URL for a known-good payload I can paste into my unit tests."*
- **Journalist / academic (Maya)** — *"Show me a citable example of `Flags=Payroll` in action so my article has a concrete reference."*

These JTBDs feed back into §4 functional requirements — for example, the journalist's JTBD justifies the citation guidance on `/about` (which is already in the PRD but isn't tied to a user need).

### T1-2. Acceptance criteria for every EXP-NN requirement (§4)

**Gap.** Requirements say what should happen but not how to verify it's done. Example: *EXP-04 — The generator SHALL accept an LFI population profile input controlling optional-field populate rates: Rich, Median, Sparse.* — but how do I know it's working? What does "working" look like in a test?

**Fix.** Append a `**Acceptance:** ...` line to every EXP-NN. Examples:

- **EXP-01.** Acceptance: spec-driven status badges; if a CI test injects a fake `required: [extra_field]` into the YAML, the build either picks up the new mandatory or fails loudly. Hand-authored field metadata is forbidden in the codebase.
- **EXP-04.** Acceptance: same `(persona, seed)` under Rich, Median, Sparse produces three bundles where (a) all mandatory fields have identical values, (b) Sparse populates only Universal-band optional fields, (c) Rich populates every populate-band field.
- **EXP-13.** Acceptance: every field in every rendered view has a visible status badge; no field renders without one. Test by snapshot of every (persona × LFI × endpoint) combination.
- **EXP-15.** Acceptance: coverage meter recalculates on persona change, LFI change, endpoint navigation; meter value matches the count of populated optional fields divided by total optional fields, rounded to nearest %.
- **EXP-17.** Acceptance: a URL captured at session N reproduces the exact same payload bundle when loaded at session N+1, even after a browser cache clear.

Adding acceptance criteria is mechanical work but it eliminates v1-build arguments and makes the build estimable.

### T1-3. Pin the Underwriting Scenario formulas (§4.4 EXP-18, §7.4)

**Gap.** EXP-18 says formulas are "textbook-generic, fully documented inline, and never tied to any specific institution's policy". This is the right *posture* but it doesn't pin the formulas. The first credit-policy stakeholder who looks at this will argue.

**Fix.** Pin them in v0.5. Concrete starting set:

- **Implied monthly net income** = trailing-12-month average of credit transactions where `Flags` contains `Payroll`. If no `Payroll`-flagged credits, fall back to the largest recurring credit on the same calendar day each month. Source-fields list shown in the panel.
- **Total fixed commitments** = sum of `NextPaymentAmount` across all active standing orders + average of `PreviousPaymentAmount` across all active direct debits, normalised to monthly via `Frequency`.
- **Implied DBR** = (Total fixed commitments) ÷ (Implied monthly net income), expressed as %.
- **NSF / distress event count** = count of transactions in trailing 12 months where `Status = Rejected` OR (`Balance.Amount < 0` AND a debit posted within the same day).

Each formula carries a footnote: *"Generic / illustrative. Not tied to any specific institution's underwriting policy. Adjust to your own policy when applying."*

### T1-4. Accessibility (a11y) as a first-class requirement (§4)

**Gap.** Accessibility appears once in §11's pre-publication checklist as "WCAG 2.1 AA target". That's a launch gate without a product spec.

**Fix.** Add `EXP-23 — Accessibility` to §4:

> **EXP-23.** The sandbox SHALL meet WCAG 2.1 AA at launch and at every subsequent release. Specifically: (a) every interactive element keyboard-reachable and operable; (b) every status badge conveys meaning by both colour and shape (mandatory = solid pill + "M" label; optional = dashed outline + "O" label; conditional = outline + "C" + rule icon — already aligned but should be verified); (c) text contrast ≥ 4.5:1 against background; (d) focus visible at all times; (e) screen-reader-friendly labels on every persona-card, endpoint-link, and field-cell; (f) `prefers-reduced-motion` honoured by the slide-over animation.
> Acceptance: axe-core CI check passes with zero violations; manual screen-reader walk-through documented.

This is meaningful for the journalist/academic persona (likely to use assistive tech) and for the fintech-founder persona (UAE inclusion regulation increasingly references WCAG).

### T1-5. Performance budget as a first-class requirement (§4)

**Gap.** No performance target anywhere.

**Fix.** Add `EXP-24 — Performance budget` to §4:

> **EXP-24.** Time to interactive on a mid-tier mobile (3G fast / 5 Mbps): < 3 seconds. Total page weight (HTML + CSS + JS): < 250 KB gzipped. Synthetic-data generation for a single persona / single LFI: < 200 ms on the same target device. Lighthouse Performance ≥ 90. Acceptance: Lighthouse run is part of CI; the build fails if scores drop.

The current prototype is well under this on desktop but uncertain on mobile. Pinning the budget keeps it that way as features are added.

### T1-6. Internationalisation — Arabic / RTL decision (§3 or §6)

**Gap.** UAE is bilingual (English + Arabic). The PRD is silent on whether the artefact supports Arabic / RTL. This matters for the local UAE market and for an OF-OS Commons artefact.

**Fix.** Decide and document:

- **Recommended for v1**: English-only, with explicit "Arabic version planned for v1.5" note in `/about` and a roadmap entry in §11. Reasoning: every label is short, every persona has an Arabic-friendly name in the rulebook, and i18n adds 1–2 weeks to v1 that doesn't yet have a clear demand signal.
- **Required for v1.5**: Arabic UI parallel-text, RTL layout, Arabic-Indic numerals optional. Persona narratives in Arabic. "FX purchase USD" → translated.
- New `EXP-25 — Internationalisation`: spec the v1.5 i18n surface explicitly.

Or alternatively: ship Arabic in v1. Worth deciding deliberately, not by omission.

### T1-7. IP licence declaration (§14, §6.6)

**Gap.** A Commons contribution has to declare its licence. The PRD doesn't say what licence governs the artefact, the synthetic personas, the populate-rate bands, the field guidance, the prototype code, or the published fixture package.

**Fix.** Recommend and document:

- **Code (HTML, JS, build tooling)**: MIT.
- **Content (personas, populate-rate bands, field guidance, walkthrough copy)**: Creative Commons Attribution 4.0 (CC-BY-4.0). Encourages re-use with attribution to OF-OS Commons / Woven.
- **Synthetic dataset / fixtures package**: CC0 (public domain). Maximum re-use; no attribution required because this is "data".
- **OpenAPI YAML (vendored)**: inherits Nebras's licence (whatever it is — verify and document).

Add to §14 Dependencies as a Legal item: "Licence declarations: MIT for code, CC-BY-4.0 for content, CC0 for fixtures. Check Nebras's spec licence and ensure compatibility."

### T1-8. Stewardship & sustainability story (§6 or new §17)

**Gap.** What happens to the sandbox in 2 years? If Woven loses interest, who maintains it? This is a Commons contribution, so the question matters more than for a Woven-internal product.

**Fix.** Add a new §17 — Stewardship:

> The sandbox is contributed by Woven and committed to a **2-year minimum maintenance window** (through 2028-Q2). Maintenance commitment includes: quarterly populate-rate band recalibration, OpenAPI spec-pin updates within 30 days of upstream Nebras releases, and bug fixes within 14 days of report.
>
> **End-of-life / hand-off.** If Woven cannot continue stewardship, the sandbox SHALL be offered to OF-OS Commons stewards for take-over with full repository access, persona / rulebook ownership, and 90 days of consultative support. The artefact SHALL never go un-maintained without an explicit, public end-of-life notice.
>
> **Open contribution.** From v2 onwards, persona contributions and field-guidance edits SHALL be acceptable as PRs from any Commons participant, subject to a published contribution guide and SME review.

This gives the Commons stewards confidence to feature the contribution and protects users from a "tool that lies about a stale spec" failure mode.

---

## Tier 2 — substantial improvements

These are amendments that materially improve the artefact's value but aren't pre-build blockers.

### T2-1. Differentiation vs *Velox* and the OpenAPI spec viewer (§1 or §2)

**Gap.** *Velox* already exists on OF-OS Commons as "Open Finance Interactive Demo". The OpenAPI spec is also publicly viewable. Why is this sandbox a separate contribution?

**Fix.** Add a paragraph in §1:

> **Why this and not Velox / not the OpenAPI spec viewer.** Velox demonstrates an OF *flow* (consent, redirect, callback). The OpenAPI viewer documents the *schema*. This sandbox sits between them: it shows what *the data* looks like once flows complete and schemas are populated. The three artefacts are complementary, not redundant.

### T2-2. Article-as-tour: deeper integration with *Credit Underwriting in the UAE* (§6.7)

**Gap.** The PRD currently cross-links the Commons article to the sandbox via a single link. That's directional, not integrative.

**Fix.** Pitch a sandbox-as-companion enhancement to the article:

- The article is rewritten (with the article's author) to include 4–6 inline "see this for yourself" deep-links, each landing on a specific persona+LFI+seed configured to demonstrate the article's point at that paragraph.
- Each deep-link auto-loads the Tell-me-a-story walkthrough at the relevant step.
- The sandbox `/about` page reciprocates with a "Read the article" link.
- Add a new metric `M8` — Article-sandbox bidirectional traffic.

This transforms the relationship from "two adjacent things in the Commons feed" to "one integrated learning experience".

### T2-3. Bug-report / feedback path baked in (§4 or §6)

**Gap.** A field-level user spotting a spec error or a populate-rate band that feels wrong has no path to report it.

**Fix.** Add `EXP-26`:

> **EXP-26.** Every field card SHALL carry a "Report an issue" link that pre-fills a GitHub issue (or Commons-equivalent) with the field name, schema, current persona, current LFI, current seed, and a checkbox set: [ ] spec error / [ ] populate-rate disagreement / [ ] guidance unclear / [ ] other. The artefact aims for ≤ 14 days from report to triage.

This is also a quality signal — visible willingness to be corrected.

### T2-4. Embedding / iframe support (§4 or §6)

**Gap.** The Commons article today is rendered as static text. A reader can't see a live persona inline; they have to click through.

**Fix.** Add `EXP-27`:

> **EXP-27.** A configurable embed mode SHALL be available at `/[slug]/embed?persona=...&lfi=...&endpoint=...&height=...` that renders a chrome-less version of the sandbox suitable for `<iframe>` embedding. Articles in the Commons (and external blog posts) can drop a live persona view inline. oEmbed metadata published.

This is the move that makes the sandbox infrastructure rather than a destination.

### T2-5. Versioning / changelog story (§6, new sub-section)

**Gap.** When the spec pin bumps, when populate-rate bands recalibrate, when a persona is added — how does a user know? The PRD doesn't specify.

**Fix.** Add §6.8 — Versioning & changelog:

> The sandbox publishes a `/changelog` page listing every change with date, type (`spec-pin`, `populate-rate-recalibration`, `persona-added`, `bug-fix`, `feature`), and a one-paragraph note. The current artefact version + spec pin is shown in the top bar at all times. Older versions are *not* preserved as separate URLs in v1; v2 may add `/v/2026-04-28/` archival snapshots if there's demand.

### T2-6. Calibration evidence — what makes the Median band "70%"? (§7.3)

**Gap.** §7.3 says populate-rate bands are "Woven-authored ecosystem-wide guess from publicly available spec evidence" but doesn't say what evidence.

**Fix.** Expand §7.3 to enumerate the calibration sources:

- Published Nebras compliance / certification reports (when public).
- LFI public release notes + OF integration status disclosures.
- Aggregate ecosystem benchmarks from Cambridge Centre for Alternative Finance, OBIE-style cross-jurisdiction comparisons, etc.
- Field-level discussion in published Open Finance UAE working-group notes (when public).
- Cross-jurisdictional analogues (UK Open Banking, EU PSD2 implementation reports) as a *prior*, not a substitute.

Plus a footnote that the Median band is a Woven-authored *prior* that gets revised as evidence accumulates, with confidence-band visible (e.g., "Common = 60–80% with 95% confidence" rather than a single point).

### T2-7. Threat model (new §6.9 or appendix)

**Gap.** Even a static synthetic-data site has security concerns: XSS in export filenames, prototype pollution from URL params, share-URL spoofing, malicious persona names, etc.

**Fix.** Add §6.9 — Threat model:

> Brief threat model:
>
> - **Trust boundary**: the sandbox treats every URL parameter (persona, LFI, seed) as untrusted user input. Validate, sanitise, default-on-error.
> - **Export filename injection**: filenames generated from persona name + LFI + seed; sanitise to prevent path-traversal characters.
> - **Prototype pollution**: avoid `Object.assign(target, JSON.parse(...))` patterns; use `Object.create(null)` for input-driven objects.
> - **Share-URL trust**: a shared URL can preselect any persona/LFI/seed; this is intended (it's the share feature) but the URL cannot inject custom personas or custom field metadata.
> - **No third-party scripts** in the artefact body. Any future third-party (e.g., analytics) goes through CSP allowlist and SRI.
>
> Standard OWASP Top 10 review at launch.

### T2-8. Risks not yet captured (§12)

Add three new risks:

- **R-EXP-09**: Spec-pin SHA goes stale and users see "v2.1 @ <stale SHA>" — without an alarm. Mitigation: monthly automated check that compares pinned SHA to upstream `main`; raise alarm if > 90 days behind.
- **R-EXP-10**: A high-profile public misuse of the sandbox (a fintech founder ships a wrong product against synthetic-data assumptions) creates a bad-press moment that boomerangs onto the Commons. Mitigation: prominent disclaimers (already), citation guidance with explicit "this is synthetic" framing (already), bug-report path so we hear about misinterpretations quickly (T2-3).
- **R-EXP-11**: The OpenAPI YAML at `github.com/Nebras-Open-Finance/api-specs` is moved, deleted, made private, or restructured. Mitigation: keep a local vendored copy; alert on upstream availability changes; have a documented fall-back to the previous pin.

---

## Tier 3 — polish & nice-to-have

### T3-1. Open-source the persona rulebook from v1, not v2 (§13 OQ-EXP-07)

**Suggestion.** Make persona contributions PR-able from v1 launch, not deferred to v2. The OF-OS Commons framing makes this natural; the Woven-internal posture would be conservative; the right move is the more-Commons-like one. Light moderation, public CONTRIBUTING.md.

### T3-2. Glossary on `/about` (§6.6)

**Suggestion.** Add a small glossary covering `DBR`, `AED`, `LFI`, `TPP`, `MCC`, `IBAN`, `PAN`, `SCA`, `KYC`, `Sharia-compliant`, etc. Helps the journalist / academic / international-developer personas. Links to authoritative sources where they exist.

### T3-3. Print / PDF export (§4.5)

**Suggestion.** Add `EXP-28`: a "print-friendly" mode that renders a persona's full bundle + all field cards as a clean, printable HTML page suitable for Save-as-PDF. Useful for academic citation and offline reference.

### T3-4. Mobile-specific spec (§5.1)

**Suggestion.** §5.1 says "responsive collapse on narrow viewports" — flesh out the mobile experience. UAE is a heavy-mobile market. Specify: persona dropdown at top, endpoint-tabs as a horizontal scroll, field-detail as a bottom sheet. Acceptance: usability test on iPhone SE-class device.

### T3-5. Bug-tracking metric (§9)

**Suggestion.** Add `M9 — Bug turnaround time`: median time from bug report to triage, target < 14 days. Public dashboard. This is a quality signal users care about for a tool they're being asked to trust.

### T3-6. Telemetry events (§9 or §6.5)

**Suggestion.** Specify which events are tracked: persona load, LFI switch, field click, endpoint navigation, raw-JSON toggle, export, share. All anonymous, no PII, no fingerprinting. This is needed to substantiate M1 and M6 metrics.

### T3-7. SEO / OG / social-share spec (§4 or §11)

**Suggestion.** Add to launch checklist: every persona URL has an OpenGraph card showing the persona name + LFI + a generated preview image. LinkedIn / Twitter / WhatsApp share previews tested. Sitemap.xml published. `meta robots` allow indexing.

### T3-8. SLA / monitoring sentence (§6.5)

**Suggestion.** A single sentence: "Hosted on OF-OS Commons infrastructure; uptime inherits Commons uptime; status visible at [status URL if any]." Sets expectations without overpromising.

### T3-9. Consider a "compact mode" for embedded / mobile (§5)

**Suggestion.** A density toggle that compresses the three-pane into a tighter view for embedded / power-user use. Two settings: comfortable (default), compact. Persisted in URL.

---

## What's already strong (preserve)

Worth being explicit about what *not* to change:

- **EXP-01's spec-driven posture** is the architectural keystone. Don't dilute it. Every other requirement benefits.
- **NG4 + NG5** (no real customer data, no institution-specific operational detail) are appropriately *permanent* not *phased*. Keep them in §2.2 as written.
- **The persona naming** (Sara, Khalid, Yousef + the 5 archetypes) is good. Concrete, narrative, UAE-specific without being institution-specific.
- **§6.6 Brand & attribution** is correctly inverted from v0.3. Footer attribution + `/about` paragraph is the right intensity.
- **The 12-endpoint scope** is correctly grown from 6 in v0.3 — incorporates the Spec Validation findings cleanly.
- **§1's "show-don't-tell complement to the article" framing** is the most strategically valuable sentence in the PRD. It ties the artefact to an existing Commons asset and gives the contribution a clear gap-to-fill.
- **The risk register has good coverage.** The new risks above (R-EXP-09 to R-EXP-11) are additions, not corrections.

---

## What I would amend in PRD v0.5

If I were writing v0.5 myself, in order:

1. **Add Tier 1 items 1–8 in full** — these are the substantive product-spec additions.
2. **Renumber EXP-NN to accommodate new ones** (EXP-23 a11y, EXP-24 perf, EXP-25 i18n, EXP-26 feedback, EXP-27 embed, EXP-28 print).
3. **Add §17 Stewardship** as a new top-level section.
4. **Add §6.8 Versioning & changelog and §6.9 Threat model** as new subsections.
5. **Tier 2 items 1–8** integrated where indicated above.
6. **Tier 3 items** mostly merged into §11 launch checklist or §4 functional requirements.

Estimated additional length: ~30–40% over v0.4. Result: a PRD that a build team can pick up without arguing.

---

## One harder question

The hardest unanswered question after this review: **is the right next move to spend time on PRD v0.5, or to go to Phase 0 build with v0.4 and treat the Tier 1/2 items as Phase 1 work?**

The case for v0.5 first: build estimates and stakeholder review are both meaningfully better with the gaps filled, and many of these gaps (a11y, perf, i18n, IP licensing) are the kind of thing that's much cheaper to build *into* the artefact than to retrofit.

The case for skipping to Phase 0: it's a 2-week spike with one persona and three endpoints. Most Tier 1 items can be deferred until Phase 0 reveals what's actually hard. Time-to-Commons-publication matters.

**Recommendation**: a quick v0.5 pass on Tier 1 items 1–4 (JTBDs, acceptance criteria, formulas, a11y) — half a day — before Phase 0 starts. The rest can wait until Phase 1. This gets the build team the inputs they need without delaying the spike.

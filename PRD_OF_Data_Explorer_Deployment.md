# OF Sandbox Explorer — Deployment Options

> **Status: SUPERSEDED.** Hosting is locked to OF-OS Commons per PRD D-05. The deployment-options matrix below is moot. Retained for reference / historical context only — see PRD §6 and §15 Appendix E.

| Field | Value |
|---|---|
| **Document type** | Companion to `PRD_OF_Data_Explorer.md` (v0.3) |
| **Date** | 28 April 2026 |
| **Author** | Woven Product (Michael Hartmann) |
| **Status** | **SUPERSEDED** — hosting locked to OF-OS Commons per D-05 (formerly: For decision on OQ-EXP-07 hosting region). |

---

## 0. The cheat-code property

The current prototype has a property worth understanding before reading the rest of this doc: **the synthetic-data generation runs entirely in the browser as JavaScript.** There is no backend at all. That means the v1 deployment can be as simple as a single static HTML file behind a CDN — zero servers, zero database, zero ongoing cost beyond bandwidth.

This is unusual for a public app and it's a real advantage:

- No 3 a.m. pages.
- No regional database to size.
- No auth attack surface (anonymous-only v1, per the PRD).
- The whole sandbox can be downloaded as a single `.html` and re-hosted by anyone — useful for governance ("here is the artefact, frozen at this version").
- The build → spec-version pin → publish pipeline collapses to GitHub Actions + a CDN.

The deployment options below cover (a) the simplest static-file hosting that exploits this property, (b) what changes when v1.5 adds optional sign-in and saved scenarios, and (c) the "fold into existing Woven AWS" path for organisations that prefer one stack.

---

## 1. Decision summary

**Recommendation for v1 (anonymous public sandbox):** **Cloudflare Pages** for the static frontend. Free, global edge, instant deploy from GitHub, automatic preview environments per PR, works without any opinion from the rest of the Woven stack. Time to first deploy: ~15 minutes from the prototype as it stands today.

**Recommendation for v1.5 (adds optional sign-in, save / annotate / share-with-comment):** Cloudflare Pages **+ Cloudflare Workers + D1** (SQLite at edge) **+ KV** (for cached share-by-URL bundles). Same stack, scales linearly, still no servers. If Cloudflare lock-in is a concern, the equivalent is **Vercel + Postgres + KV**.

**Recommendation if Woven needs everything in one place:** **AWS** in the existing Ireland VPC — S3 + CloudFront for the static frontend, Lambda + DynamoDB if/when v1.5 needs persistence. Higher operational cost (more setup, more pieces) but reuses the Woven WovenPipe / cATO pipeline you already have.

The full table is in §2.

---

## 2. Deployment options matrix

| # | Option | Topology | v1 fit | v1.5 fit | Cost (monthly, low-traffic) | Setup time | Lock-in | Strongest reason | Strongest objection |
|---|---|---|---|---|---|---|---|---|---|
| **A** | **Static-only on Cloudflare Pages** (Recommended for v1) | One static HTML/JS bundle, CDN edge globally | Excellent | Needs add-ons | $0 | ~15 min | Low (it's just a static file) | Free; instant; the prototype already works this way; trivial rollback | No backend = nothing for v1.5 features without adding Workers |
| **B** | **Static on Vercel** | Same as A, different vendor | Excellent | Excellent (Vercel Functions + Postgres or KV) | $0–$20 | ~15 min | Low–medium | Best DX; preview deployments are killer; cleanest path to Next.js if you ever want SSR | Slightly more vendor-coupled if you adopt Vercel-specific primitives |
| **C** | **Static on Netlify** | Same as A, different vendor | Excellent | Good (Netlify Functions + their DB) | $0–$20 | ~15 min | Low–medium | Mature; nice form-handling primitives | Functions cold-start is a touch worse than Vercel |
| **D** | **Cloudflare Pages + Workers + D1 + KV** (Recommended for v1.5) | Static frontend + edge functions + edge SQLite + KV cache | Overkill for v1 | Excellent | $0–$5 | ~1 hour | Medium (Cloudflare-specific D1 / Workers APIs) | Single vendor for everything; edge-native; KV is exactly the share-by-URL cache from EXP-17 | Cloudflare-specific bindings if you ever migrate |
| **E** | **GitHub Pages** | Static, served straight from the repo | Adequate | Doesn't fit | $0 | ~5 min | None | Zero new vendors; if your repo is already on GitHub, your deploy is `git push` | No edge KV, no functions, harder to add anything dynamic later |
| **F** | **AWS S3 + CloudFront + Route 53** | Static, AWS-native | Good | Needs Lambda + DynamoDB add-on | $5–$30 | ~2 hours (+terraform) | Medium (AWS-specific, but standard) | Reuses existing Woven AWS / WovenPipe pipeline, Ireland region, infra-as-code | More setup than Cloudflare; less developer-friendly preview environments |
| **G** | **AWS Amplify** | Managed AWS static + functions | Good | Good | $5–$30 | ~30 min | Medium | One-click AWS-native equivalent of Vercel; reuses AWS account | Amplify CLI's opinions can fight you; less flexible than raw S3+CloudFront |
| **H** | **Container on existing Woven AWS** (ECS Fargate / Kong-fronted) | The full FastAPI backend running as a container, frontend served by it | Wasteful for v1 | OK | $50+ | ~1 day | High (couples to existing infra) | Single stack; reuses observability, WAF, logging, IAM | Needlessly server-ful for a synthetic-data sandbox; more attack surface; ongoing ops |
| **I** | **Self-host on a Hetzner / DigitalOcean VPS** | Single VPS, nginx, Cloudflare in front | Adequate | Adequate | $5–$10 | ~2 hours | Low | Cheap; no AWS; no Cloudflare lock-in for the *application* | Least automated; manual TLS / OS updates / capacity planning |

**Cost rows** assume **< 100k uniques / month** (Phase 1 plausible scale per metric M2). At higher scale all options stay flat or scale linearly; the absolute differences between A/B/C/D are negligible at any plausible UAE-OF-ecosystem scale.

---

## 3. The v1 path in concrete steps (Option A — Cloudflare Pages)

This is what "ship publicly" looks like for v1, building from the prototype as it exists today (`of-sandbox-prototype.html`). All steps are mechanical.

### 3.1 Prep
1. Create a new repo `woven-of-sandbox` (or a subdirectory in an existing one). Move `of-sandbox-prototype.html` to `dist/index.html`.
2. Add `static/about.html` with citation guidance and disclaimers (per PRD §6.5, §6.7).
3. Add `static/spec/uae-account-information-openapi.yaml` — vendored copy of the upstream spec, pinned at a commit SHA (per Spec Validation report §4 recommendation 6). Build script downloads at build time.
4. Add a 50-line GitHub Action that lints HTML, runs the JS smoke test (the same one we ran on the prototype), and fails CI if either breaks.

### 3.2 Connect Cloudflare Pages
1. Sign in to Cloudflare → Pages → Connect to Git → select the repo.
2. Build command: `bash build.sh` (where `build.sh` is a 5-line script that copies `dist/` into `out/` and stamps the spec SHA into the HTML).
3. Output directory: `out`.
4. Deploy. First deploy takes ~30 seconds.

### 3.3 Domain
1. Add `sandbox.woven.ae` (or final pick per OQ-EXP-09) as a custom domain in Cloudflare Pages.
2. TLS is automatic.

### 3.4 Hardening (per PRD §6.5)
1. Cloudflare WAF: enable the OWASP ruleset (one click, free tier).
2. Rate-limit the export endpoints (also one click, free tier).
3. Robots.txt: allow indexing of the marketing pages and `/about`, allow indexing of the explore pages so `/personas/sara-salaried-expat` style URLs are findable.
4. OpenGraph meta tags on every URL state so share-by-URL produces a clean preview card.

### 3.5 Observability
1. Cloudflare Analytics is on by default — anonymous, no PII (matches PRD requirement EXP-22 for anonymous tracking).
2. Optional: add Plausible or Cloudflare Web Analytics for slightly richer event tracking, still PII-free.

**Total time from prototype to public launch on a custom domain:** ~half a day, including disclaimers, OG cards, and analytics.

---

## 4. The v1.5 path — adding sign-in, save, annotate, share-with-comment

v1.5 needs **a tiny amount of state** for: saved scenarios, annotations, share-with-comment. None of it is heavy.

### 4.1 Option D extension (recommended)

Cloudflare stack stays homogeneous:

- **Workers** for the API endpoints (save scenario, list scenarios, post comment, OAuth callback). 5–10 short handlers.
- **D1** (Cloudflare SQLite at edge) for the scenarios + comments tables. Two tables, ~6 columns each.
- **KV** for ephemeral cache (the deterministic-by-seed payload bundles, so re-loads of share-by-URL hit edge cache and skip re-generation).
- **OAuth** via the Cloudflare Pages "Access" feature *or* roll your own with `openid-client` against Google / GitHub / email magic-link. The PRD's OQ-EXP-13 lists the candidates.

### 4.2 Operational profile

- D1 is currently free up to 5 GB and 5M reads/day. Comfortably within v1.5 metric targets (M2 = 1k monthly visitors at 12 months).
- Cold-start on Workers is sub-50ms.
- No backups to manage — D1 has automatic point-in-time recovery.

### 4.3 If Cloudflare lock-in is a concern

The equivalent on Vercel: **Vercel + Vercel Postgres + Vercel KV** (or Neon for Postgres). Same architecture, different vendor, same operational profile.

The equivalent on AWS: **CloudFront + S3 + Lambda + DynamoDB + Cognito** (per PRD memory `project_woven_identity_entra` *for staff only*; external users still need a generic IdP layer). Adequate but more pieces; only worth it if you specifically want to fold the sandbox into the Woven AWS account.

---

## 5. The "everything inside Woven AWS" path (Option F/H)

If the requirement is "this must run in the Woven Ireland VPC and pass through WovenPipe gates", here is what it looks like:

### 5.1 Topology

- **S3** bucket in `eu-west-1` for the static bundle.
- **CloudFront** distribution in front, with the AWS-managed WAF.
- **Route 53** for `sandbox.woven.ae` → CloudFront.
- **ACM** for TLS.
- **Lambda + API Gateway** for v1.5 endpoints (save / annotate / OAuth callback).
- **DynamoDB** table for scenarios + comments.
- **Cognito User Pool** for external OAuth (separate from the staff Entra tenant, to keep regulated-staff identity isolated from public-user identity).
- **WovenPipe gates**: the cATO pipeline runs against this just like any other Woven service. Standard policy.

### 5.2 What's good

- Single-account billing.
- Reuses observability (CloudWatch / Datadog or whatever the Woven stack uses).
- Sits inside the same security and audit perimeter as the rest of Woven.
- Survives an "all Woven services in eu-west-1" architectural review without a special-case answer.

### 5.3 What's harder

- ~2× the setup time vs. Cloudflare Pages.
- Preview environments need extra plumbing (per-PR CloudFront distros are not trivial; Amplify Hosting is the official AWS answer here).
- Some of the sandbox's appeal is *not* being inside any specific bank's infra ("public-by-design"). Hosting it in the Woven AWS is fine but the brand framing has to be deliberate so users don't infer "this is run by ADCB".

### 5.4 When to pick this over Cloudflare

- If WovenPipe gating is a hard requirement (cATO posture per memory `project_wovenpipe_decisions_2026_04`).
- If "single-account billing" is a stated executive ask.
- If there is a near-term plan to fold the sandbox into the Developer Portal which is itself in the Woven AWS.

If none of those apply, Cloudflare Pages is faster and cheaper.

---

## 6. Cross-cutting decisions (independent of platform)

These apply to every deployment option and are worth deciding once.

| Decision | Default recommendation | Rationale |
|---|---|---|
| **Domain** | `sandbox.woven.ae` | Per OQ-EXP-09. `explorer.woven.ae` is a close second; `of.woven.ae` reads as too generic |
| **TLS** | Automated (Cloudflare / Let's Encrypt / ACM) | Standard |
| **Robots / SEO** | Indexable by default; OpenGraph + Twitter cards on every persona URL | M2 / M3 success metrics depend on discoverability |
| **Spec source-of-truth** | Pin to `github.com/Nebras-Open-Finance/api-specs:ozone:dist/standards/v2.1/uae-account-information-openapi.yaml` at a specific commit SHA, vendored in the repo | Per Spec Validation §4.6. Build-time check fails if upstream spec changes shape |
| **Spec version label** | Render the spec commit SHA + short message in the top bar and `/about` page | EXP-23, transparency |
| **Disclaimers** | Persistent footer on every page; full text on `/about` | PRD §6.5 |
| **Synthetic watermark** | Embedded in CSV/JSON exports per PRD §6.5 | Already in the prototype |
| **Analytics** | Anonymous only — Cloudflare Web Analytics or Plausible | PRD §6.4 EXP-22 — anonymous tracking, no PII |
| **Deployment env count** | One: production. v1 is too simple to justify dev/staging | Preview deploys per PR fill the staging role on Cloudflare/Vercel |
| **CDN region / origin region** | Origin in EU (Ireland or anywhere); edge global | OQ-EXP-07 — minimal because there's no PII or data-residency constraint |
| **Rollback** | Git revert + redeploy | Cloudflare/Vercel rollback in two clicks |
| **Backups** | None for v1; D1/Postgres point-in-time recovery for v1.5 | The data is synthetic — there is nothing to lose. v1.5 saves are user content and need backups. |

---

## 7. Specific quick-win artefacts to build

If you want to ship Option A (Cloudflare Pages) **in a week**, this is the exact list:

1. **Day 1 (half-day)** — Move prototype into a new repo, write `build.sh`, add a smoke-test workflow, connect Cloudflare Pages, attach a custom domain.
2. **Day 2 (half-day)** — Add `/about`, citation guidance, footer disclaimers, OpenGraph cards.
3. **Day 3 (full day)** — Roll the spec validation report's prototype edits into the `SPEC` object (PascalCase already correct; fix the enums; add `Flags=Payroll` salary mechanic; add Product, ScheduledPayment, Parties, Statements as new endpoints).
4. **Day 4 (full day)** — Build the persona library out from 3 to 6 personas (Sara, Khalid, Yousef + Mortgage-DBR, Thin-File, Gig-Worker).
5. **Day 5 (full day)** — Compare-LFIs side-by-side mode (EXP-16), save-by-URL (EXP-17), CSV export (EXP-19) with watermarking.

That's a credible **public v1 in five working days** on top of the prototype as it stands.

---

## 8. Open questions specific to deployment (to merge into the PRD's §13)

| ID | Question | Owner | Blocking? |
|---|---|---|---|
| **OQ-DEPLOY-01** | Cloudflare Pages (recommended) vs. Vercel vs. AWS-native (S3+CloudFront)? Default: Cloudflare Pages for v1, revisit at v1.5. | Product + OF Engineering | Blocking for v1 launch |
| **OQ-DEPLOY-02** | If we go with Cloudflare, are we comfortable with the lock-in on D1 + KV + Workers for v1.5? Or do we want a v1 that's portable to AWS later? | OF Engineering + InfoSec | Non-blocking for v1; revisit at v1.5 |
| **OQ-DEPLOY-03** | Hosting region — EU (Ireland), UAE, or US? Default: EU origin, global edge. Latency from UAE to EU edge is ~30ms, fine. | OF Engineering | Non-blocking |
| **OQ-DEPLOY-04** | Does the sandbox need to run through WovenPipe gates given it has no real data and no real APIs? Recommendation: lightweight — basic SCA / dependency scan only. | InfoSec | Blocking for go-live decision |
| **OQ-DEPLOY-05** | What's the launch comms plan with Nebras (per OQ-EXP-11) — does the answer change based on hosting (e.g., does AWS-in-Woven-VPC vs. Cloudflare make Nebras read this differently)? | Comms | Non-blocking |
| **OQ-DEPLOY-06** | When v1.5 adds OAuth, do we use Cloudflare Access (zero-config but Cloudflare-coupled), Auth.js (open-source, portable), or a vendor like Clerk/Auth0? | Product + InfoSec | Blocking for v1.5 |

---

## 9. One-line summary

**Cloudflare Pages for v1 (free, instant, exploits the prototype's no-backend property), Cloudflare Workers + D1 + KV for v1.5 (still on the same vendor), AWS in the Woven Ireland VPC if WovenPipe-gated single-stack hosting is a hard requirement.** The prototype's design — synthetic data generated client-side from a deterministic seed — makes the v1 deployment unusually simple, and that simplicity should be exploited rather than designed away.

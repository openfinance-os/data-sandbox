# Public access and indexing

The discoverable introduction is [OpenFinance-OS Commons](https://openfinance-os.org/commons/data-sandbox/).
The public application and data origin is `https://data-sandbox.openfinance-os.org/`.
Its root HTML refresh and canonical target resolve to `src/index.html`; Cloudflare Pages may normalize that to `src/`.
Application URLs preserve the persona, profile, seed and corpus version. The application deliberately remains `noindex`.
GitHub Pages is a deployment mirror, not the canonical application hostname. No search-crawler identity or indexing change is implied by a successful HTTP check.

## Diagnosed failure

On 10 October 2026, ordinary curl and a normal browser loaded the public app, while unmodified Python urllib requests received HTTP 403 with body `error code: 1010` and Cloudflare Ray IDs. The same block affected release metadata and JSON fixtures. Cloudflare's zone Browser Integrity Check was enabled. The custom domain, DNS, certificate and current Pages deployment were active and correct.

Browser Integrity Check rejects some standard programmatic clients based on their request headers. A public synthetic fixture corpus needs to support those clients directly, including Python, without requiring a browser user agent or cookie.

## Approved correction and scope

[The configuration rule](cloudflare-sandbox-public-read-rule.json) sets only `bic: false`, and matches exactly the sandbox hostname with GET/HEAD methods. It does not change the zone-wide setting, other hostnames or methods, WAF rules, DDoS mitigation, AI crawler policies, authentication or the app's indexing policy. This is a persistent exception to one header-based protection on public static reads.

The rule belongs to the zone-level `http_config_settings` phase. Its Cloudflare reference is `sandbox_public_read_bic`. Inspect existing phase rules before adding it; do not replace another entrypoint or unrelated rules. To roll back, disable or remove only that rule and verify the zone-wide Browser Integrity Check is still on.

**Rule status:** applied after the user's explicit approval at 04:16:58 UTC on 10 October 2026. Ruleset ID `474b169b28cc4e14b573818e63dcf46f`, rule ID `4116fdc790dc46f8a98283e262572ceb`. The zone-wide Browser Integrity Check remains on. The exception alone did not restore reads: Request Trace matched it, but real clients still received origin/edge 403/1010 locally and from a GitHub runner. A BIC-only skip with identical scope and Pages domain revalidation did not help; the temporary skip was removed. This origin delivery failure was subsequently resolved for canonical public reads through the approved Worker route below. The [unsent diagnostic draft](cloudflare-public-access-support.md) records the original evidence.

The weekly/manual audit workflow also runs the real public-access check from a GitHub runner. A trace success or a curl success cannot satisfy it.

## Alternative delivery without support outreach

The user canceled the support ticket and approved the exact full-host rollout. The active [Worker delivery route](public-access-worker.md) uses the verified GitHub deployment as the fixed origin for GET/HEAD at `data-sandbox.openfinance-os.org/*`. All 42 canonical checks pass with the ordinary Python client, including all three fixture domains and release parity. Normal browser explorer/embed loads and byte-identical payload comparisons pass. HTTP reads still redirect to HTTPS with scenario parameters retained; POST/OPTIONS keep the existing Pages responses. DNS and security rules retain their prior configuration, and the temporary Worker preview endpoint is disabled.

## Direct GitHub deployment mirror

The existing [GitHub deployment mirror](https://openfinance-os.github.io/data-sandbox/) also supports ordinary Python clients. On 10 October, the full check passed there, including three domain fixtures, GET/HEAD, CORS, missing-path 404s, noindex and parity with the deployed MCP service. Public clients can now use `https://data-sandbox.openfinance-os.org/fixtures/v1/manifest.json` and resolve its fixture paths under `https://data-sandbox.openfinance-os.org/fixtures/v1/`. The direct mirror remains available under `https://openfinance-os.github.io/data-sandbox/fixtures/v1/`.

Verify a release before using the mirror:

```sh
python3 tools/check-public-access.py --origin https://openfinance-os.github.io/data-sandbox --expected-revision <full-sha>
```

The mirror is the Worker's fixed upstream; the canonical app hostname and indexing policy remain unchanged.

Cloudflare documents [selective configuration settings](https://developers.cloudflare.com/rules/configuration-rules/settings/) and [Browser Integrity Check](https://developers.cloudflare.com/waf/tools/browser-integrity-check/).

## Verify public delivery

Run `python3 tools/check-public-access.py`. It uses the ordinary urllib client with no identity override and checks root/HEAD access, app and integration/embed/lab pages, intended noindex, release/fixture metadata parity, three domain fixtures, CORS, an unsupported fixture's 404, and site/MCP revision/corpus/date/pins parity. Use `--expected-revision <full-sha>` after a release to reject stale deployments. It exits nonzero on any failed check and writes `artifacts/public-access.json`.

For a local staged-site check, pass `--origin http://127.0.0.1:8000 --mcp-origin ''`. The CDN CORS checks deliberately fail on the minimal local server, which does not implement CDN headers; use the public origin for acceptance.

Verify the explorer and embed in a normal browser as well. Curl success alone does not prove the Python-client path or the interactive journey. Keep authenticated crawler verification separate from ordinary HTTP checks; do not impersonate a crawler to establish access.

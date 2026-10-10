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

**Application status:** applied after the user's explicit approval at 04:16:58 UTC on 10 October 2026. Ruleset ID `474b169b28cc4e14b573818e63dcf46f`, rule ID `4116fdc790dc46f8a98283e262572ceb`. The zone-wide Browser Integrity Check remains on. Cloudflare Request Trace matches this rule, but real default-client reads still return 1010 from both the local network and a GitHub runner. Cloudflare HTTP analytics records those subsequent failures with both edge and origin status 403; no subsequent zone BIC block events appeared in the checked window. A BIC-only skip with the identical hostname/method scope did not help and was removed. Pages domain revalidation returned to active and did not fix the reads. This remains an origin delivery issue, not a completed public-access correction. See the [prepared provider request](cloudflare-public-access-support.md).

The weekly/manual audit workflow also runs the real public-access check from a GitHub runner. A trace success or a curl success cannot satisfy it.

## Alternative delivery without support outreach

The user canceled the support ticket. A [prepared Worker delivery change](public-access-worker.md) uses the already verified GitHub deployment as the fixed origin for canonical GET/HEAD reads. Its release-only production trial makes default Python GET/HEAD to `/dist/release.json` return 200 while POST/OPTIONS remain 403. Full-host routing is prepared but awaits explicit authorization after automatic approval review rejected the broader production scope. Other paths still use Pages and remain blocked for this client.

## Temporary programmatic download path

The existing [GitHub deployment mirror](https://openfinance-os.github.io/data-sandbox/) supports ordinary Python clients. On 10 October, the full check passed there, including three domain fixtures, GET/HEAD, CORS, missing-path 404s, noindex and parity with the deployed MCP service. Until the canonical origin is corrected, use `https://openfinance-os.github.io/data-sandbox/fixtures/v1/manifest.json` to discover fixture paths, and resolve them under `https://openfinance-os.github.io/data-sandbox/fixtures/v1/`.

Verify a release before using the mirror:

```sh
python3 tools/check-public-access.py --origin https://openfinance-os.github.io/data-sandbox --expected-revision <full-sha>
```

The mirror is a temporary delivery path; the canonical app hostname and indexing policy remain unchanged.

Cloudflare documents [selective configuration settings](https://developers.cloudflare.com/rules/configuration-rules/settings/) and [Browser Integrity Check](https://developers.cloudflare.com/waf/tools/browser-integrity-check/).

## Verify public delivery

Run `python3 tools/check-public-access.py`. It uses the ordinary urllib client with no identity override and checks root/HEAD access, app and integration/embed/lab pages, intended noindex, release/fixture metadata parity, three domain fixtures, CORS, an unsupported fixture's 404, and site/MCP revision/corpus/date/pins parity. Use `--expected-revision <full-sha>` after a release to reject stale deployments. It exits nonzero on any failed check and writes `artifacts/public-access.json`.

For a local staged-site check, pass `--origin http://127.0.0.1:8000 --mcp-origin ''`. The CDN CORS checks deliberately fail on the minimal local server, which does not implement CDN headers; use the public origin for acceptance.

Verify the explorer and embed in a normal browser as well. Curl success alone does not prove the Python-client path or the interactive journey. Keep authenticated crawler verification separate from ordinary HTTP checks; do not impersonate a crawler to establish access.

# Draft Cloudflare support request

Not submitted. The user canceled support outreach. This draft is retained only as a diagnostic record.

**Subject:** Pages origin returns BIC 1010 despite a matching hostname/method exception

Our public synthetic Open Finance sandbox is served by the `data-sandbox` Pages project at `data-sandbox.openfinance-os.org`, with Pages origin `data-sandbox-1cq.pages.dev`. DNS is proxied, the custom domain and certificate are active, and the production deployment is healthy. Normal browser and ordinary curl reads return 200. Unmodified Python urllib requests return 403 with body `error code: 1010`, including JSON fixtures and release metadata. The same failure occurs from a local network and a GitHub-hosted Ubuntu runner.

Reproduction, with no user-agent override:

```sh
python3 -c "import urllib.request; print(urllib.request.urlopen('https://data-sandbox.openfinance-os.org/dist/release.json').status)"
```

At 2026-10-10 04:16:58 UTC we applied a zone configuration rule in `http_config_settings`, with action `set_config`, parameters `{"bic":false}` and expression:

```text
(http.host eq "data-sandbox.openfinance-os.org" and http.request.method in {"GET" "HEAD"})
```

Ruleset `474b169b28cc4e14b573818e63dcf46f`, rule `4116fdc790dc46f8a98283e262572ceb`, reference `sandbox_public_read_bic`. The active phase entrypoint contains this rule and Request Trace matches it. The zone-wide BIC setting remains on; WAF/DDoS, other hostnames/methods and AI crawler policies are unchanged.

Before the exception, zone security events identify `source: bic` and the Python user agent. After it, HTTP analytics for this hostname records 403 at both edge and origin; the queried post-application zone BIC events are empty. The Pages origin also returns 1010 to Python directly. A custom skip rule with only `products: ["bic"]` and the identical hostname/method scope did not fix it, and we removed that trial. Retrying Pages custom-domain validation returned to active and did not fix it.

Representative real-client Ray IDs:

| Time (UTC) | Client | Route | Ray |
| --- | --- | --- | --- |
| 2026-10-10 04:24 | GitHub runner | `/dist/release.json` | `a482da576996f4e6-ORD` |
| 2026-10-10 04:24 | GitHub runner | `/fixtures/v1/manifest.json` | `a482da57fc4495c1-ORD` |
| 2026-10-10 04:31 | Local network | `/dist/release.json` | `a482e5e479d7f5a7-FRA` |

The [independent runner log](https://github.com/openfinance-os/data-sandbox/actions/runs/38023915671) records the failing public routes. The existing GitHub Pages mirror serves the same release and fixtures successfully to this client, with matching revision/corpus/reference date/standards pins and CORS.

Please identify the origin-side BIC evaluation and how to make Pages honor this exact GET/HEAD hostname exception, without disabling zone-wide protection, WAF/DDoS or bot policies. These are deliberately public, synthetic static reads. We need ordinary programmatic clients to work without impersonating a browser. Trace success alone is insufficient; acceptance is actual GET/HEAD 200s for metadata and all three fixture domains, with an unsupported fixture remaining 404.

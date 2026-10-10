# Public-read delivery through a Worker

The Pages origin returns 403/1010 to ordinary Python clients even after the approved hostname-specific GET/HEAD Browser Integrity Check exception. The existing GitHub Pages deployment serves the same synthetic release successfully. A small Worker can deliver those files at the canonical hostname without a support ticket or a DNS migration.

## Approved production delivery

- Worker: `data-sandbox-public-read`; source: [`cloudflare/public-read-worker.mjs`](../cloudflare/public-read-worker.mjs).
- Active production route: `data-sandbox.openfinance-os.org/*`, replacing the tested release-only route `data-sandbox.openfinance-os.org/dist/release.json*` after the user's exact rollout approval.
- Route ID: `caaf270b5c914dbd9d819e837e1d2883`; zone: `openfinance-os.org`.
- GET/HEAD files come from the fixed public origin `https://openfinance-os.github.io/data-sandbox/`. No configurable destination or open proxy is provided.
- Other methods use `fetch(request)` to the existing Pages origin. The release-only trial confirmed POST and OPTIONS still return 403 for the same Python client.
- DNS, Pages project/custom domain, the existing GET/HEAD BIC exception and zone-wide security settings stay as configured. This change does not add another WAF/BIC skip.

The proxy streams response bodies unchanged. It preserves HTTPS redirection, conditional/range headers, CORS, actual 404s, HTML noindex and existing cache/security-header behavior. Internal redirects stay on the incoming hostname, including scenario parameters. Requests to GitHub do not copy incoming cookies, authorization or forwarding/IP headers, and omit URL query parameters. The client's user agent is preserved; no browser identity is substituted. Upstream failures return 502 without caching an error or falling back to the blocked origin.

## Verified status

On 10 October 2026 the release-only production route changed default Python GET and HEAD from 403/1010 to 200. The approved full-host rollout then passed all 42 canonical default-Python checks against release `ecd585a259d5bee97aaa7beef484b2f00bfe6f4f`: metadata and three fixture domains, GET/HEAD, CORS, missing-file 404, noindex and site/fixture/MCP parity. Twelve canonical curl checks passed, including eleven byte-identical comparisons with the GitHub deployment. Normal browser explorer and embed loads rendered the generated data.

Twelve additional method/redirect checks passed across the root, explorer and release file: HTTP GET/HEAD redirect to HTTPS with scenario parameters retained, and HTTPS POST/OPTIONS retain their prior 403 responses. The response contains `X-Sandbox-Delivery: github-pages`. Zone-wide BIC remains on and its existing exception retains the exact hostname/GET/HEAD scope. The temporary `workers.dev` endpoint and version previews are disabled; canonical reads still return 200. The user canceled the support ticket; it remains unsent.

## Deployment and acceptance

The source and production configuration are committed alongside eleven focused tests. Deploy code with the existing Cloudflare connector's multipart Worker API, or with an authorized Wrangler session:

```sh
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

The configuration matches the approved production scope and keeps `workers_dev: false`. The API deployment uploads Worker code separately from guarded route updates. Inspect the exact route ID, pattern and script before a route change.

The rollout updated only route `caaf270b5c914dbd9d819e837e1d2883` from the release-only pattern to `data-sandbox.openfinance-os.org/*`, keeping script `data-sandbox-public-read`. After each subsequent release, run:

```sh
python3 tools/check-public-access.py --expected-revision <current-deployed-main-sha>
```

Acceptance requires all 42 default-Python checks, a normal browser explorer/embed load, byte-identical metadata and fixture payloads, and unchanged non-read responses. Verify the zone-wide BIC setting remains on and the existing exception still matches only GET/HEAD on this hostname. Keep the Worker's `workers.dev` endpoint disabled after acceptance.

The static site continues to update through the existing successful-main-CI GitHub Pages workflow. The Worker source requires its own deployment only when proxy behavior changes. A release containing only documentation or Worker files is outside the automatic MCP deployment path filter; after successful main CI, manually dispatch the existing gated `Deploy sandbox-mcp to Fly` workflow to keep revision metadata in parity, then repeat the public check. Delivery depends on GitHub Pages availability and the account's existing Workers request limits.

## Rollback

Inspect the exact route ID, script and pattern before changing it. To undo the full rollout, restore its release-only pattern. To undo the trial too, delete only route `caaf270b5c914dbd9d819e837e1d2883`. The unchanged DNS then sends requests to Pages again. Do not remove or replace unrelated routes, change DNS, disable global protection or purge the entire zone's cache. Keep the Worker source for inspection until rollback verification is complete.

Cloudflare documents [routes in front of an existing origin](https://developers.cloudflare.com/workers/configuration/routing/routes/) and [multipart Worker uploads](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/).

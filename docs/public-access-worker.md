# Public-read delivery through a Worker

The Pages origin returns 403/1010 to ordinary Python clients even after the approved hostname-specific GET/HEAD Browser Integrity Check exception. The existing GitHub Pages deployment serves the same synthetic release successfully. A small Worker can deliver those files at the canonical hostname without a support ticket or a DNS migration.

## Prepared change

- Worker: `data-sandbox-public-read`; source: [`cloudflare/public-read-worker.mjs`](../cloudflare/public-read-worker.mjs).
- Production route: `data-sandbox.openfinance-os.org/*`, replacing the tested release-only route `data-sandbox.openfinance-os.org/dist/release.json*`.
- Route ID: `caaf270b5c914dbd9d819e837e1d2883`; zone: `openfinance-os.org`.
- GET/HEAD files come from the fixed public origin `https://openfinance-os.github.io/data-sandbox/`. No configurable destination or open proxy is provided.
- Other methods use `fetch(request)` to the existing Pages origin. The release-only trial confirmed POST and OPTIONS still return 403 for the same Python client.
- DNS, Pages project/custom domain, the existing GET/HEAD BIC exception and zone-wide security settings stay as configured. This change does not add another WAF/BIC skip.

The proxy streams response bodies unchanged. It preserves conditional/range headers, CORS, actual 404s, HTML noindex and existing cache/security-header behavior. Internal redirects stay on the incoming hostname, including scenario parameters. Requests to GitHub omit cookies, authorization, forwarded client addresses and URL query parameters. The client's user agent is preserved; no browser identity is substituted. Upstream failures return 502 without caching an error or falling back to the blocked origin.

## Verified status

On 10 October 2026 the release-only production route changed default Python GET and HEAD from 403/1010 to 200. POST and OPTIONS remained 403. The response contains `X-Sandbox-Delivery: github-pages` and the published release revision. The Worker preview works for normal curl, but the platform's `workers.dev` hostname blocks Python before the Worker executes; preview curl checks and the canonical release trial must be kept distinct.

The broader route has **not** been applied. Automatic approval review requires explicit authorization for routing all production paths. The user canceled the support ticket; it remains unsent.

## Deployment and acceptance

The source and production configuration are committed alongside ten focused tests. Deploy code with the existing Cloudflare connector's multipart Worker API, or with an authorized Wrangler session:

```sh
npx wrangler deploy --config cloudflare/wrangler.jsonc
```

Do not run that command until the complete production route has been approved. The API deployment used for the trial uploads only the Worker and enables its preview; route changes are separate guarded API operations.

After approval, update only route `caaf270b5c914dbd9d819e837e1d2883` from the release-only pattern to `data-sandbox.openfinance-os.org/*`, keeping script `data-sandbox-public-read`. Then run:

```sh
python3 tools/check-public-access.py --expected-revision <current-deployed-main-sha>
```

Acceptance requires all 42 default-Python checks, a normal browser explorer/embed load, byte-identical metadata and fixture payloads, and unchanged non-read responses. Verify the zone-wide BIC setting remains on and the existing exception still matches only GET/HEAD on this hostname. Disable the Worker's `workers.dev` endpoint after acceptance; the production configuration already sets `workers_dev: false`.

The static site continues to update through the existing successful-main-CI GitHub Pages workflow. The Worker source requires its own deployment only when proxy behavior changes. Delivery depends on GitHub Pages availability and the account's existing Workers request limits.

## Rollback

Inspect the exact route ID, script and pattern before changing it. To undo the full rollout, restore its release-only pattern. To undo the trial too, delete only route `caaf270b5c914dbd9d819e837e1d2883`. The unchanged DNS then sends requests to Pages again. Do not remove or replace unrelated routes, change DNS, disable global protection or purge the entire zone's cache. Keep the Worker source for inspection until rollback verification is complete.

Cloudflare documents [routes in front of an existing origin](https://developers.cloudflare.com/workers/configuration/routing/routes/) and [multipart Worker uploads](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/).

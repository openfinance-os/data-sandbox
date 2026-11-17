# Search discovery and the staged site

The existing public integration guide at
https://data-sandbox.openfinance-os.org/src/integrate.html is the sole sitemap
entry. Its canonical is absolute and matches that URL. The `/integrate.html`
compatibility redirect repairs the Commons introduction's link without
duplicating the guide or breaking its relative assets.

The staging pipeline writes `sitemap.xml` and the two HTML redirects. The sitemap
does not enumerate fixtures, personas, scenarios, query parameters, simulation
routes, examples or the intentionally noindex explorer and labs. Staging fails
if the guide acquires an explicit noindex directive; do not override that policy.

The explorer remains **noindex**, as does its root redirect. Existing `/src/`
paths are unchanged. No robots.txt, WAF, authentication, Cloudflare bot setting,
release gate or analytics setting is changed. The public product introduction
remains https://openfinance-os.org/commons/data-sandbox/.

Redirect navigation stays relative for local/subpath staging; canonical URLs always name production. The redirects are HTML refreshes, not HTTP 301 responses. Sitemap availability
and canonical metadata do not prove indexing, citation, release readiness or
successful crawling. After an independently authorized deployment, verify 200
XML at `/sitemap.xml`, the guide and redirect targets, and preserved noindex.

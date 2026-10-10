// Serve the existing, CI-validated public deployment without the Pages origin hop.
const canonicalHost = 'data-sandbox.openfinance-os.org';
const previewHost = 'data-sandbox-public-read.michartmann.workers.dev';
const mirrorOrigin = 'https://openfinance-os.github.io';
const mirrorPrefix = '/data-sandbox';
const readMethods = new Set(['GET', 'HEAD']);
const publicHeaders = [
  'accept',
  'accept-encoding',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'range',
  'user-agent',
];

function unavailable(method) {
  return new Response(method === 'HEAD' ? null : 'Public sandbox delivery unavailable.\n', {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (![canonicalHost, previewHost].includes(incoming.hostname))
      return new Response('Not found.\n', { status: 404 });

    if (!readMethods.has(request.method)) {
      // The routed hostname still uses its existing Pages origin for non-reads.
      if (incoming.hostname === canonicalHost) return fetch(request);
      return new Response('Method not allowed.\n', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    // A Worker route bypasses Pages' automatic HTTP-to-HTTPS redirect.
    if (incoming.protocol !== 'https:') {
      incoming.protocol = 'https:';
      incoming.port = '';
      return Response.redirect(incoming.href, 301);
    }

    // Static files do not depend on query parameters. Keep scenario URLs in the
    // browser, but do not disclose recipes, cookies or credentials to GitHub.
    const upstreamUrl = new URL(mirrorPrefix + incoming.pathname, mirrorOrigin);
    if (!upstreamUrl.pathname.startsWith(mirrorPrefix + '/'))
      return new Response('Invalid path.\n', { status: 400 });
    const requestHeaders = new Headers();
    for (const name of publicHeaders) {
      const value = request.headers.get(name);
      if (value !== null) requestHeaders.set(name, value);
    }

    let upstream;
    try {
      upstream = await fetch(
        new Request(upstreamUrl, {
          method: request.method,
          headers: requestHeaders,
          redirect: 'manual',
        }),
      );
    } catch {
      return unavailable(request.method);
    }

    const headers = new Headers(upstream.headers);
    headers.delete('Set-Cookie');
    // Do not import GitHub's hostname-specific HSTS policy into this hostname.
    headers.delete('Strict-Transport-Security');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Sandbox-Delivery', 'github-pages');

    const location = headers.get('Location');
    if (location) {
      const redirect = new URL(location, upstreamUrl);
      if (
        redirect.origin !== mirrorOrigin ||
        (redirect.pathname !== mirrorPrefix && !redirect.pathname.startsWith(mirrorPrefix + '/'))
      )
        return unavailable(request.method);
      const publicUrl = new URL(incoming);
      publicUrl.pathname = redirect.pathname.slice(mirrorPrefix.length) || '/';
      publicUrl.hash = redirect.hash;
      headers.set('Location', publicUrl.href);
    }

    if (upstream.status >= 400) headers.set('Cache-Control', 'no-store');
    else if (headers.get('Content-Type')?.includes('text/html'))
      headers.set('Cache-Control', 'public, max-age=60, must-revalidate');
    else if (
      incoming.pathname.startsWith('/dist/') ||
      incoming.pathname.startsWith('/fixtures/v1/') ||
      incoming.pathname.endsWith('.js')
    )
      headers.set('Cache-Control', 'public, max-age=600, must-revalidate');

    if (incoming.pathname.startsWith('/fixtures/v1/')) {
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    }

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  },
};

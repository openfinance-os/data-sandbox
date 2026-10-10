import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../cloudflare/public-read-worker.mjs';

const host = 'https://data-sandbox.openfinance-os.org';
const preview = 'https://data-sandbox-public-read.michartmann.workers.dev';

afterEach(() => vi.unstubAllGlobals());

describe('public sandbox delivery Worker', () => {
  it('preserves the Pages HTTPS redirect without fetching public files over HTTP', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(
      new Request('http://data-sandbox.openfinance-os.org/dist/release.json?seed=4729'),
    );
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe(host + '/dist/release.json?seed=4729');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves unchanged fixtures without sending credentials or scenario queries to GitHub', async () => {
    const body = '{"Data":{"Account":[]},"_scenario":{"synthetic":true}}';
    const fetch = vi.fn().mockResolvedValue(
      new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'upstream=test',
          'Strict-Transport-Security': 'max-age=31556952',
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(
      new Request(host + '/fixtures/v1/example.json?custom=synthetic-recipe', {
        headers: {
          'User-Agent': 'Python-urllib/3.12',
          Authorization: 'Bearer test-only',
          Cookie: 'session=test-only',
          'X-Forwarded-For': '192.0.2.1',
        },
      }),
    );
    const [upstream] = fetch.mock.calls[0];
    expect(upstream.url).toBe(
      'https://openfinance-os.github.io/data-sandbox/fixtures/v1/example.json',
    );
    expect(upstream.headers.get('User-Agent')).toBe('Python-urllib/3.12');
    for (const header of ['Authorization', 'Cookie', 'X-Forwarded-For'])
      expect(upstream.headers.has(header)).toBe(false);
    expect(upstream.redirect).toBe('manual');
    expect(await response.text()).toBe(body);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Strict-Transport-Security')).toBeNull();
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('preserves HEAD and conditional headers without a response body', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { ETag: '"fixture-v1"' },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(
      new Request(host + '/dist/release.json', {
        method: 'HEAD',
        headers: { 'If-None-Match': '"fixture-v1"' },
      }),
    );
    expect(fetch.mock.calls[0][0].method).toBe('HEAD');
    expect(fetch.mock.calls[0][0].headers.get('If-None-Match')).toBe('"fixture-v1"');
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get('ETag')).toBe('"fixture-v1"');
  });

  it('passes non-read requests to the unchanged Pages origin', async () => {
    const original = new Request(host + '/dist/release.json', {
      method: 'POST',
      body: 'test-only',
    });
    const pagesResponse = new Response('error code: 1010', { status: 403 });
    const fetch = vi.fn().mockResolvedValue(pagesResponse);
    vi.stubGlobal('fetch', fetch);
    expect(await worker.fetch(original)).toBe(pagesResponse);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(original);
  });

  it('does not send non-read preview requests to any origin', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(new Request(preview + '/', { method: 'POST' }));
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unrelated hostnames instead of acting as an open proxy', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      (await worker.fetch(new Request('https://other.example/dist/release.json'))).status,
    ).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps directory redirects and scenario parameters on the incoming hostname', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 301,
          headers: { Location: 'https://openfinance-os.github.io/data-sandbox/src/' },
        }),
      ),
    );
    const response = await worker.fetch(
      new Request(host + '/src?persona=salaried_expat_mid&seed=4729'),
    );
    expect(response.headers.get('Location')).toBe(
      host + '/src/?persona=salaried_expat_mid&seed=4729',
    );
  });

  it.each(['https://other.example/file', 'https://openfinance-os.github.io/another-repo/'])(
    'rejects an upstream redirect outside the fixed deployment: %s',
    async (location) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }));
      vi.stubGlobal('fetch', fetch);
      expect((await worker.fetch(new Request(host + '/src/'))).status).toBe(502);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves missing fixture 404s and does not cache errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    const response = await worker.fetch(new Request(host + '/fixtures/v1/missing.json'));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('missing');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('reports an unavailable upstream without falling back to the blocked origin', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetch);
    const response = await worker.fetch(new Request(host + '/dist/release.json'));
    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

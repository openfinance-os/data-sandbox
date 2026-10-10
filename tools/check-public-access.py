#!/usr/bin/env python3
"""Read-only public-route smoke using unmodified urllib (no browser impersonation)."""
import argparse
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def run(origin, mcp_origin=None, expected_revision=None):
    origin = origin.rstrip('/') + '/'
    checks = []

    def check(name, passed, detail=None):
        checks.append({'name': name, 'passed': bool(passed), 'detail': detail})

    def get(relative, method='GET', want_json=False):
        url = urllib.parse.urljoin(origin, relative)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=15) as response:
                data = response.read()
                check(f'{method} {relative}', response.status == 200, response.status)
                if want_json:
                    check(f'JSON content type {relative}', 'application/json' in response.headers.get('Content-Type', ''))
                    return json.loads(data), response.headers
                return data.decode('utf-8'), response.headers
        except urllib.error.HTTPError as error:
            check(f'{method} {relative}', False, {'status': error.code, 'body': error.read(200).decode('utf-8', 'replace'), 'cfRay': error.headers.get('CF-Ray')})
        except (OSError, ValueError) as error:
            check(f'{method} {relative}', False, str(error))
        return None, {}

    root, _ = get('')
    if root is not None:
        check('Root canonical app entry', bool(re.search(r'<link\b[^>]*rel=["\']canonical["\'][^>]*href=["\']src/index\.html["\']', root)))
    get('', method='HEAD')
    app, _ = get('src/index.html')
    if app is not None:
        check('Intentional app noindex', bool(re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\']noindex["\']', app)))
        check('Synthetic app identity', 'Open Finance Data Sandbox' in app and 'SYNTHETIC' in app)
    for relative in ['src/integrate.html', 'src/embed.html', 'src/labs.html']:
        get(relative)

    release, _ = get('dist/release.json', want_json=True)
    manifest, _ = get('fixtures/v1/manifest.json', want_json=True)
    if release and manifest:
        check('Site/fixture revision parity', release.get('revision') == manifest.get('revision') and bool(release.get('revision')))
        check('Corpus parity', release.get('corpusVersion') == manifest.get('corpusVersion'))
        check('Reference date parity', release.get('referenceDate') == manifest.get('nowAnchor'))
        check('Per-domain standards parity', release.get('specProvenance') == manifest.get('specProvenance'))
        if expected_revision:
            check('Expected deployed revision', release.get('revision') == expected_revision, release.get('revision'))
        for persona, endpoint in [('salaried_expat_mid', '/accounts'), ('motor_comprehensive_mid', '/motor-insurance-policies'), ('atm_directory', '/atms')]:
            scenario = next((v for v in manifest.get('fixtures', {}).values() if v.get('personaId') == persona and v.get('lfi') == 'median'), None)
            relative = scenario and scenario.get('endpoints', {}).get(endpoint)
            safe = isinstance(relative, str) and relative.startswith('bundles/') and '..' not in relative and not urllib.parse.urlsplit(relative).netloc
            check(f'Published fixture {persona} {endpoint}', safe)
            if not safe:
                continue
            payload, headers = get('fixtures/v1/' + relative, want_json=True)
            if payload is not None:
                check(f'Fixture envelope {persona}', isinstance(payload, dict) and bool(payload))
                check(f'Fixture CORS {persona}', headers.get('Access-Control-Allow-Origin') == '*')
            get('fixtures/v1/' + relative, method='HEAD')

    missing = urllib.parse.urljoin(origin, 'fixtures/v1/bundles/__public_access_missing__/accounts.json')
    try:
        with urllib.request.urlopen(missing, timeout=15) as response:
            check('Unsupported fixture is 404', False, response.status)
    except urllib.error.HTTPError as error:
        check('Unsupported fixture is 404', error.code == 404, error.code)
    except OSError as error:
        check('Unsupported fixture is 404', False, str(error))

    if mcp_origin:
        try:
            with urllib.request.urlopen(mcp_origin.rstrip('/') + '/health', timeout=15) as response:
                health = json.load(response)
            check('MCP health', health.get('ok'))
            if release:
                for name in ['revision', 'corpusVersion', 'referenceDate', 'specProvenance']:
                    check(f'Site/MCP {name} parity', health.get(name) == release.get(name))
        except (OSError, ValueError) as error:
            check('MCP health', False, str(error))

    return {'origin': origin, 'revision': release and release.get('revision'), 'ok': all(c['passed'] for c in checks), 'checks': checks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', default='https://data-sandbox.openfinance-os.org')
    parser.add_argument('--mcp-origin', default='https://data-sandbox.fly.dev')
    parser.add_argument('--expected-revision')
    parser.add_argument('--report', default='artifacts/public-access.json')
    args = parser.parse_args()
    result = run(args.origin, args.mcp_origin, args.expected_revision)
    target = Path(args.report)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + '\n')
    for item in result['checks']:
        print(f"{'PASS' if item['passed'] else 'FAIL'} {item['name']}" + (f": {item['detail']}" if not item['passed'] else ''))
    sys.exit(0 if result['ok'] else 1)

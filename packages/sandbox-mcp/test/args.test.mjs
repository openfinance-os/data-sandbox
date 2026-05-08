import { describe, it, expect } from 'vitest';
import { parseArgs, parseEnvAllowedHosts } from '../src/args.mjs';

describe('parseEnvAllowedHosts', () => {
  it('returns [] for unset/empty', () => {
    expect(parseEnvAllowedHosts({})).toEqual([]);
    expect(parseEnvAllowedHosts({ MCP_ALLOWED_HOSTS: '' })).toEqual([]);
    expect(parseEnvAllowedHosts(undefined)).toEqual([]);
  });

  it('splits comma-separated hosts and trims whitespace', () => {
    expect(
      parseEnvAllowedHosts({ MCP_ALLOWED_HOSTS: 'a.example, b.example , c.example' }),
    ).toEqual(['a.example', 'b.example', 'c.example']);
  });

  it('drops empty entries from trailing or doubled commas', () => {
    expect(parseEnvAllowedHosts({ MCP_ALLOWED_HOSTS: 'a,,b,' })).toEqual(['a', 'b']);
  });
});

describe('parseArgs', () => {
  it('seeds allowedHosts from MCP_ALLOWED_HOSTS env', () => {
    const args = parseArgs([], { MCP_ALLOWED_HOSTS: 'data-sandbox.fly.dev,mcp.openfinance-os.org' });
    expect(args.allowedHosts).toEqual(['data-sandbox.fly.dev', 'mcp.openfinance-os.org']);
  });

  it('--allowed-host appends to env-derived list', () => {
    const args = parseArgs(
      ['--allowed-host', 'extra.example'],
      { MCP_ALLOWED_HOSTS: 'one.example' },
    );
    expect(args.allowedHosts).toEqual(['one.example', 'extra.example']);
  });

  it('parses transport and host/port flags', () => {
    const args = parseArgs(['--transport', 'http', '--port', '9000', '--host', '0.0.0.0'], {});
    expect(args).toMatchObject({ transport: 'http', port: 9000, host: '0.0.0.0' });
  });

  it('--no-dns-rebinding-protection flips the flag', () => {
    expect(parseArgs([], {}).enableDnsRebindingProtection).toBe(true);
    expect(parseArgs(['--no-dns-rebinding-protection'], {}).enableDnsRebindingProtection).toBe(false);
  });
});

#!/usr/bin/env node
// CLI entry for @openfinance-os/sandbox-mcp.
//
//  --transport stdio                   (default — Claude Desktop, Claude Code, npx)
//  --transport http [--port N] [--host H]
//                                      (D-13 — anonymous HTTP for marketplace listing)
//  --allowed-host h:port               (repeatable; adds to Host allowlist used for
//                                       DNS-rebinding protection; localhost/127.0.0.1
//                                       on the bound port are allowed by default)
//  --no-dns-rebinding-protection       (opt-out; mostly for local debugging)
//  --version, -V                       (print version and exit)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startStdio } from './transports/stdio.mjs';
import { startHttp } from './transports/http.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

function parseArgs(argv) {
  const out = {
    transport: 'stdio',
    port: 8787,
    host: '127.0.0.1',
    help: false,
    version: false,
    allowedHosts: [],
    enableDnsRebindingProtection: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--version' || a === '-V') out.version = true;
    else if (a === '--no-dns-rebinding-protection') out.enableDnsRebindingProtection = false;
    else if (a === '--transport') out.transport = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--allowed-host') out.allowedHosts.push(argv[++i]);
    else if (a.startsWith('--transport=')) out.transport = a.slice('--transport='.length);
    else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
    else if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
    else if (a.startsWith('--allowed-host=')) out.allowedHosts.push(a.slice('--allowed-host='.length));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.version) {
  process.stdout.write(`${pkg.name} ${pkg.version}\n`);
  process.exit(0);
}

if (args.help) {
  process.stdout.write(
    [
      `sandbox-mcp ${pkg.version} — MCP server for the Open Finance Data Sandbox`,
      '',
      'Usage:',
      '  sandbox-mcp [--transport stdio]                       Local stdio (default)',
      '  sandbox-mcp --transport http [--port 8787] [--host 127.0.0.1]',
      '                                                        Streamable HTTP',
      '              [--allowed-host mcp.example.org]          Add to Host allowlist',
      '              [--no-dns-rebinding-protection]           Disable Host validation',
      '',
      'Wire into Claude Desktop (stdio) by adding to claude_desktop_config.json:',
      '  {',
      '    "mcpServers": {',
      '      "open-finance-sandbox": {',
      '        "command": "npx",',
      '        "args": ["-y", "@openfinance-os/sandbox-mcp"]',
      '      }',
      '    }',
      '  }',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (args.transport === 'stdio') {
  await startStdio();
} else if (args.transport === 'http') {
  const handle = await startHttp({
    port: args.port,
    host: args.host,
    allowedHosts: args.allowedHosts,
    enableDnsRebindingProtection: args.enableDnsRebindingProtection,
  });
  process.stderr.write(
    [
      `${pkg.name} ${pkg.version} listening on ${handle.url}`,
      `allowed Host headers: ${handle.allowedHosts.join(', ')}`,
      `DNS rebinding protection: ${args.enableDnsRebindingProtection ? 'on' : 'off'}`,
      '',
    ].join('\n'),
  );

  let shuttingDown = false;
  const shutdown = async (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`received ${sig}, draining…\n`);
    try {
      await handle.close();
    } catch (err) {
      process.stderr.write(`error during shutdown: ${err?.message ?? err}\n`);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
} else {
  process.stderr.write(`unknown --transport: ${args.transport} (use stdio or http)\n`);
  process.exit(2);
}

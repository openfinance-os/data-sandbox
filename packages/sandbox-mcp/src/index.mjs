#!/usr/bin/env node
// CLI entry for @openfinance-os/sandbox-mcp.
//
//  --transport stdio                  (default — Claude Desktop, Claude Code, npx)
//  --transport http [--port N] [--host H]
//                                     (D-13 — anonymous HTTP for marketplace listing)
import { startStdio } from './transports/stdio.mjs';
import { startHttp } from './transports/http.mjs';

function parseArgs(argv) {
  const out = { transport: 'stdio', port: 8787, host: '127.0.0.1', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--transport') out.transport = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--host') out.host = argv[++i];
    else if (a.startsWith('--transport=')) out.transport = a.slice('--transport='.length);
    else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
    else if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(
    [
      'sandbox-mcp — MCP server for the Open Finance Data Sandbox',
      '',
      'Usage:',
      '  sandbox-mcp [--transport stdio]                       Local stdio (default)',
      '  sandbox-mcp --transport http [--port 8787] [--host 127.0.0.1]',
      '                                                        Streamable HTTP',
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
  const { url } = await startHttp({ port: args.port, host: args.host });
  process.stdout.write(`sandbox-mcp listening on ${url}\n`);
} else {
  process.stderr.write(`unknown --transport: ${args.transport} (use stdio or http)\n`);
  process.exit(2);
}

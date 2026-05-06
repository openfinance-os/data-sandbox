#!/usr/bin/env node
// CLI entry for @openfinance-os/sandbox-mcp.
// v1 ships stdio only. The HTTP transport waits on PRD decision D-11
// (additive read-only MCP plug-point hosted by OF-OS Commons).
import { startStdio } from './transports/stdio.mjs';

const args = new Set(process.argv.slice(2));

if (args.has('--help') || args.has('-h')) {
  process.stdout.write(
    [
      'sandbox-mcp — MCP server for the Open Finance Data Sandbox',
      '',
      'Usage: sandbox-mcp [--transport stdio]',
      '',
      'Transports:',
      '  stdio   (default, only option in v1)',
      '',
      'Wire into Claude Desktop by adding to claude_desktop_config.json:',
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

await startStdio();

// CLI / env argument parsing for sandbox-mcp.
//
// Extracted so it can be unit-tested without booting the server. The CLI flags
// are documented in index.mjs; the only env input is MCP_ALLOWED_HOSTS, a
// comma-separated list that contributes to the same allowlist as repeated
// --allowed-host flags. Container deployments (e.g. Fly.io fly.toml [env])
// prefer env over rewriting CMD.

export function parseEnvAllowedHosts(env) {
  const raw = env?.MCP_ALLOWED_HOSTS;
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseArgs(argv, env = process.env) {
  const out = {
    transport: 'stdio',
    port: 8787,
    host: '127.0.0.1',
    help: false,
    version: false,
    allowedHosts: parseEnvAllowedHosts(env),
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

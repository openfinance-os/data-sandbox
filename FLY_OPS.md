# Fly.io operations — `@openfinance-os/sandbox-mcp`

The five commands that cover ~95% of what you'll do once the hosted MCP endpoint is live, plus the common failure modes worth recognising. Pair this with [`fly.toml`](./fly.toml) and [`.github/workflows/deploy-mcp.yml`](./.github/workflows/deploy-mcp.yml).

> `flyctl` aliases as `fly`. Either works. Examples below use the short form.

```sh
fly auth login
```

(`flyctl tokens create deploy --app data-sandbox` produces the deploy-only token used by CI as `FLY_API_TOKEN`.)

---

## The five commands

### 1. `fly status` — is it healthy right now?

```sh
fly status --app data-sandbox
```

Shows the current machine, region, version, and whether the `/health` check is passing. After a deploy, expect:

- `state: started`
- `region: fra` (or whichever you configured)
- `health: passing` (Fly polls `/health` every 30 s — see `fly.toml`)

If `state: started` but `health: critical`, the container is up but `/health` is failing — go straight to `fly logs`.

### 2. `fly logs` — what's the server saying?

```sh
fly logs --app data-sandbox
```

Tails live. The MCP server emits one structured line per HTTP request:

```
2026-05-06T15:31:08.412Z POST /mcp 200 6ms session=8a1b3c2d
```

Plus session-eviction lines when the TTL or session cap fires:

```
session-evict 8a1b3c2d reason=idle
session-evict 9f4ee011 reason=cap
```

If you see a startup banner repeating every few seconds, the container is crash-looping (Fly auto-restarts on exit). Most likely cause: a missing env var or a fixture-corpus bump that's incompatible with the running image.

### 3. `fly ssh console` — get a shell inside the running machine

```sh
fly ssh console --app data-sandbox
```

Drops you into the Alpine container as the `node` user. Useful for:

- `wget -qO- http://127.0.0.1:8787/health` — does the server respond from inside the container?
- `ls -lah packages/sandbox-fixtures/bundles/` — is the deterministic corpus actually there? Should be ~14 MB.
- `node -e "console.log(require('@modelcontextprotocol/sdk/package.json').version)"` — what SDK version shipped?
- `ps aux` — is the Node process actually the entrypoint, or did something else take over?

### 4. `fly scale show` — what are we paying for?

```sh
fly scale show --app data-sandbox
```

Confirms the VM size and memory match `fly.toml` (default: `shared-cpu-1x` / `512mb`, one machine in `fra`). Resize with:

```sh
fly scale memory 1024 --app data-sandbox                    # bump RAM
fly scale count 2 --region fra --app data-sandbox           # add a second machine
```

512 MB has fit comfortably — the bundled fixture corpus is ~14 MB JSON, the Node process idle is around 60 MB. Bump only if `fly logs` shows OOM kills.

### 5. `fly secrets list` — what's set in the environment?

```sh
fly secrets list --app data-sandbox
```

For our deploy you should not normally need any secrets — the MCP endpoint is anonymous and the corpus is bundled. The list usually only shows what GitHub Actions sets (or what you set via `fly secrets set FOO=bar`). Use it to sanity-check before a deploy:

- No `NPM_TOKEN`, `FLY_API_TOKEN`, etc. should leak into the running container.
- If you've pinned an override like `MCP_SESSION_IDLE_TTL_MS`, it appears here.

---

## Failure modes to recognise

| Symptom (`fly status` / `fly logs`) | Likely cause | Fix |
|---|---|---|
| `health: critical`, `fly logs` shows the startup banner repeating | Container is crash-looping. Last log line before the banner is usually the real cause | Roll back: `fly releases --app data-sandbox` then `fly deploy --image registry.fly.io/data-sandbox:deployment-NNN` to the previous image |
| `health: critical`, no obvious crash, just steady traffic and 5xx's | Memory pressure — `fly logs` will have `OOM killed` lines | `fly scale memory 512 --app data-sandbox` |
| `Invalid Host header: <something>` repeating | DNS-rebinding protection rejecting the inbound `Host`. Usually means the custom domain isn't in `MCP_ALLOWED_HOSTS` | Add to `fly.toml` `[env].MCP_ALLOWED_HOSTS` and redeploy, or set ad-hoc with `fly secrets set MCP_ALLOWED_HOSTS=foo,bar` |
| `session-evict … reason=cap` constantly | At the `MCP_MAX_SESSIONS` ceiling (default 1024). Could be legitimate growth or abuse | Bump via `fly secrets set MCP_MAX_SESSIONS=4096`; if it keeps climbing, check `fly logs` for one Mcp-Session-Id getting hammered (likely a buggy client retrying init) |
| `fly status` shows `version` lower than the latest commit on main | Last deploy failed silently; the smoke job in `deploy-mcp.yml` should have caught it. Check the Actions run | Re-run the workflow, or `fly deploy --remote-only` manually |
| `fly certs show mcp.openfinance-os.org` says `Awaiting configuration` | Custom domain DNS hasn't propagated | Add the printed CNAME to your DNS provider; recheck with `fly certs show` until it says `Issued` |

---

## One-liners

```sh
# How many sessions are open right now?
curl -s https://data-sandbox.fly.dev/health | jq

# Smoke the deployed endpoint manually
node packages/sandbox-mcp/scripts/smoke.mjs https://data-sandbox.fly.dev

# Force a redeploy without changing code (e.g. after env-var change)
fly deploy --remote-only --strategy rolling --app data-sandbox

# Roll back to the previous image
fly releases --app data-sandbox                             # find the version you want
fly deploy --image registry.fly.io/data-sandbox:deployment-NNN

# Tail logs for the last hour (e.g. while debugging an incident)
fly logs --app data-sandbox --since 1h
```

---

## When in doubt

- **Roll back, don't debug under fire.** The image we just rolled away from was, by definition, working five minutes ago. Roll forward again once the smoke gate is green locally.
- **The smoke job in `deploy-mcp.yml` is the green/red signal you trust.** If it failed, the deploy didn't really succeed even if Fly says it did.
- **There's no real customer data anywhere in this system.** Recovery from an incident is "redeploy a known-good image"; there's no data to restore, no PII to notify on, no consent surface to rebuild.

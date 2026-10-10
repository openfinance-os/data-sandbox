# Dependency security

The complete development and runtime dependency tree is audited in PR CI and in the weekly/manual `npm audit` workflow with `npm run audit:dependencies`. Any advisory severity fails the gate. A registry or audit service error is a failed check, not a clean result.

The 10 October 2026 remediation reduced the fresh main audit from 47 findings (1 critical, 24 high) to zero findings in the candidate lockfile. The existing dependency PR supplied compatible SDK and YAML patches and tooling updates. Runtime resolutions include MCP SDK 1.32.1 and js-yaml 4.3.2; the fixture generator also emits the patched YAML dependency so rebuilding cannot restore the vulnerable requirement.

## Performance tooling

The latest published `@lhci/cli` was still 0.15.1. Its old dependency tree included vulnerable `extract-zip` and `sprintf-js` releases with no patched releases available. Downgrading the wrapper as suggested by `npm audit fix --force` would change the performance checks rather than repair this tree.

`npm run test:perf` now runs the official Lighthouse 13.5 runner through `tools/run-lighthouse.mjs`. It reads the existing `lighthouserc.json` and keeps the three pages, three runs per page, mobile screen and simulated throttling. The performance error threshold remains 0.60 with optimistic best-of-three aggregation; numeric warning thresholds and the separate 250 KB bundle gate remain in place. JSON and HTML reports and assertion results stay under `artifacts/lighthouse/` for CI upload. The separate product target remains 0.90 on a deployed mobile profile.

Missing scores, runtime errors, an unsuccessful collection or all three scores below the threshold cannot pass. Any missing warning audit is reported as missing rather than silently treated as success. Changing the performance engine can change scores even when the app is unchanged; compare the recorded Lighthouse version along with results.

## Transitive patch overrides

- `basic-ftp ^6.2.3`: patches the directory-listing denial of service still reachable through proxy-agent/get-uri's dependency requirement. The current Lighthouse browser tooling remains functional; the override should be removed when upstream requirements select a patched version themselves.
- `qs ^6.16.0`: patches query-string denial-of-service advisories in Express's older semver range. Both Express versions in the SDK tree resolve to the patched parser. MCP transport, consent/OAuth simulation, pagination and real HTTP tests verify compatibility.

These are version patches, not ignored advisories or alternate packages. Refresh the lockfile with the pinned Node runtime, inspect `npm ls qs basic-ftp`, run the full audit, and test the consumers before changing or removing either override.

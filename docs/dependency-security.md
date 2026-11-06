# Dependency security

The complete development and runtime dependency tree is audited in PR CI and in the weekly/manual `npm audit` workflow with `npm run audit:dependencies`. Any advisory severity fails the gate. A registry or audit service error is a failed check, not a clean result.

The 10 October 2026 remediation reduced the fresh main audit from 47 findings (1 critical, 24 high) to zero findings in the candidate lockfile. The existing dependency PR supplied compatible SDK and YAML patches and tooling updates. Runtime resolutions include MCP SDK 1.32.1 and js-yaml 4.3.2; the fixture generator also emits the patched YAML dependency so rebuilding cannot restore the vulnerable requirement.

## Performance tooling

The latest published `@lhci/cli` was still 0.15.1. Its old dependency tree included vulnerable `extract-zip` and `sprintf-js` releases with no patched releases available. Downgrading the wrapper as suggested by `npm audit fix --force` would change the performance checks rather than repair this tree.

`npm run test:perf` now runs the official Lighthouse 13.5 runner through `tools/run-lighthouse.mjs`. It reads the existing `lighthouserc.json` and keeps the three pages, three runs per page, mobile screen and simulated throttling. The performance error threshold remains 0.60 with optimistic best-of-three aggregation; numeric warning thresholds and the separate 250 KB bundle gate remain in place. JSON and HTML reports and assertion results stay under `artifacts/lighthouse/` for CI upload. The separate product target remains 0.90 on a deployed mobile profile.

Missing scores, runtime errors, an unsuccessful collection or all three scores below the threshold cannot pass. Any missing warning audit is reported as missing rather than silently treated as success. Changing the performance engine can change scores even when the app is unchanged; compare the recorded Lighthouse version along with results.

## November 2026 refresh

The 6 November main lockfile had 15 findings (1 critical, 4 high, 10 moderate). The refresh selects patched DOMPurify, body-parser, fast-uri, ip-address, qs, Undici, Vite, Vitest and Zod releases without adopting unrelated major tooling upgrades. Vitest's minimum is 4.1.12 in both test workspaces and Zod's minimum is 4.6.7 in the MCP package.

PostHog 1.447.2's `module.slim.js` and its source map contain no DOMPurify code. `tools/stage-site.mjs` vendors that exact file. The full SDK bundles do include DOMPurify, so the dependency tree still needs the patched 3.4.17 resolution. This inspection does not establish that every optional runtime-loaded SDK feature is unreachable, and it is not evidence of compromise.

## Transitive overrides

- `basic-ftp ^6.2.3`: retained defensively for the directory-listing denial of service previously introduced by proxy-agent/get-uri. The current lockfile no longer contains this optional dependency chain; the override prevents older requirements from restoring an affected version if it returns.
- `qs ^6.16.1`: also patches the comma-array stringification denial of service affecting 6.16.0. Both Express versions in the SDK tree resolve to the patched parser. MCP transport, consent/OAuth simulation, pagination and real HTTP tests verify compatibility.
- `minimatch@^10.0.0` to `^11.0.1`: addresses [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) in ESLint and `@eslint/config-array`. Their upstream requirements still select affected 10.x releases. This narrowly scoped major-version override leaves unaffected older minimatch consumers unchanged. Version 11 replaces the matching engine and removes some APIs; the observed ESLint consumers use only the retained `Minimatch` constructor, `match`, `pattern`, partial matching and `flipNegate`. Regression coverage checks these patterns and ESLint's source/generated-file selection. Remove the override when both upstream consumers accept a patched version directly.

These are patched versions, not ignored advisories or alternate packages. Refresh the lockfile with a supported Node runtime, inspect `npm ls qs basic-ftp minimatch`, run the full audit, and test the consumers before changing or removing an override. The minimatch override additionally requires checking that ESLint still visits the same source files.

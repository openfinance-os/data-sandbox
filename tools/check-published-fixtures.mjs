import fs from 'node:fs';
const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const res = await fetch(`https://registry.npmjs.org/@openfinance-os%2Fsandbox-fixtures/${version}`);
if (!res.ok) throw new Error(`Publish fixture ${version} before the dependent MCP release`);
const pkg = await res.json();
if (pkg.version !== version || !pkg.dist?.integrity) throw new Error('Unverified fixture release');
console.log(`Verified published fixture dependency ${version}`);

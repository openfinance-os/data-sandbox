// Official Lighthouse, without the obsolete Lighthouse CI dependency tree.
// Retains the configured three URLs, three runs, mobile simulation and gates.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import perfConfig from 'lighthouse/core/config/perf-config.js';
import { evaluateAssertions } from './lighthouse-assertions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'lighthouserc.json'), 'utf8')).ci;
const { collect } = config;
const out = path.resolve(root, config.upload.outputDir);
fs.mkdirSync(out, { recursive: true });
const [command, ...serverArgs] = collect.startServerCommand.split(' ');
if (command !== 'node') throw new Error('The Lighthouse server must be a Node command');
const server = spawn(process.execPath, serverArgs, {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const summary = [];
let chrome;
let serverError = '';
server.stderr.on('data', (chunk) => (serverError += chunk));
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Static server startup timed out')), 10_000);
    let output = '';
    server.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Static server exited (${code}): ${serverError}`));
    });
    server.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes(collect.startServerReadyPattern)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--disable-gpu'] });
  const { preset, ...settings } = collect.settings;
  if (preset !== 'perf') throw new Error('Only the existing performance preset is supported');
  for (const [urlIndex, url] of collect.url.entries()) {
    const reports = [];
    for (let run = 1; run <= collect.numberOfRuns; run++) {
      const result = await lighthouse(
        url,
        { port: chrome.port, logLevel: 'error', output: ['json', 'html'], ...settings },
        perfConfig,
      );
      if (!result || result.lhr.runtimeError)
        throw new Error(result?.lhr.runtimeError?.message ?? 'No Lighthouse result');
      const name = `${urlIndex + 1}-${new URL(url).pathname.split('/').pop()}-${run}`;
      fs.writeFileSync(path.join(out, `${name}.report.json`), JSON.stringify(result.lhr));
      fs.writeFileSync(path.join(out, `${name}.report.html`), result.report[1]);
      reports.push(result.lhr);
      console.log(`${url} run ${run}: performance ${result.lhr.categories.performance.score}`);
    }
    const assertions = evaluateAssertions(reports, config.assert.assertions);
    summary.push({ url, lighthouseVersion: reports[0].lighthouseVersion, assertions });
    for (const assertion of assertions) {
      console.log(
        `${assertion.passed ? 'PASS' : assertion.level.toUpperCase()} ${assertion.id}: ${assertion.actual ?? 'missing audit result'}`,
      );
    }
  }
  fs.writeFileSync(
    path.join(out, 'assertion-results.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );
  if (summary.some((page) => page.assertions.some((a) => a.level === 'error' && !a.passed)))
    throw new Error(
      'Lighthouse performance gate failed; see artifacts/lighthouse/assertion-results.json',
    );
} finally {
  await chrome?.kill();
  server.kill('SIGTERM');
}

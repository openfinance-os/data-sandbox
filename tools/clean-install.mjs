// Verify real distributables in temporary directories, outside workspace links.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-install-'));
const run = (bin, args, cwd = process.cwd()) =>
  execFileSync(bin, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
for (const workspace of ['sandbox-fixtures', 'sandbox-mcp']) {
  const packed = JSON.parse(
    run('npm', ['pack', `./packages/${workspace}`, '--pack-destination', out, '--json']),
  );
  const dest = path.join(out, workspace);
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, 'package.json'), '{"type":"module","private":true}');
  const fixturesTar = fs
    .readdirSync(out)
    .find((f) => f.startsWith('openfinance-os-sandbox-fixtures-'));
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      path.join(out, fixturesTar),
      ...(workspace === 'sandbox-mcp' ? [path.join(out, packed[0].filename)] : []),
    ],
    dest,
  );
  run(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { loadFixture, manifest, postedTransactions, movement } from '@openfinance-os/sandbox-fixtures'; import {createValidators,stripAnnotations} from '@openfinance-os/sandbox-fixtures/validation'; import {readFileSync} from 'node:fs'; const a=loadFixture({persona:'salaried_expat_mid',lfi:'rich',endpoint:'/accounts'}); if(!a.Data.Account.length || manifest.corpusVersion !== '0.1.0') throw Error('No fixture'); const raw=readFileSync(new URL(import.meta.resolve('@openfinance-os/sandbox-fixtures/schemas/uae-account-information-openapi.yaml')),'utf8'); if(!createValidators(raw).forEndpoint('/accounts')(stripAnnotations(a))) throw Error('Invalid external fixture'); const tx=loadFixture({persona:'salaried_expat_mid',lfi:'rich',endpoint:'/accounts/'+a.Data.Account[0].AccountId+'/transactions'}).Data.Transaction; const booked=postedTransactions(tx,{now:manifest.nowAnchor}); const expected=booked.reduce((n,t)=>n+Number(t.Amount.Amount.replace('.',''))*(t.CreditDebitIndicator==='Credit'?1:-1),0); if(movement(booked)!==expected) throw Error('External calculation mismatch');`,
    ],
    dest,
  );
  if (workspace === 'sandbox-fixtures') {
    fs.writeFileSync(
      path.join(dest, 'client.ts'),
      `import {manifest,scenarioDescriptor,queryTransactions,minorUnits} from '@openfinance-os/sandbox-fixtures';\nimport {createValidators} from '@openfinance-os/sandbox-fixtures/validation';\nimport type {AEReadAccount} from '@openfinance-os/sandbox-fixtures/payloads/banking';\nimport type {AEInsuranceResourceIdentifierType} from '@openfinance-os/sandbox-fixtures/payloads/insurance';\nconst scenario=scenarioDescriptor({personaId:'x',lfi:'rich',seed:1});\nconst revision:string=manifest.revision;\nconst policy:AEInsuranceResourceIdentifierType='POL-42';\nconst validator=createValidators('raw').forEndpoint('/accounts');\nconst amount:number=minorUnits('0.10','AED');\nqueryTransactions({Data:{Transaction:[]},_scenario:scenario},{cursor:'x',currency:'AED',status:'Booked'});\n// @ts-expect-error amounts are decimal strings\nminorUnits(10,'AED');\n// @ts-expect-error profile must be supported\nscenarioDescriptor({personaId:'x',lfi:'unknown',seed:1});\n`,
    );
    run(
      process.execPath,
      [
        path.resolve('node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        'client.ts',
      ],
      dest,
    );
    console.log('External TypeScript payload, core and validator exports passed');
  }
  if (workspace === 'sandbox-mcp')
    run('node', ['node_modules/@openfinance-os/sandbox-mcp/src/index.mjs', '--help'], dest);
  console.log(`Clean npm install passed: ${workspace}`);
}
run('python3', [
  '-m',
  'pip',
  'wheel',
  '--no-deps',
  './packages/sandbox-fixtures-py',
  '--wheel-dir',
  out,
]);
const py = path.join(out, 'venv');
run('python3', ['-m', 'venv', py]);
const wheel = fs.readdirSync(out).find((f) => f.endsWith('.whl'));
run(path.join(py, 'bin/pip'), ['install', '--no-deps', path.join(out, wheel)]);
run(
  path.join(py, 'bin/python'),
  [
    '-c',
    "from openfinance_os_sandbox_fixtures import load_fixture; a=load_fixture(persona='salaried_expat_mid',lfi='rich',endpoint='/accounts'); assert a['Data']['Account']; assert a['_scenario']['corpusVersion']=='0.1.0'",
  ],
  out,
);
console.log(`Clean wheel install passed. Artifacts: ${out}`);

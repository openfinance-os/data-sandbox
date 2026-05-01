// Workstream C plug-point 3 — minimal STORE-only zip writer + fixture
// matrix exporter.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildZip, crc32 } from '../src/persona-builder/zip-writer.js';
import { buildCustomFixtureZip } from '../src/persona-builder/export-zip.js';
import { loadAllPools } from '../tools/load-fixtures.mjs';

describe('zip-writer', () => {
  it('crc32 matches a known reference', () => {
    // CRC32 of "123456789" is 0xCBF43926 — the standard test vector.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('builds a zip whose end-of-central-directory has the magic signature', () => {
    const zip = buildZip([
      { path: 'a.txt', bytes: new TextEncoder().encode('hello') },
      { path: 'sub/b.json', bytes: new TextEncoder().encode('{"x":1}') },
    ]);
    // EOCD signature = PK\x05\x06 (50 4B 05 06) at the start of the last 22
    // bytes when there's no trailing comment.
    expect(zip[zip.length - 22]).toBe(0x50);
    expect(zip[zip.length - 21]).toBe(0x4b);
    expect(zip[zip.length - 20]).toBe(0x05);
    expect(zip[zip.length - 19]).toBe(0x06);
    // First 4 bytes: local file header signature PK\x03\x04 (50 4B 03 04).
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });

  it('produces a zip the system unzip(1) can list and extract', () => {
    if (!hasUnzip()) return; // skip in environments without unzip
    const zip = buildZip([
      { path: 'hello.txt', bytes: new TextEncoder().encode('world') },
      { path: 'data/payload.json', bytes: new TextEncoder().encode('{"k":42}') },
    ]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-writer-'));
    const zipPath = path.join(dir, 'out.zip');
    fs.writeFileSync(zipPath, zip);
    const listing = execSync(`unzip -l "${zipPath}"`).toString();
    expect(listing).toContain('hello.txt');
    expect(listing).toContain('data/payload.json');
    execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: 'pipe' });
    expect(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8')).toBe('world');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'data/payload.json'), 'utf8'))).toEqual({ k: 42 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildCustomFixtureZip — Workstream C plug-point 3', () => {
  const pools = loadAllPools();
  const recipe = { segment: 'SME' };

  it('emits the layout-identical /fixtures/v1/bundles/<persona>/... tree', () => {
    const { bytes, filename, manifest } = buildCustomFixtureZip({
      recipe,
      pools,
      seed: 1,
      now: new Date(Date.UTC(2026, 3, 1)),
    });
    expect(filename).toMatch(/^custom_[a-z0-9]+-fixtures\.zip$/);
    expect(manifest.persona).toMatch(/^custom_/);
    expect(Object.keys(manifest.fixtures).length).toBe(3); // 3 LFIs
    expect(bytes.length).toBeGreaterThan(1000);

    // Inflate via system unzip and assert the on-disk layout.
    if (!hasUnzip()) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixzip-'));
    const zipPath = path.join(dir, 'out.zip');
    fs.writeFileSync(zipPath, bytes);
    execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: 'pipe' });
    const personaSlug = manifest.persona;
    const accountsRich = JSON.parse(
      fs.readFileSync(
        path.join(dir, 'fixtures/v1/bundles', personaSlug, 'rich/seed-1/accounts.json'),
        'utf8'
      )
    );
    expect(accountsRich.Data.Account[0].AccountType).toBe('SME');
    expect(accountsRich._persona).toBe(personaSlug);

    const topManifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'fixtures/v1/manifest.json'), 'utf8')
    );
    expect(topManifest.specVersion).toBe('v2.1');
    expect(topManifest.recipeHash).toMatch(/^[a-z0-9]+$/);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('determinism: same recipe + seed + now produces byte-identical zip', () => {
    const args = { recipe, pools, seed: 1, now: new Date(Date.UTC(2026, 3, 1)) };
    const a = buildCustomFixtureZip(args);
    const b = buildCustomFixtureZip(args);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

function hasUnzip() {
  try {
    execSync('which unzip', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

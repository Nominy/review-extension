import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createManifest, getBuildConfig, getPackageVersion } from '../scripts/build-config.mjs';

const rootDir = fileURLToPath(new URL('../', import.meta.url));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function readZipEntryNames(zipPath) {
  const archive = fs.readFileSync(zipPath);
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'ZIP must contain an end-of-central-directory record');
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const names = new Set();
  for (let index = 0; index < count; index += 1) {
    assert.equal(archive.readUInt32LE(offset), 0x02014b50, 'ZIP directory entry must have a valid signature');
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    names.add(archive.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

test('release manifest matches package version and minimum permissions', () => {
  const manifest = createManifest('release');

  assert.equal(manifest.version, getPackageVersion());
  assert.equal(manifest.name, 'Babel Review Helper');
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://dashboard.babel.audio/*', 'https://reviewgen.ovh/*']);
  assert.equal(
    manifest.web_accessible_resources[0].resources.some((resource) => resource.endsWith('.map')),
    false
  );
});

test('dev manifest preserves localhost access for local iteration', () => {
  const manifest = createManifest('dev');
  assert.equal(manifest.name.includes('(Dev)'), true);
  assert.equal(manifest.host_permissions.includes('http://127.0.0.1/*'), true);
  assert.equal(manifest.host_permissions.includes('http://localhost/*'), true);
});

test('root manifest references tracked icon assets for local unpacked loading', () => {
  const manifest = readJson(path.resolve(rootDir, 'manifest.json'));
  const iconPaths = [
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {})
  ];

  assert.ok(iconPaths.length > 0);
  for (const iconPath of iconPaths) {
    assert.equal(
      fs.existsSync(path.resolve(rootDir, iconPath)),
      true,
      `root manifest icon should exist: ${iconPath}`
    );
  }
});

test('release pack includes all manifest-referenced files and excludes sourcemaps', () => {
  const buildConfig = getBuildConfig('release');
  const zipPath = path.resolve(rootDir, '.artifacts', `${buildConfig.artifactBaseName}-${buildConfig.version}.zip`);

  execFileSync('node', ['esbuild.config.mjs', '--flavor', 'release'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  execFileSync('node', ['scripts/pack.mjs', '--flavor', 'release', '--no-build'], {
    cwd: rootDir,
    stdio: 'ignore'
  });

  const manifest = readJson(path.resolve(rootDir, 'build', 'release', 'manifest.json'));
  const entries = readZipEntryNames(zipPath);
  const requiredFiles = [
    'manifest.json',
    'options.html',
    'dist/content/entry.js',
    'dist/content/page-bridge.js',
    'dist/options/entry.js',
    manifest.options_page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((entry) => [...(entry.js || []), ...(entry.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || [])
  ].filter(Boolean);

  for (const file of requiredFiles) {
    assert.equal(entries.has(file), true, `release ZIP must include ${file}`);
  }
  assert.equal(entries.has('session.html'), false, 'retired page must not be packaged');
  assert.equal(entries.has('dist/session/entry.js'), false, 'retired page bundle must not be packaged');
  assert.deepEqual([...entries].filter((entry) => entry.endsWith('.map')), []);
});

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

test('release pack includes all manifest-referenced files and excludes sourcemaps', () => {
  const buildConfig = getBuildConfig('release');
  const zipPath = path.resolve(rootDir, '..', `${buildConfig.artifactBaseName}-${buildConfig.version}.zip`);

  execFileSync('node', ['esbuild.config.mjs', '--flavor', 'release'], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  execFileSync('node', ['scripts/pack.mjs', '--flavor', 'release', '--no-build'], {
    cwd: rootDir,
    stdio: 'ignore'
  });

  const manifest = readJson(path.resolve(rootDir, 'build', 'release', 'manifest.json'));
  const zipText = fs.readFileSync(zipPath).toString('utf8');

  assert.match(zipText, /manifest\.json/);
  assert.match(zipText, /options\.html/);
  assert.match(zipText, /session\.html/);

  for (const iconPath of Object.values(manifest.icons || {})) {
    const escaped = String(iconPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(zipText, new RegExp(escaped));
  }

  assert.equal(/\.map/.test(zipText), false);
});

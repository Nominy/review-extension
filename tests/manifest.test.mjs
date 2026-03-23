import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('manifest targets bundled dist assets', () => {
  const raw = fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.content_scripts[0].js[0], 'dist/content/entry.js');
  assert.equal(manifest.web_accessible_resources[0].resources[0], 'dist/content/page-bridge.js');
  assert.equal(manifest.permissions.includes('storage'), true);
  assert.equal(manifest.options_page, 'options.html');
});

test('manifest matches dashboard transcription routes', () => {
  const raw = fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
  const manifest = JSON.parse(raw);

  assert.equal(manifest.content_scripts[0].matches.includes('https://dashboard.babel.audio/*'), true);
  assert.equal(
    manifest.web_accessible_resources[0].matches.includes('https://dashboard.babel.audio/*'),
    true
  );
});

test('pack includes static pages referenced by manifest', () => {
  const rootDir = new URL('../', import.meta.url);
  const zipPath = path.resolve(fileURLToPath(rootDir), '..', 'review-interceptor-extension-0.3.0.zip');

  execFileSync('node', ['scripts/pack.mjs', '--no-build'], {
    cwd: rootDir,
    stdio: 'ignore'
  });

  const zipText = fs.readFileSync(zipPath).toString('utf8');

  assert.match(zipText, /manifest\.json/);
  assert.match(zipText, /options\.html/);
  assert.match(zipText, /session\.html/);
});

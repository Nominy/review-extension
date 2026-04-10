import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const REQUIRED_FILES = [
  'src/core/constants.ts',
  'src/core/types.ts',
  'src/core/storage.ts',
  'src/core/backend-client.ts',
  'src/core/kernel.ts',
  'src/core/lifecycle.ts',
  'src/core/runtime-config.ts',
  'src/core/build-flavor.ts',
  'src/parsers/review-action-parser.ts',
  'src/services/page-bridge-service.ts',
  'src/services/review-dialog-service.tsx',
  'src/services/review-form-service.ts',
  'src/content/entry.ts',
  'src/content/page-bridge.ts',
  'src/session/entry.tsx',
  'src/options/entry.tsx',
  'src/ui/review-workspace-store.tsx',
  'src/ui/review-workspace.tsx',
  'src/ui/styles.ts',
  'scripts/build-config.mjs',
  'scripts/pack.mjs',
  'assets/icons/icon-16.png',
  'assets/icons/icon-32.png',
  'assets/icons/icon-48.png',
  'assets/icons/icon-128.png',
  'session.html',
  'options.html'
];

test('release refactor files exist', () => {
  for (const relPath of REQUIRED_FILES) {
    assert.equal(fs.existsSync(new URL('../' + relPath, import.meta.url)), true, `${relPath} should exist`);
  }
});

test('review form service supports 4-category review forms', () => {
  const source = fs.readFileSync(new URL('../src/services/review-form-service.ts', import.meta.url), 'utf8');

  assert.match(source, /const MIN_REVIEW_TEXTAREAS = 4;/);
  assert.match(source, /count >= MIN_REVIEW_TEXTAREAS/);
});

test('release options page advertises production lock', () => {
  const source = fs.readFileSync(new URL('../src/options/entry.tsx', import.meta.url), 'utf8');
  assert.match(source, /Chrome Web Store build is locked to the production backend/);
});

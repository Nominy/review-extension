#!/usr/bin/env node

import { resolve } from 'node:path';
import { runPublishCws } from '@nominy/babel-extension-build';

const rootDir = resolve(import.meta.dirname, '..');

await runPublishCws({
  rootDir,
  defaultZipPath(version) {
    return resolve(rootDir, '.artifacts', `babel-review-helper-${version}.zip`);
  },
  usageZipLine: '.artifacts/babel-review-helper-<version>.zip'
});

#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectFiles, packExtension } from '@nominy/babel-extension-build';
import { assertManifestMatchesFlavor, getBuildConfig } from './build-config.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const skipBuild = process.argv.includes('--no-build');
const flavorArgIndex = process.argv.findIndex((item) => item === '--flavor');
const flavor =
  flavorArgIndex >= 0 && process.argv[flavorArgIndex + 1]
    ? process.argv[flavorArgIndex + 1]
    : 'release';

const buildConfig = getBuildConfig(flavor);
const buildDir = resolve(ROOT, 'build', buildConfig.flavor);

await packExtension({
  rootDir: ROOT,
  skipBuild,
  buildCommand: {
    command: 'node',
    args: ['esbuild.config.mjs', '--flavor', buildConfig.flavor]
  },
  collectPackResult() {
    const manifestRaw = readFileSync(resolve(buildDir, 'manifest.json'), 'utf-8').replace(/^\uFEFF/, '');
    const manifest = JSON.parse(manifestRaw);
    assertManifestMatchesFlavor(manifest, buildConfig.flavor);

    const files = collectFiles(buildDir, '')
      .filter((entry) => entry.rel)
      .filter((entry) => !entry.rel.endsWith('.map'))
      .map((entry) => ({ full: entry.full, rel: entry.rel }));

    validateManifestAssets(manifest, files);

    return {
      entries: files,
      zipName: `${buildConfig.artifactBaseName}-${manifest.version}.zip`,
      zipOutputDir: process.env.BABEL_EXTENSION_ZIP_DIR ?? '.artifacts',
      zipPath: process.env.BABEL_EXTENSION_ZIP_PATH
    };
  }
});

function validateManifestAssets(manifest, entries) {
  const packagedFiles = new Set(entries.map((entry) => entry.rel.replace(/\\/g, '/')));
  const requiredFiles = ['manifest.json', 'options.html', 'session.html'];
  const iconFiles = Object.values(manifest.icons || {});
  const contentFiles = (manifest.content_scripts || []).flatMap((entry) => entry.js || []);
  const webResources = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []);

  for (const rel of [...requiredFiles, ...iconFiles, ...contentFiles, ...webResources]) {
    if (!packagedFiles.has(rel)) {
      throw new Error(`Package is missing manifest-referenced asset: ${rel}`);
    }
    if (!existsSync(resolve(buildDir, rel))) {
      throw new Error(`Expected build asset is missing on disk: ${rel}`);
    }
  }
}

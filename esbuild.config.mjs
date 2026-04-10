import { build, context } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createManifest, getBuildConfig } from './scripts/build-config.mjs';

const ROOT = resolve(import.meta.dirname);
const watch = process.argv.includes('--watch');
const flavorArgIndex = process.argv.findIndex((item) => item === '--flavor');
const flavor =
  flavorArgIndex >= 0 && process.argv[flavorArgIndex + 1]
    ? process.argv[flavorArgIndex + 1]
    : 'dev';

const buildConfig = getBuildConfig(flavor);
const buildDir = resolve(ROOT, 'build', buildConfig.flavor);
const distDir = resolve(buildDir, 'dist');

const shared = {
  bundle: true,
  minify: buildConfig.minify,
  sourcemap: buildConfig.sourcemap,
  target: 'chrome114',
  format: 'iife',
  logLevel: 'info',
  define: {
    __BUILD_FLAVOR__: JSON.stringify(buildConfig.flavor),
    __DEFAULT_BACKEND_BASE_URL__: JSON.stringify(buildConfig.defaultBackendBaseUrl),
    __DEFAULT_BACKEND_BASE_URL_FALLBACKS__: JSON.stringify(buildConfig.defaultBackendBaseUrlFallbacks),
    __ALLOW_BACKEND_OVERRIDES__: JSON.stringify(buildConfig.allowBackendOverrides),
    __ENABLE_SUBMIT_ANALYTICS__: JSON.stringify(buildConfig.enableSubmitAnalytics)
  }
};

const tasks = [
  {
    ...shared,
    entryPoints: ['src/content/entry.ts'],
    outfile: resolve(distDir, 'content', 'entry.js')
  },
  {
    ...shared,
    entryPoints: ['src/content/page-bridge.ts'],
    outfile: resolve(distDir, 'content', 'page-bridge.js')
  },
  {
    ...shared,
    entryPoints: ['src/session/entry.tsx'],
    outfile: resolve(distDir, 'session', 'entry.js')
  },
  {
    ...shared,
    entryPoints: ['src/options/entry.tsx'],
    outfile: resolve(distDir, 'options', 'entry.js')
  }
];

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function cleanBuildDirectory() {
  rmSync(buildDir, { recursive: true, force: true });
  ensureDirectory(distDir);
}

function copyStaticFiles() {
  const staticFiles = ['options.html', 'session.html'];
  for (const file of staticFiles) {
    cpSync(resolve(ROOT, file), resolve(buildDir, file));
  }

  const iconEntries = Object.values(buildConfig.icons);
  for (const relativeIconPath of iconEntries) {
    const source = resolve(ROOT, 'assets', relativeIconPath);
    const target = resolve(buildDir, relativeIconPath);
    ensureDirectory(dirname(target));
    cpSync(source, target);
  }
}

function writeManifest() {
  const manifest = createManifest(buildConfig.flavor);
  writeFileSync(resolve(buildDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function prepareBuildDirectory() {
  cleanBuildDirectory();
  copyStaticFiles();
  writeManifest();
}

async function runBuild() {
  prepareBuildDirectory();
  await Promise.all(tasks.map((options) => build(options)));
}

if (watch) {
  prepareBuildDirectory();
  const contexts = await Promise.all(tasks.map((options) => context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`Watching ${buildConfig.flavor} extension bundles in ${buildDir}...`);
} else {
  await runBuild();
  const createdFiles = readdirSync(buildDir, { withFileTypes: true }).map((entry) => entry.name);
  if (!existsSync(resolve(buildDir, 'manifest.json'))) {
    throw new Error(`Missing generated manifest for ${buildConfig.flavor} build.`);
  }
  console.log(`Built ${buildConfig.flavor} extension into ${buildDir}`);
  console.log(`Top-level outputs: ${createdFiles.join(', ')}`);
}

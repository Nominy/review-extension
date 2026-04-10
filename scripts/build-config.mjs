import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGE_JSON_PATH = resolve(ROOT, 'package.json');

const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8').replace(/^\uFEFF/, ''));

const SHARED_DESCRIPTION =
  'Review helper for Babel transcription reviews with guided review sessions and one-click feedback application.';

const SHARED_CONTENT_MATCHES = ['https://dashboard.babel.audio/*'];
const SHARED_PERMISSIONS = ['storage'];

const FLAVOR_CONFIG = {
  dev: {
    flavor: 'dev',
    extensionName: 'Babel Review Helper (Dev)',
    artifactBaseName: 'babel-review-helper-dev',
    description: `${SHARED_DESCRIPTION} Development build with configurable backend endpoints.`,
    defaultBackendBaseUrl: 'https://reviewgen.ovh',
    defaultBackendBaseUrlFallbacks: ['http://127.0.0.1:3001', 'http://localhost:3001'],
    hostPermissions: [
      'https://dashboard.babel.audio/*',
      'https://reviewgen.ovh/*',
      'http://127.0.0.1/*',
      'http://localhost/*'
    ],
    allowBackendOverrides: true,
    enableSubmitAnalytics: true,
    minify: false,
    sourcemap: true
  },
  release: {
    flavor: 'release',
    extensionName: 'Babel Review Helper',
    artifactBaseName: 'babel-review-helper',
    description: SHARED_DESCRIPTION,
    defaultBackendBaseUrl: 'https://reviewgen.ovh',
    defaultBackendBaseUrlFallbacks: [],
    hostPermissions: ['https://dashboard.babel.audio/*', 'https://reviewgen.ovh/*'],
    allowBackendOverrides: false,
    enableSubmitAnalytics: false,
    minify: true,
    sourcemap: false
  }
};

export const BUILD_FLAVORS = Object.freeze(Object.keys(FLAVOR_CONFIG));

export function getPackageVersion() {
  return String(packageJson.version || '').trim();
}

export function getBuildConfig(flavor = 'dev') {
  const normalizedFlavor = String(flavor || 'dev').trim();
  const config = FLAVOR_CONFIG[normalizedFlavor];
  if (!config) {
    throw new Error(`Unknown build flavor: ${normalizedFlavor}`);
  }

  const version = getPackageVersion();
  if (!version) {
    throw new Error('package.json version is required.');
  }

  return {
    ...config,
    version,
    permissions: [...SHARED_PERMISSIONS],
    contentMatches: [...SHARED_CONTENT_MATCHES],
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png'
    }
  };
}

export function createManifest(flavor = 'dev') {
  const config = getBuildConfig(flavor);
  return {
    manifest_version: 3,
    name: config.extensionName,
    version: config.version,
    description: config.description,
    permissions: [...config.permissions],
    host_permissions: [...config.hostPermissions],
    icons: { ...config.icons },
    action: {
      default_title: config.extensionName,
      default_icon: { ...config.icons }
    },
    options_page: 'options.html',
    content_scripts: [
      {
        matches: [...config.contentMatches],
        js: ['dist/content/entry.js'],
        run_at: 'document_idle'
      }
    ],
    web_accessible_resources: [
      {
        resources: ['dist/content/page-bridge.js', 'session.html', 'dist/session/entry.js'],
        matches: [...config.contentMatches]
      }
    ]
  };
}

export function assertManifestMatchesFlavor(manifest, flavor = 'dev') {
  const config = getBuildConfig(flavor);
  const expectedManifest = createManifest(flavor);

  if (manifest.manifest_version !== 3) {
    throw new Error('Manifest must use MV3.');
  }

  if (manifest.version !== config.version) {
    throw new Error(`Manifest version ${manifest.version} does not match package version ${config.version}.`);
  }

  if (manifest.name !== config.extensionName) {
    throw new Error(`Manifest name ${manifest.name} does not match expected ${config.extensionName}.`);
  }

  if (JSON.stringify(manifest.permissions || []) !== JSON.stringify(expectedManifest.permissions)) {
    throw new Error(`Unexpected permissions for ${flavor} manifest.`);
  }

  if (JSON.stringify(manifest.host_permissions || []) !== JSON.stringify(expectedManifest.host_permissions)) {
    throw new Error(`Unexpected host permissions for ${flavor} manifest.`);
  }

  const resources =
    manifest.web_accessible_resources?.flatMap((entry) => (Array.isArray(entry.resources) ? entry.resources : [])) || [];

  if (resources.some((resource) => String(resource).includes('.map'))) {
    throw new Error('Manifest must not expose sourcemaps as web accessible resources.');
  }

  if (flavor === 'release') {
    const hostPermissions = manifest.host_permissions || [];
    if (hostPermissions.some((item) => /localhost|127\.0\.0\.1/i.test(String(item)))) {
      throw new Error('Release manifest must not include localhost permissions.');
    }
    if (String(manifest.name).includes('(Dev)')) {
      throw new Error('Release manifest must not contain dev branding.');
    }
  }
}

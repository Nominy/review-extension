#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createDeflateRaw } from 'node:zlib';
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

if (!skipBuild) {
  console.log(`Building ${buildConfig.flavor} package...`);
  execFileSync('node', ['esbuild.config.mjs', '--flavor', buildConfig.flavor], {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

const manifestRaw = readFileSync(join(buildDir, 'manifest.json'), 'utf-8').replace(/^\uFEFF/, '');
const manifest = JSON.parse(manifestRaw);
assertManifestMatchesFlavor(manifest, buildConfig.flavor);

const zipName = `${buildConfig.artifactBaseName}-${manifest.version}.zip`;
const zipOutputDir = process.env.BABEL_EXTENSION_ZIP_DIR
  ? resolve(ROOT, process.env.BABEL_EXTENSION_ZIP_DIR)
  : resolve(ROOT, '.artifacts');
const zipPath = process.env.BABEL_EXTENSION_ZIP_PATH
  ? resolve(ROOT, process.env.BABEL_EXTENSION_ZIP_PATH)
  : resolve(zipOutputDir, zipName);

function collectFiles(dir, base) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = join(base, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, rel));
    } else {
      results.push({ full, rel });
    }
  }
  return results;
}

function validateManifestAssets(entries) {
  const packagedFiles = new Set(entries.map((entry) => entry.rel.replace(/\\/g, '/')));
  const requiredFiles = ['manifest.json', 'options.html', 'session.html'];
  const iconFiles = Object.values(manifest.icons || {});
  const contentFiles = (manifest.content_scripts || []).flatMap((entry) => entry.js || []);
  const webResources = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []);

  for (const rel of [...requiredFiles, ...iconFiles, ...contentFiles, ...webResources]) {
    if (!packagedFiles.has(rel)) {
      throw new Error(`Package is missing manifest-referenced asset: ${rel}`);
    }
  }
}

const files = collectFiles(buildDir, '')
  .filter((entry) => entry.rel)
  .filter((entry) => !entry.rel.endsWith('.map'))
  .map((entry) => ({ full: entry.full, rel: entry.rel }));

validateManifestAssets(files);

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getSeconds() >> 1) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: day };
}

function writeUInt32LE(buf, val, off) {
  buf.writeUInt32LE(val >>> 0, off);
}

function writeUInt16LE(buf, val, off) {
  buf.writeUInt16LE(val & 0xffff, off);
}

async function deflate(data) {
  const chunks = [];
  const deflater = createDeflateRaw({ level: 9 });
  deflater.on('data', (chunk) => chunks.push(chunk));
  deflater.end(data);
  await new Promise((resolvePromise, rejectPromise) => {
    deflater.on('end', resolvePromise);
    deflater.on('error', rejectPromise);
  });
  return Buffer.concat(chunks);
}

async function createZip(outPath, entries) {
  mkdirSync(zipOutputDir, { recursive: true });
  const centralHeaders = [];
  let offset = 0;
  const parts = [];
  const { time: dosTime, date: dosDate } = dosDateTime(new Date());

  for (const { rel, full } of entries) {
    if (!existsSync(full)) {
      throw new Error(`Missing file during zip creation: ${full}`);
    }

    const raw = readFileSync(full);
    const crc = crc32(raw);
    const compressed = await deflate(raw);
    const useDeflate = compressed.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const stored = useDeflate ? compressed : raw;
    const nameBytes = Buffer.from(rel.replace(/\\/g, '/'), 'utf-8');

    const local = Buffer.alloc(30 + nameBytes.length);
    writeUInt32LE(local, 0x04034b50, 0);
    writeUInt16LE(local, 20, 4);
    writeUInt16LE(local, 0, 6);
    writeUInt16LE(local, method, 8);
    writeUInt16LE(local, dosTime, 10);
    writeUInt16LE(local, dosDate, 12);
    writeUInt32LE(local, crc, 14);
    writeUInt32LE(local, stored.length, 18);
    writeUInt32LE(local, raw.length, 22);
    writeUInt16LE(local, nameBytes.length, 26);
    writeUInt16LE(local, 0, 28);
    nameBytes.copy(local, 30);
    parts.push(local, stored);

    const central = Buffer.alloc(46 + nameBytes.length);
    writeUInt32LE(central, 0x02014b50, 0);
    writeUInt16LE(central, 20, 4);
    writeUInt16LE(central, 20, 6);
    writeUInt16LE(central, 0, 8);
    writeUInt16LE(central, method, 10);
    writeUInt16LE(central, dosTime, 12);
    writeUInt16LE(central, dosDate, 14);
    writeUInt32LE(central, crc, 16);
    writeUInt32LE(central, stored.length, 20);
    writeUInt32LE(central, raw.length, 24);
    writeUInt16LE(central, nameBytes.length, 28);
    writeUInt16LE(central, 0, 30);
    writeUInt16LE(central, 0, 32);
    writeUInt16LE(central, 0, 34);
    writeUInt16LE(central, 0, 36);
    writeUInt32LE(central, 0, 38);
    writeUInt32LE(central, offset, 42);
    nameBytes.copy(central, 46);
    centralHeaders.push(central);

    offset += local.length + stored.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const header of centralHeaders) {
    parts.push(header);
    centralSize += header.length;
  }

  const eocd = Buffer.alloc(22);
  writeUInt32LE(eocd, 0x06054b50, 0);
  writeUInt16LE(eocd, 0, 4);
  writeUInt16LE(eocd, 0, 6);
  writeUInt16LE(eocd, entries.length, 8);
  writeUInt16LE(eocd, entries.length, 10);
  writeUInt32LE(eocd, centralSize, 12);
  writeUInt32LE(eocd, centralStart, 16);
  writeUInt16LE(eocd, 0, 20);
  parts.push(eocd);

  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, Buffer.concat(parts));
}

console.log(`Packing ${buildConfig.flavor} build from ${buildDir}`);
for (const file of files) {
  console.log(`  ${file.rel}`);
}

await createZip(zipPath, files);
const stat = statSync(zipPath);
console.log(`\nCreated ${zipName} (${(stat.size / 1024).toFixed(1)} KB)`);

#!/usr/bin/env node
// Sets the plugin version in manifest.json, package.json and versions.json.
//
//   node scripts/version.mjs patch | minor | major | 1.2.3
//
// Prints the new version. Obsidian reads manifest.json from the default
// branch and downloads the release whose tag equals that version.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const write = (file, data) => writeFileSync(join(root, file), `${JSON.stringify(data, null, 2)}\n`);

const manifest = read('manifest.json');
const [major, minor, patch] = manifest.version.split('.').map(Number);
const arg = process.argv[2] ?? 'patch';
const next = /^\d+\.\d+\.\d+$/.test(arg)
  ? arg
  : arg === 'major' ? `${major + 1}.0.0`
  : arg === 'minor' ? `${major}.${minor + 1}.0`
  : arg === 'patch' ? `${major}.${minor}.${patch + 1}`
  : null;
if (!next) {
  console.error(`Expected patch, minor, major or a version, got ${arg}.`);
  process.exit(1);
}

manifest.version = next;
write('manifest.json', manifest);
const pkg = read('package.json');
pkg.version = next;
write('package.json', pkg);
const versions = read('versions.json');
versions[next] = manifest.minAppVersion;
write('versions.json', versions);
console.log(next);

#!/usr/bin/env node
// Manages the Vellum core checkout the plugin is built from.
//
//   node scripts/core.mjs fetch        check out the commit pinned in vellum-core.json
//   node scripts/core.mjs check        fail if the checkout or package.json drifted from the pin
//   node scripts/core.mjs sync         copy core's locked dependency versions into package.json
//   node scripts/core.mjs latest       print the newest core release tag
//   node scripts/core.mjs pin [tag]    pin a release (default: the newest), fetch it and sync
//
// VELLUM_CORE_DIR points the build at another checkout (for example a local
// working tree) instead of vendor/vellum. `fetch` then only checks it exists.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pinPath = join(root, 'vellum-core.json');
const packagePath = join(root, 'package.json');

// Packages the plugin bundles or builds core with. Their versions must match
// core's lockfile so the editor ships with the code core was tested against.
const SHIPPED_TOOLCHAIN = ['react', 'react-dom'];
const BUILD_TOOLCHAIN = [
  '@types/react',
  '@types/react-dom',
  '@vitejs/plugin-react',
  'autoprefixer',
  'postcss',
  'tailwindcss',
  'typescript',
  'vite',
];
// Runtime dependencies of the plugin itself, kept when core's list changes.
const OWN_DEPENDENCIES = ['fflate'];

export function readPin() {
  return JSON.parse(readFileSync(pinPath, 'utf8'));
}

export function coreDir() {
  return process.env.VELLUM_CORE_DIR ? resolve(process.env.VELLUM_CORE_DIR) : join(root, 'vendor', 'vellum');
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function fetchCore() {
  const dir = coreDir();
  if (process.env.VELLUM_CORE_DIR) {
    if (!existsSync(join(dir, 'src', 'index.ts'))) throw new Error(`VELLUM_CORE_DIR has no Vellum source: ${dir}`);
    console.log(`Using Vellum core at ${dir}`);
    return;
  }
  const pin = readPin();
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    git(['init', '--quiet', dir]);
    git(['-C', dir, 'remote', 'add', 'origin', pin.repository]);
  }
  if (git(['-C', dir, 'status', '--porcelain'])) {
    throw new Error(`${dir} has local changes. Commit or discard them before fetching another core revision.`);
  }
  let head = '';
  try { head = git(['-C', dir, 'rev-parse', 'HEAD']); } catch { /* empty repository */ }
  if (head === pin.commit) {
    console.log(`Vellum core ${pin.tag} (${pin.commit.slice(0, 7)}) is checked out.`);
    return;
  }
  git(['-C', dir, 'remote', 'set-url', 'origin', pin.repository]);
  git(['-C', dir, 'fetch', '--quiet', '--depth', '1', 'origin', pin.commit]);
  git(['-C', dir, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  console.log(`Checked out Vellum core ${pin.tag} (${pin.commit.slice(0, 7)}).`);
}

function lockedVersions(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const version = (name) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry?.version) throw new Error(`Core's lockfile has no entry for ${name}.`);
    return entry.version;
  };
  return { pkg, version };
}

/** The dependency sections package.json should have for the current core. */
export function expectedDependencies(current, dir = coreDir()) {
  const { pkg, version } = lockedVersions(dir);
  const dependencies = {};
  for (const name of Object.keys(pkg.dependencies ?? {})) dependencies[name] = version(name);
  for (const name of SHIPPED_TOOLCHAIN) dependencies[name] = version(name);
  for (const name of OWN_DEPENDENCIES) {
    if (current.dependencies?.[name]) dependencies[name] = current.dependencies[name];
  }
  const devDependencies = { ...current.devDependencies };
  for (const name of BUILD_TOOLCHAIN) devDependencies[name] = version(name);
  const sort = (record) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return { dependencies: sort(dependencies), devDependencies: sort(devDependencies) };
}

function dependencyDrift() {
  const current = JSON.parse(readFileSync(packagePath, 'utf8'));
  const expected = expectedDependencies(current);
  const drift = [];
  for (const section of ['dependencies', 'devDependencies']) {
    const have = current[section] ?? {};
    const want = expected[section];
    for (const [name, value] of Object.entries(want)) {
      if (have[name] !== value) drift.push(`${section}.${name}: ${have[name] ?? 'missing'} -> ${value}`);
    }
    for (const name of Object.keys(have)) {
      if (!(name in want)) drift.push(`${section}.${name}: ${have[name]} -> removed`);
    }
  }
  return { current, expected, drift };
}

function sync() {
  const { current, expected, drift } = dependencyDrift();
  if (!drift.length) {
    console.log('package.json matches core.');
    return false;
  }
  writeFileSync(packagePath, `${JSON.stringify({ ...current, ...expected }, null, 2)}\n`);
  console.log(`Updated package.json:\n  ${drift.join('\n  ')}`);
  return true;
}

function check() {
  const problems = [];
  if (!process.env.VELLUM_CORE_DIR) {
    const pin = readPin();
    const head = git(['-C', coreDir(), 'rev-parse', 'HEAD']);
    if (head !== pin.commit) problems.push(`vendor/vellum is at ${head}, vellum-core.json pins ${pin.commit}`);
  }
  problems.push(...dependencyDrift().drift);
  if (problems.length) {
    console.error(`Core drift:\n  ${problems.join('\n  ')}\nRun \`npm run core -- sync\` and \`npm install\`.`);
    process.exit(1);
  }
  console.log('Core checkout and dependencies match the pin.');
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Release tags on the core repository, newest first, with peeled commits. */
export function releaseTags(repository = readPin().repository) {
  const lines = git(['ls-remote', '--tags', repository, 'v*']).split('\n').filter(Boolean);
  const tags = new Map();
  for (const line of lines) {
    const [sha, ref] = line.split('\t');
    const match = /^refs\/tags\/v(\d+\.\d+\.\d+)(\^\{\})?$/.exec(ref);
    if (!match) continue;
    const entry = tags.get(match[1]) ?? { tag: `v${match[1]}`, version: match[1], commit: sha };
    // A peeled entry is the commit an annotated tag points at.
    if (match[2]) entry.commit = sha;
    tags.set(match[1], entry);
  }
  return [...tags.values()].sort((a, b) => compareVersions(b.version, a.version));
}

function pin(tag) {
  const pinned = readPin();
  const tags = releaseTags(pinned.repository);
  const target = tag ? tags.find((t) => t.tag === tag) : tags[0];
  if (!target) throw new Error(tag ? `No core release tagged ${tag}.` : 'Core has no release tags.');
  if (target.commit !== pinned.commit) {
    writeFileSync(pinPath, `${JSON.stringify({ repository: pinned.repository, tag: target.tag, commit: target.commit }, null, 2)}\n`);
    console.log(`Pinned Vellum core ${target.tag} (${target.commit.slice(0, 7)}), was ${pinned.tag}.`);
  } else {
    console.log(`Vellum core ${target.tag} is already pinned.`);
  }
  fetchCore();
  sync();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command = 'fetch', arg] = process.argv.slice(2);
  try {
    if (command === 'fetch') fetchCore();
    else if (command === 'check') check();
    else if (command === 'sync') sync();
    else if (command === 'latest') {
      const [latest] = releaseTags();
      if (!latest) throw new Error('Core has no release tags.');
      console.log(latest.tag);
    } else if (command === 'pin') pin(arg);
    else throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

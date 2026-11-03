#!/usr/bin/env node
// Downloads the Obsidian release the end-to-end tests run against (Linux
// x64), checks it against the SHA-256 GitHub publishes for it, and unpacks
// it into build/obsidian. Prints the path of the `obsidian` binary.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const OBSIDIAN = {
  version: '1.15.0',
  sha256: '75594ae09914ca0191dde13c0697dee653322287a3a806c15519332d9ada14d3',
};

export async function obsidianBinary() {
  const dir = join(root, 'build', 'obsidian');
  const binary = join(dir, `obsidian-${OBSIDIAN.version}`, 'obsidian');
  if (existsSync(binary)) return binary;
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('The end-to-end tests download Obsidian for Linux x64. Set OBSIDIAN_BIN to an Obsidian binary elsewhere.');
  }
  const url = `https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN.version}/obsidian-${OBSIDIAN.version}.tar.gz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Downloading ${url} failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== OBSIDIAN.sha256) throw new Error(`Obsidian ${OBSIDIAN.version} has SHA-256 ${digest}, expected ${OBSIDIAN.sha256}.`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const archive = join(dir, 'obsidian.tar.gz');
  writeFileSync(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', dir]);
  rmSync(archive);
  if (!existsSync(binary)) throw new Error(`The archive has no ${binary}.`);
  return binary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  obsidianBinary().then((binary) => console.log(binary), (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

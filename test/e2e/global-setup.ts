import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obsidianBinary } from '../../scripts/obsidian.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function setup() {
  if (!existsSync(join(root, 'main.js'))) throw new Error('Run `npm run build` before the end-to-end tests.');
  process.env.OBSIDIAN_BIN ||= await obsidianBinary();
}

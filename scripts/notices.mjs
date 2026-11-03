// License notices for the npm packages bundled into main.js. The build
// appends them to main.js, since Obsidian installs that file alone, and
// writes the same text to THIRD-PARTY-NOTICES.md.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function packageDir(root, name) {
  const dir = join(root, 'node_modules', name);
  return existsSync(join(dir, 'package.json')) ? dir : null;
}

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

/** Notices for `names`, grouped so identical license texts appear once. */
export function noticesFor(root, names) {
  const groups = new Map();
  for (const name of [...new Set(names)].sort()) {
    const dir = packageDir(root, name);
    if (!dir) throw new Error(`No installed package ${name} to take a license from.`);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN';
    const text = licenseText(dir);
    if (!text) throw new Error(`${name} ships no license file.`);
    const key = text;
    const group = groups.get(key) ?? { license, text, packages: [] };
    group.packages.push(`${name}@${pkg.version}`);
    groups.set(key, group);
  }
  const sections = [...groups.values()].map((g) => `## ${g.packages.join(', ')}\n\nLicense: ${g.license}\n\n${g.text}`);
  return `# Third-party notices\n\nVellum for Obsidian bundles the following packages.\n\n${sections.join('\n\n')}\n`;
}

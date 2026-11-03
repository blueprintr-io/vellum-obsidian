import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

/** The editor frame as the plugin build embeds it. */
const frameAssets: esbuild.Plugin = {
  name: 'vellum-frame',
  setup(build) {
    build.onResolve({ filter: /^virtual:vellum-frame$/ }, () => ({ path: 'vellum-frame', namespace: 'vellum-frame' }));
    build.onLoad({ filter: /.*/, namespace: 'vellum-frame' }, () => {
      const assets = JSON.parse(readFileSync(join(root, 'build', 'frame', 'assets.json'), 'utf8'));
      const script = readFileSync(join(root, 'build', 'frame', 'frame.js'), 'utf8');
      return {
        loader: 'js',
        contents: `export const script = ${JSON.stringify(script)}; export const style = ${JSON.stringify(assets.style)}; export const fonts = ${JSON.stringify(assets.fonts)}; export const coreTag = "test"; export const coreCommit = "0000000";`,
      };
    });
  },
};

export default async function setup() {
  if (!existsSync(join(root, 'build', 'frame', 'frame.js')) || process.env.VELLUM_REBUILD) {
    execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs'), '--frame'], { stdio: 'inherit', cwd: root });
  }
  const common: esbuild.BuildOptions = {
    bundle: true,
    format: 'iife',
    target: 'es2022',
    logLevel: 'warning',
  };
  await esbuild.build({ ...common, entryPoints: [join(here, 'harness.ts')], outfile: join(root, 'build', 'harness', 'harness.js') });
  await esbuild.build({
    ...common,
    entryPoints: [join(here, 'plugin-harness.ts')],
    outfile: join(root, 'build', 'harness', 'plugin-harness.js'),
    alias: { obsidian: join(root, 'test', 'obsidian', 'obsidian.ts') },
    plugins: [frameAssets],
  });
}

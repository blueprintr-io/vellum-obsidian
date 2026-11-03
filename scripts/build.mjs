#!/usr/bin/env node
// Builds the plugin in two steps:
//
//   1. The editor frame: Vellum core plus frame/, bundled by Vite with core's
//      own Tailwind and PostCSS setup into one script and one stylesheet.
//      Fonts are pulled out of the stylesheet so the plugin can hand them to
//      every frame as shared blob URLs.
//   2. The plugin: src/ bundled by esbuild into main.js, with the frame's
//      script, stylesheet and fonts embedded as strings.
//
//   node scripts/build.mjs            production build
//   node scripts/build.mjs --watch    rebuild on change; set OBSIDIAN_PLUGIN_DIR
//                                     to copy the result into a vault

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { coreDir, readPin } from './core.mjs';
import { noticesFor } from './notices.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');
const frameOut = join(root, 'build', 'frame');

if (!process.env.VELLUM_CORE_DIR) {
  execFileSync(process.execPath, [join(root, 'scripts', 'core.mjs'), 'fetch'], { stdio: 'inherit' });
}
const core = coreDir();
const pin = readPin();
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));

// Every runtime dependency core and the frame import must resolve to the
// plugin's single copy, including when core is a checkout elsewhere with
// its own node_modules.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const dedupe = Object.keys(pkg.dependencies);

async function tailwindConfig() {
  const loadConfig = require('tailwindcss/loadConfig');
  const config = loadConfig(join(core, 'tailwind.config.ts'));
  return {
    ...config,
    content: [join(core, 'src/**/*.{ts,tsx}'), join(root, 'frame/**/*.{ts,tsx}')],
  };
}

/** Records the npm packages that end up in the frame bundle. */
function bundledPackages() {
  return {
    name: 'vellum-bundled-packages',
    async generateBundle() {
      const names = new Set();
      for (const id of this.getModuleIds()) {
        const match = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id);
        if (match) names.add(match[1].replace(/\\/g, '/'));
      }
      await mkdir(join(root, 'build'), { recursive: true });
      await writeFile(join(root, 'build', 'frame-packages.json'), `${JSON.stringify([...names].sort(), null, 2)}\n`);
    },
  };
}

async function frameConfig() {
  const textScale = (await import(join(core, 'src/styles/postcss-text-scale.js'))).default;
  return {
    configFile: false,
    root,
    logLevel: 'warn',
    mode: 'production',
    plugins: [react(), bundledPackages()],
    resolve: {
      alias: { '@': join(core, 'src') },
      dedupe,
    },
    css: {
      postcss: { plugins: [tailwindcss(await tailwindConfig()), textScale(), autoprefixer()] },
    },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: frameOut,
      emptyOutDir: true,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      assetsInlineLimit: 0,
      cssCodeSplit: false,
      reportCompressedSize: false,
      lib: {
        entry: join(root, 'frame', 'main.tsx'),
        formats: ['iife'],
        name: 'VellumFrame',
        fileName: () => 'frame.js',
        cssFileName: 'frame',
      },
      rollupOptions: { output: { inlineDynamicImports: true, assetFileNames: '[name][extname]' } },
    },
  };
}

/** The frame's script, its stylesheet with fonts replaced by
 *  `vellum-font:<id>` placeholders, and the woff2 fonts as base64. Library
 *  builds inline every font as a data URL; only woff2 is kept, since every
 *  engine Obsidian runs on reads it. */
async function frameAssets() {
  const script = await readFile(join(frameOut, 'frame.js'), 'utf8');
  let style = await readFile(join(frameOut, 'frame.css'), 'utf8');
  style = style.replace(/,\s*url\(data:font\/woff;base64,[^)]*\)\s*format\(["']?woff["']?\)/g, '');
  const fonts = {};
  style = style.replace(/url\(data:font\/woff2;base64,([^)]*)\)/g, (_, data) => {
    const id = `${createHash('sha256').update(data).digest('hex').slice(0, 16)}.woff2`;
    fonts[id] = data;
    return `url(vellum-font:${id})`;
  });
  if (/url\((?!vellum-font:)/.test(style)) throw new Error('The frame stylesheet references a resource the plugin does not serve.');
  // The frame tests load the same assets the plugin embeds.
  await writeFile(join(frameOut, 'assets.json'), JSON.stringify({ style, fonts }));
  return { script, style, fonts };
}

function framePlugin(assets) {
  return {
    name: 'vellum-frame',
    setup(build) {
      build.onResolve({ filter: /^virtual:vellum-frame$/ }, () => ({ path: 'vellum-frame', namespace: 'vellum-frame' }));
      build.onLoad({ filter: /.*/, namespace: 'vellum-frame' }, () => ({
        loader: 'js',
        contents: [
          `export const script = ${JSON.stringify(assets.script)};`,
          `export const style = ${JSON.stringify(assets.style)};`,
          `export const fonts = ${JSON.stringify(assets.fonts)};`,
          `export const coreTag = ${JSON.stringify(pin.tag)};`,
          `export const coreCommit = ${JSON.stringify(pin.commit)};`,
        ].join('\n'),
      }));
    },
  };
}

const banner = `/*
Vellum for Obsidian ${manifest.version}, with Vellum ${pin.tag}.
Required Notice: Copyright (c) 2026 Josh Morris
Licensed under the PolyForm Noncommercial License 1.0.0:
https://polyformproject.org/licenses/noncommercial/1.0.0
Source and third-party notices: https://github.com/blueprintr-io/vellum-obsidian
*/`;

function pluginOptions(assets) {
  return {
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile: join(root, 'main.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    legalComments: 'none',
    banner: { js: banner },
    logLevel: 'warning',
    metafile: true,
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    plugins: [framePlugin(assets)],
  };
}

function bundledByPlugin(metafile) {
  const names = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/** Build main.js, then append the license notices of everything in it. */
async function buildPlugin(assets) {
  const result = await esbuild.build({ ...pluginOptions(assets), write: false });
  const framePackages = JSON.parse(await readFile(join(root, 'build', 'frame-packages.json'), 'utf8'));
  // Fonts come in through CSS imports, which the module list does not see.
  const fontCss = await readFile(join(core, 'src', 'styles', 'fonts.css'), 'utf8');
  const fontPackages = [...fontCss.matchAll(/@fontsource\/[a-z0-9-]+/g)].map((m) => m[0]);
  const notices = noticesFor(root, [...framePackages, ...fontPackages, ...bundledByPlugin(result.metafile)]);
  await writeFile(join(root, 'THIRD-PARTY-NOTICES.md'), notices);
  const [output] = result.outputFiles;
  await writeFile(join(root, 'main.js'), `${output.text}\n/*\n${notices.replace(/\*\//g, '* /')}*/\n`);
}

async function install() {
  const target = process.env.OBSIDIAN_PLUGIN_DIR;
  if (!target) return;
  await mkdir(target, { recursive: true });
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(join(root, file), join(target, file));
  console.log(`Copied the plugin to ${target}`);
}

async function report() {
  const { size } = await stat(join(root, 'main.js'));
  console.log(`main.js ${(size / 1024 / 1024).toFixed(2)} MB (Vellum ${pin.tag}, core at ${relative(root, core) || core})`);
}

if (process.argv.includes('--frame')) {
  await viteBuild(await frameConfig());
  await frameAssets();
  console.log(`Built the editor frame into ${relative(root, frameOut)}`);
} else if (!watch) {
  await viteBuild(await frameConfig());
  const assets = await frameAssets();
  await buildPlugin(assets);
  await report();
  await install();
} else {
  let context = null;
  const rebuildPlugin = async () => {
    const assets = await frameAssets();
    await context?.dispose();
    context = await esbuild.context({
      ...pluginOptions(assets),
      plugins: [framePlugin(assets), {
        name: 'vellum-install',
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length) return;
            await report();
            await install();
          });
        },
      }],
    });
    await context.watch();
  };
  const watcher = await viteBuild({ ...(await frameConfig()), build: { ...(await frameConfig()).build, watch: {} } });
  watcher.on('event', (event) => {
    if (event.code === 'END') rebuildPlugin().catch((error) => console.error(error));
    if (event.code === 'ERROR') console.error(event.error);
  });
}

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const corpusRoot = resolve(desktopRoot, '..');
const runtimeRoot = resolve(desktopRoot, 'build', 'runtime');
const desktopConfig = JSON.parse(
  await readFile(resolve(desktopRoot, 'corpus.desktop.json'), 'utf8'),
);
const sourcePluginRoot = resolve(corpusRoot, desktopConfig.pluginPack);
const sourcePluginRelative = relative(corpusRoot, sourcePluginRoot);
if (
  !sourcePluginRelative
  || sourcePluginRelative === '..'
  || sourcePluginRelative.startsWith(`..${sep}`)
) {
  throw new Error('corpus.desktop.json pluginPack must be inside the Corpus repository');
}
const pluginRoot = resolve(runtimeRoot, sourcePluginRelative);
const pack = JSON.parse(
  await readFile(resolve(sourcePluginRoot, 'pack.json'), 'utf8'),
);

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(pluginRoot, { recursive: true });

const entryPoints = [
  resolve(corpusRoot, 'server', 'bootstrap.ts'),
];
for (const moduleId of pack.modules) {
  entryPoints.push(resolve(
    sourcePluginRoot,
    moduleId,
    'index.ts',
  ));
}

await build({
  entryPoints,
  outdir: runtimeRoot,
  outbase: corpusRoot,
  entryNames: '[dir]/[name]',
  chunkNames: 'chunks/[name]-[hash]',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['better-sqlite3'],
});

await cp(resolve(corpusRoot, 'public'), resolve(runtimeRoot, 'public'), {
  recursive: true,
  filter: (source) => !source.includes(`${resolve(corpusRoot, 'public', 'src')}`),
});
await writeFile(
  resolve(pluginRoot, 'pack.json'),
  `${JSON.stringify(pack, null, 2)}\n`,
  'utf8',
);
for (const moduleId of pack.modules) {
  const panelTs = resolve(sourcePluginRoot, moduleId, 'panel.ts');
  const panelJs = resolve(sourcePluginRoot, moduleId, 'panel.js');
  if (existsSync(panelTs)) {
    await build({
      entryPoints: [panelTs],
      outdir: pluginRoot,
      outbase: sourcePluginRoot,
      entryNames: '[dir]/[name]',
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      sourcemap: true,
    });
  } else if (existsSync(panelJs)) {
    await mkdir(resolve(pluginRoot, moduleId), { recursive: true });
    await cp(panelJs, resolve(pluginRoot, moduleId, 'panel.js'));
  }
}

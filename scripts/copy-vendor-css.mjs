// dockview-core の CSS を public/vendor/ に同期する.
// build:web は esbuild が CSS bundle を別 file に分けてしまう副作用を避け、
// ベンダ CSS は ここで静的コピーし index.html から link する.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const src = resolve(root, 'node_modules/dockview-core/dist/styles/dockview.css');
const dst = resolve(root, 'public/vendor/dockview.css');

mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
console.log(`[copy-vendor-css] ${src} -> ${dst}`);

import tailwindcss from '@tailwindcss/postcss';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// postcss isn't a direct dependency; resolve the copy @tailwindcss/postcss uses.
const tailwindRequire = createRequire(realpathSync(resolve(process.cwd(), 'node_modules/@tailwindcss/postcss/package.json')));
const postcss = tailwindRequire('postcss');

const webDir = process.cwd();
const from = resolve(webDir, 'src/app/globals.css');
const to = resolve(webDir, '.ds-generated/globals.compiled.css');

const css = readFileSync(from, 'utf8');
const result = await postcss([tailwindcss({ base: webDir })]).process(css, { from, to });
writeFileSync(to, result.css);
console.log(`wrote ${to} (${result.css.length} bytes)`);

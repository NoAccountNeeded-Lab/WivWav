import postcss from '/Users/matt/Projects/NoAccountNeeded-Lab/WivWav/node_modules/.pnpm/postcss@8.5.16/node_modules/postcss/lib/postcss.mjs';
import tailwindcss from '@tailwindcss/postcss';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webDir = process.cwd();
const from = resolve(webDir, 'src/app/globals.css');
const to = resolve(webDir, '.ds-generated/globals.compiled.css');

const css = readFileSync(from, 'utf8');
const result = await postcss([tailwindcss({ base: webDir })]).process(css, { from, to });
writeFileSync(to, result.css);
console.log(`wrote ${to} (${result.css.length} bytes)`);

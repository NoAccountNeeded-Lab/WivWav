import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

describe('compiled server API URL configuration', () => {
  it('uses deployment values after Next public environment substitution', () => {
    // Use the installed Next compiler and its public-env definitions. Plain
    // Vitest imports cannot reproduce Next replacing direct env references.
    execFileSync(process.execPath, ['-e', String.raw`
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');
      const assert = require('node:assert/strict');
      const { transformSync } = require('next/dist/build/swc');
      const { webpack } = require('next/dist/compiled/webpack/webpack');
      const { getNextPublicEnvironmentVariables } = require('next/dist/lib/static-env');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wivwav-api-url-'));
      for (const name of ['api-url', 'server-api-url']) {
        const source = fs.readFileSync('src/lib/' + name + '.ts', 'utf8');
        const output = transformSync(source, {
          jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
          module: { type: 'es6' },
        });
        const control = name === 'server-api-url' ? '\nexport const buildTimeUrl = process.env.NEXT_PUBLIC_API_URL;' : '';
        fs.writeFileSync(path.join(dir, name + '.js'), output.code + control);
      }
      process.env.NEXT_PUBLIC_API_URL = 'https://build-time.invalid';
      webpack({
        mode: 'production', target: 'node', optimization: { minimize: false },
        module: { rules: [{ test: /\.js$/, resolve: { fullySpecified: false } }] },
        entry: path.join(dir, 'server-api-url.js'),
        output: { path: dir, filename: 'server.cjs', library: { type: 'commonjs2' } },
        plugins: [new webpack.DefinePlugin(Object.fromEntries(
          Object.entries(getNextPublicEnvironmentVariables()).map(([key, value]) => [key, JSON.stringify(value)]),
        ))],
      }, (error, stats) => {
        try {
          if (error || stats.hasErrors()) throw error || new Error(stats.toString());
          process.env.NEXT_PUBLIC_API_URL = 'https://runtime.example';
          process.env.API_INTERNAL_URL = 'http://api:3001';
          const api = require(path.join(dir, 'server.cjs'));
          assert.equal(api.buildTimeUrl, 'https://build-time.invalid');
          assert.equal(api.getPublicApiBaseUrl(), 'https://runtime.example');
          assert.equal(api.getServerApiBaseUrl(), 'http://api:3001');
          process.env.NEXT_PUBLIC_API_URL = 'https://promoted.example';
          assert.equal(api.getPublicApiBaseUrl(), 'https://promoted.example');
          process.env.NEXT_PUBLIC_API_URL = '';
          assert.equal(api.getPublicApiBaseUrl(), 'http://localhost:4001');
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    `], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: 'pipe',
      timeout: 20_000,
    })
  })
})

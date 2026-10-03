// SPDX-License-Identifier: AGPL-3.0-only
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const versions = { react: '18.3.1', 'react-dom': '18.3.1', typescript: '5.7.3', esbuild: '0.25.12' };
for (const [name, version] of Object.entries(versions)) {
  const installed = JSON.parse(await readFile(require.resolve(name + '/package.json'), 'utf8'));
  if (installed.version !== version) throw new Error(`App SDK requires ${name} ${version}; install the locked dependencies explicitly.`);
}
const out = path.join(root, 'server/internal/desktopapps/toolchain');
await mkdir(out, { recursive: true });
await Promise.all([
  build({ absWorkingDir: root, entryPoints: ['scripts/app-toolchain/native.cjs'], outfile: path.join(out, 'native.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', minify: true, legalComments: 'inline' }),
  build({ absWorkingDir: root, entryPoints: ['scripts/app-toolchain/compiler.cjs'], outfile: path.join(out, 'compiler.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', minify: true, legalComments: 'inline' }),
  build({ absWorkingDir: root, entryPoints: ['scripts/app-toolchain/runtime.tsx'], outfile: path.join(out, 'runtime.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'LumoReactV1', target: 'es2022', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'inline' }),
]);
console.log('Prepared offline app SDK: React 18.3.1, TypeScript 5.7.3.');

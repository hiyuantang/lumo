// SPDX-License-Identifier: AGPL-3.0-only
import { build } from 'esbuild';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const names = ['calendar', 'skills', 'git', 'docker', 'nginx', 'monitor'];
const chosen = process.argv[2];
if (chosen && !names.includes(chosen)) throw new Error(`Choose a plugin: ${names.join(', ')}`);
const output = path.resolve(root, process.argv[3] || 'public/plugins');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const modules = new Map();
for (const file of program.getSourceFiles()) {
  const relative = path.relative(path.join(root, 'src/platform/sdk'), file.fileName);
  if (relative.startsWith('..') || !relative.endsWith('.ts')) continue;
  const symbol = checker.getSymbolAtLocation(file);
  if (!symbol) continue;
  const exports = checker.getExportsOfModule(symbol).filter((item) => {
    const resolved = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item;
    return Boolean(resolved.flags & ts.SymbolFlags.Value);
  }).map((item) => item.name);
  modules.set('@lumo/sdk/' + relative.replaceAll(path.sep, '/').slice(0, -3), exports);
}
for (const name of ['react', 'react/jsx-runtime', 'react-dom']) modules.set(name, Object.keys(require(name)).filter((key) => key !== 'default'));
for (const name of chosen ? [chosen] : names) {
  const directory = path.join(root, 'apps', name);
  const diagnostics = program.getSourceFiles().filter((file) => file.fileName.startsWith(directory + path.sep)).flatMap((file) => [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]);
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: (file) => file, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  const manifest = JSON.parse(await readFile(path.join(directory, 'lumo.plugin.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.hostApiVersion !== 1 || manifest.license !== 'AGPL-3.0-only' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`Invalid plugin manifest: ${name}`);
  const background = manifest.background === true;
  const result = await build({
    absWorkingDir: root, entryPoints: { app: path.join(directory, 'src/index.ts'), ...(background ? { background: path.join(directory, 'src/background.ts') } : {}) }, outdir: 'plugin',
    bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', minify: true,
    plugins: [{ name: 'lumo-host-contract', setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) => {
        if (modules.has(args.path)) return { path: args.path, namespace: 'lumo-host' };
        if (args.namespace === 'lumo-host') return;
        if (args.kind === 'entry-point') return;
        if (!args.path.startsWith('.')) throw new Error(`Unsupported plugin dependency: ${args.path}`);
        const resolved = path.resolve(args.resolveDir, args.path);
        if (!resolved.startsWith(directory + path.sep)) throw new Error(`Plugin imports outside its package: ${args.path}`);
      });
      builder.onLoad({ filter: /.*/, namespace: 'lumo-host' }, (args) => ({
        contents: `const host = globalThis.__LUMO_HOST_V1__; if (!host) throw new Error('Lumo host API v1 unavailable'); const module = host[${JSON.stringify(args.path)}]; export default module; ${modules.get(args.path).length ? `export const {${modules.get(args.path).join(',')}} = module;` : ''}`,
        loader: 'js',
      }));
    } }],
  });
  const out = path.join(output, name);
  await mkdir(out, { recursive: true });
  const files = {};
  for (const file of result.outputFiles) {
    const extension = path.extname(file.path);
    const hash = createHash('sha256').update(file.contents).digest('hex');
    const filename = hash + extension;
    try { await writeFile(path.join(out, filename), file.contents, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (!(await readFile(path.join(out, filename))).equals(Buffer.from(file.contents))) throw new Error('Existing plugin asset is corrupt: ' + filename); }
    files[path.basename(file.path).startsWith('background.') ? 'background' : extension === '.js' ? 'entry' : 'styles'] = filename;
  }
  const built = { ...manifest, ...files };
  await writeFile(path.join(out, `manifest.${process.pid}.next`), JSON.stringify(built, null, 2) + '\n');
  await rename(path.join(out, `manifest.${process.pid}.next`), path.join(out, 'manifest.json'));
  console.log(`Built ${manifest.name} ${manifest.version} → ${path.relative(root, out)}`);
}

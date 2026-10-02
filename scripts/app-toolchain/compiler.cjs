// SPDX-License-Identifier: AGPL-3.0-only
const ts = require('typescript');
const fs = require('node:fs');
const allowed = new Set(['react', 'react-dom/client', 'react/jsx-runtime', '@lumo/ui']);
try {
  const source = fs.readFileSync(0, 'utf8');
  const file = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier) || !allowed.has(node.moduleSpecifier.text)) throw new Error('Only react, react-dom/client, react/jsx-runtime and @lumo/ui imports are supported.');
    }
    if (ts.isImportEqualsDeclaration(node) || (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')))) throw new Error('Use static imports from the supported SDK modules.');
    ts.forEachChild(node, visit);
  }
  visit(file);
  const result = ts.transpileModule(source, { fileName: 'main.tsx', reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, isolatedModules: true, sourceMap: false, inlineSourceMap: false } });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(errors.slice(0, 8).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
  process.stdout.write(result.outputText);
} catch (error) {
  process.stderr.write(String(error.message).slice(0, 4000));
  process.exitCode = 1;
}

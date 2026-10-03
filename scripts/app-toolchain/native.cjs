// SPDX-License-Identifier: AGPL-3.0-only
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path').posix;
const { builtinModules } = require('node:module');
const vm = require('node:vm');
const diagnostics = [];
const problem = (file, code, message, fix, node, source) => {
  const pos = node && source ? source.getLineAndCharacterOfPosition(node.getStart(source)) : null;
  diagnostics.push({file, code, message, fix, ...(pos ? {line:pos.line+1,column:pos.character+1} : {})});
};
const host = new Set(['react', 'react/jsx-runtime', '@lumo/sdk/api/plugins', '@lumo/sdk/api/notifications', '@lumo/sdk/shell/ShellContext', '@lumo/sdk/shell/WindowContext']);
const builtin = new Set(builtinModules.map(name => name.replace(/^node:/,'')));
const options = {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,isolatedModules:true};
try {
  const input = JSON.parse(fs.readFileSync(0,'utf8'));
  const {manifest:m,files,compiled=false} = input;
  const output = {};
  function parse(name, text) {
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : name.endsWith('.ts') ? ts.ScriptKind.TS : name.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
    for (const d of source.parseDiagnostics) problem(name,'syntax',ts.flattenDiagnosticMessageText(d.messageText,'\n'),'Fix the syntax at this location, then validate again.',{getStart:()=>d.start || 0},source);
    return source;
  }
  function defaultExport(source) {
    return source.statements.some(n => ts.isExportAssignment(n) || n.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword));
  }
  function checkImports(source, resolve) {
    function visit(n) {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
        if (!ts.isStringLiteral(n.moduleSpecifier)) problem(source.fileName,'import','Import must be a literal.','Use a supported static import.',n,source);
        else resolve(n.moduleSpecifier.text,n);
      }
      if (ts.isImportEqualsDeclaration(n) || (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(n.expression) && n.expression.text === 'require'))) problem(source.fileName,'dynamic-import','Dynamic import and require are unsupported in source.','Use static imports; no downloads or external dependencies.',n,source);
      ts.forEachChild(n,visit);
    }
    visit(source);
  }
  function nodeSource(name) {
    const source = parse(name,files[name]);
    checkImports(source,(value,n) => {
      if (!value.startsWith('node:') || !builtin.has(value.slice(5))) problem(name,'dependency',`Unsupported Node import: ${value}`,'Use node: built-ins. Keep this entry self-contained.',n,source);
    });
    return source;
  }
  if (compiled) {
    const source=parse(m.entry,files[m.entry]);
    if (!defaultExport(source)) problem(m.entry,'entry','Frontend has no default export.','Export a React component as default.');
    output[m.entry]=files[m.entry];
  } else {
    const modules = new Map();
    function compile(name) {
      if (modules.has(name)) return;
      if (!Object.hasOwn(files,name)) { problem(name,'missing','Source file is missing.','Create the file or correct its manifest/import path.'); return; }
      modules.set(name,'');
      const source=parse(name,files[name]);
      if (name === m.entry && !defaultExport(source)) problem(name,'entry','Frontend has no default export.','Export a React component as default.');
      const resolved = new Map();
      checkImports(source,(value,n)=>{
        if (host.has(value)) { resolved.set(value,value); return; }
        const base=path.normalize(path.join(path.dirname(name),value));
        const target=[base,base+'.tsx',base+'.ts',base+'.jsx',base+'.js',base+'/index.tsx',base+'/index.ts'].find(p=>Object.hasOwn(files,p));
        if (!value.startsWith('.') || !base.startsWith('src/') || !target || !/\.(tsx?|jsx?)$/.test(target)) { problem(name,'dependency',`Unsupported or missing import: ${value}`,'Use a local module under src/, react, or @lumo/sdk/api/plugins.',n,source); return; }
        resolved.set(value,target); compile(target);
      });
      const result=ts.transpileModule(files[name],{fileName:name,compilerOptions:options,reportDiagnostics:true});
      for(const d of result.diagnostics || []) if(d.category===ts.DiagnosticCategory.Error) problem(name,'compile',ts.flattenDiagnosticMessageText(d.messageText,'\n'),'Fix this compiler error before building.');
      const mapping=Object.fromEntries(resolved); mapping['react/jsx-runtime']='react/jsx-runtime';
      modules.set(name,`function(module,exports,load){const require=name=>load((${JSON.stringify(mapping)})[name]||name);\n${result.outputText}\n}`);
    }
    compile(m.entry);
    output[m.entry]=`const factories={${[...modules].map(([name,code])=>JSON.stringify(name)+':'+code).join(',')}};const cache={};function load(name){if(Object.hasOwn(factories,name)){if(!cache[name]){const module={exports:{}};cache[name]=module;factories[name](module,module.exports,load)}return cache[name].exports}const host=globalThis.__LUMO_HOST_V1__;if(!host||!Object.hasOwn(host,name))throw new Error('Unsupported Lumo SDK module: '+name);return host[name]}export default load(${JSON.stringify(m.entry)}).default;`;
  }
  try { new vm.Script(output[m.entry].replace(/export default load\((.*)\)\.default;$/, 'const component = load($1).default;'), {filename:m.entry}); } catch(error) { problem(m.entry,'frontend-syntax',error.message,'Fix the frontend syntax before building.'); }
  if(m.backend){
    const name=m.backend.entry;
    if(compiled){ parse(name,files[name]); output[name]=files[name]; }
    else { nodeSource(name); output[name]=ts.transpileModule(files[name],{fileName:'backend.ts',compilerOptions:options}).outputText; }
    try { new vm.Script(output[name],{filename:name}); } catch(error){ problem(name,'backend-syntax',error.message,'Fix the Node.js backend syntax.'); }
  }
  if(m.pi){
    const name=m.pi.entry; const source=nodeSource(name);
    if(!defaultExport(source)) problem(name,'extension-entry','Pi extension has no default export.','Export default function(pi) and register tools inside it.');
    const declared=[...m.pi.readTools,...m.pi.writeTools]; const registered=[];
    function visit(n){
      if(ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text==='registerTool'){
        const spec=n.arguments[0]; const props=spec && ts.isObjectLiteralExpression(spec) ? spec.properties : [];
        const named=props.find(p=>p.name?.getText(source)==='name');
        if(!named || !ts.isPropertyAssignment(named) || !ts.isStringLiteral(named.initializer)) problem(name,'tool-name','Tool registration needs a literal name.','Use registerTool({name: "lumo_<app>_<action>", ...}) so declarations can be checked.',n,source);
        else registered.push(named.initializer.text);
        for(const field of ['label','description','parameters','execute']) if(!props.some(p=>p.name?.getText(source)===field)) problem(name,'tool-shape',`Tool is missing ${field}.`,`Add ${field} to the tool definition.`,n,source);
      }
      ts.forEachChild(n,visit);
    }
    visit(source);
    if(new Set(declared).size!==declared.length || new Set(registered).size!==registered.length || declared.length!==registered.length || declared.some(name=>!registered.includes(name))) problem(name,'tool-manifest','Registered tools do not exactly match manifest readTools/writeTools.','Declare every tool once in the correct read or write list, with matching literal registrations.');
    if(!files[name].includes("const executable = 'lumod';") || !files[name].includes("const permissionMode = 'ask';")) problem(name,'host-bindings','Pi host bindings are missing.','Keep the template executable and permissionMode declarations so Lumo can bind them.');
    try { new vm.Script(ts.transpileModule(files[name],{fileName:'extension.ts',compilerOptions:options}).outputText,{filename:name}); } catch(error) { problem(name,'extension-syntax',error.message,'Fix the extension syntax; use an async function instead of top-level await.'); }
    output[name]=files[name];
  }
  if(m.styles) output[m.styles]=files[m.styles];
  process.stdout.write(JSON.stringify({ok:diagnostics.length===0,diagnostics,files:diagnostics.length ? {} : output}));
} catch(error) {
  process.stdout.write(JSON.stringify({ok:false,diagnostics:[{file:'lumo.plugin.json',code:'input',message:error.message,fix:'Check the manifest and source paths, then validate again.'}],files:{}}));
}

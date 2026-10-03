// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(file, imports = {}) {
  const output = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports:output,require(name){if(!(name in imports))throw new Error(name);return imports[name];}});
  return output;
}
const menus = load('../src/shell/appMenus.ts', {react:{},'./WindowContext':{}});
const {frameMenus,framePresentation} = load('../src/platform/appContributions.ts', {'../shell/appMenus':menus});
test('Frame commands preserve identity and reject malformed or oversized contributions', () => {
  const calls = [];
  const parsed = frameMenus({tools:[{id:'export',label:'Export',checked:true}],dock:[{id:'export',label:'Export'}]}, id => calls.push(id));
  parsed.tools[0].run(); parsed.dock[0].run(); assert.deepEqual(calls,['export','export']);
  assert.equal(parsed.tools[0].checked,true);
  for (const value of [null,[],{unknown:[]},{tools:[{id:'a',label:'A',run:'evil'}]},{tools:[{id:'a',label:'A',disabled:'false'}]},{tools:[{id:'a',label:'A'},{id:'a',label:'Again'}]},{tools:Array.from({length:65},(_,i)=>({id:'a'+i,label:'A'}))}]) assert.throws(()=>frameMenus(value,()=>{}));
});
test('Frame presentation cannot change another window or provide invalid status data', () => {
  assert.equal(framePresentation({title:'Draft',badge:'2'}).title,'Draft');
  assert.equal(Object.keys(framePresentation({})).length,0);
  for(const value of [{windowId:'files'},{title:'x'.repeat(121)},{badge:'x'.repeat(9)},{badge:2},null,[]]) assert.throws(()=>framePresentation(value));
});

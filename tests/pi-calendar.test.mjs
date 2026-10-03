// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import extension from '../apps/calendar/pi/extension.mjs';
const file = new URL('../apps/calendar/pi/extension.mjs', import.meta.url);
test('Calendar tools use typed actions and expose no Google credential operation', () => {
 const tools=[];extension({registerTool(tool){tools.push(tool)}});
 assert.deepEqual(tools.map(t=>t.name),['lumo_calendar_list','lumo_calendar_change']);
 assert.equal(tools[1].parameters.additionalProperties,false);
 assert.deepEqual(tools[1].parameters.properties.action.enum,['save','delete','restore','complete','collection']);
 assert.match(tools[1].description,/Reminders stay in Lumo/);
 assert.equal(JSON.stringify(tools[1].parameters).includes('clientSecret'),false);
});
test('Read only fails closed before starting any mutating process', async () => {
 const source=(await readFile(file,'utf8')).replace("const permissionMode = 'ask';","const permissionMode = 'read-only';");
 const module=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 assert.throws(()=>module.calendarRequest('change',{action:'delete'}),/Read only/);
 assert.throws(()=>module.calendarRequest('list',{},AbortSignal.abort()),/interrupted/);
});
test('Ask approves exact Calendar mutations but listing needs no approval', async () => {
 const source=(await readFile(new URL('../server/internal/httpapi/pi_questions.mjs',import.meta.url),'utf8')).replace('const pluginReadTools = [];', 'const pluginReadTools = ["lumo_calendar_list"];');
 const module=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const handlers={};module.default({on(name,fn){handlers[name]=fn},registerTool(){}});
 assert.equal(await handlers.tool_call({toolName:'lumo_calendar_list',input:{from:'2026-10-01T00:00:00Z'}},{}),undefined);
 const input={action:'delete',id:'event',revision:'v1'};let seen;
 const result=await handlers.tool_call({toolName:'lumo_calendar_change',input},{hasUI:true,ui:{confirm:async(_title,description)=>{seen=JSON.parse(description);return false}}});
 assert.deepEqual(seen,input);assert.equal(result.block,true);
});
test('Disabling the extension leaves its tools out of the active set', async () => {
 const source=(await readFile(new URL('../server/internal/httpapi/pi_questions.mjs',import.meta.url),'utf8')).replace('const pluginReadTools = [];', 'const pluginReadTools = ["lumo_calendar_list"];');
 const module=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const handlers={};let active=['read'];module.default({on(name,fn){handlers[name]=fn},registerTool(){},getAllTools:()=>[{name:'read'}],getActiveTools:()=>active,setActiveTools:(tools)=>{active=tools}});
 await handlers.session_start({},{sessionManager:{getBranch:()=>[]},ui:{setStatus(){}}});
 assert.equal(active.includes('lumo_calendar_list'),false);assert.equal(active.includes('lumo_calendar_change'),false);
});

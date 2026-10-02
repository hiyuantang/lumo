// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
async function load(mode = 'ask') {
 const source = (await readFile(new URL('../server/internal/httpapi/pi_apps.mjs', import.meta.url), 'utf8')).replace("import { desktopRequest } from './.lumo-use.mjs';", "const desktopRequest = async (params) => params;").replace("const permissionMode = 'ask';", `const permissionMode = '${mode}';`);
 return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
test('App tools expose the complete local workflow and exact preview digest', async () => {
 const module = await load(); const tools = new Map(); module.default({ registerTool: (tool) => tools.set(tool.name, tool) });
 assert.deepEqual([...tools.keys()], ['lumo_app_api','lumo_app_list','lumo_app_create','lumo_app_build','lumo_app_status','lumo_app_install','lumo_app_restore','lumo_app_preview']);
 const digest = 'a'.repeat(64); const preview = await tools.get('lumo_app_preview').execute('request', { digest, name: 'Pulse' }, undefined, undefined, {});
 assert.deepEqual(preview, { action: 'app_preview', target: digest, label: 'Pulse' });
 assert.deepEqual(tools.get('lumo_app_create').parameters.properties.template.enum, ['pulse', 'counter']);
 assert.equal(tools.get('lumo_app_create').parameters.required.includes('template'), false);
 for (const tool of tools.values()) assert.equal(tool.parameters.additionalProperties, false);
});
test('Read only blocks app creation, execution and installation before invoking the CLI', async () => {
 const module = await load('read-only');
 for (const action of ['create','build','install','restore']) assert.throws(() => module.appRequest(action, {}), /read only/);
 const tools = new Map(); module.default({ registerTool: (tool) => tools.set(tool.name, tool) });
 assert.throws(() => tools.get('lumo_app_preview').execute('', {}, undefined, undefined, {}), /permission/);
 assert.throws(() => module.appRequest('api', {}, AbortSignal.abort()), /interrupted/);
});
test('Permission enforcement approves the exact app artifact and blocks denied installs', async () => {
 const { default: questions } = await import('../server/internal/httpapi/pi_questions.mjs'); const handlers = {}; questions({ on(name, fn) { handlers[name] = fn; }, registerTool() {} });
 for (const toolName of ['lumo_app_api','lumo_app_list','lumo_app_status']) assert.equal(await handlers.tool_call({ toolName, input: {} }, {}), undefined);
 const input = { id: 'local.pulse', digest: 'b'.repeat(64), revision: 'old', requestId: 'exact-request' }; let shown;
 const result = await handlers.tool_call({ toolName: 'lumo_app_install', input }, { hasUI: true, ui: { confirm: async (_title, text) => { shown = JSON.parse(text); return false; } } });
 assert.deepEqual(shown, input); assert.equal(result.block, true);
});

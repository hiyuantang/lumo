// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test, expect } from '../offline';

const ubuntu = (...args: string[]) => execFileSync('docker', ['exec', process.env.LUMO_TEST_CONTAINER!, ...args], {encoding:'utf8'}).trim();
function notesBundle(version: string) {
  const files: Record<string,string> = {};
  const asset = (body: string, extension: string) => { const name = createHash('sha256').update(body).digest('hex') + extension; files[name] = Buffer.from(body).toString('base64'); return name; };
  const entry = asset(`const R=globalThis.__LUMO_HOST_V1__.react;const api=globalThis.__LUMO_HOST_V1__['@lumo/sdk/api/plugins'];export default function Notes(){const [text,setText]=R.useState('');const [saved,setSaved]=R.useState(false);const [loaded,setLoaded]=R.useState(false);R.useEffect(()=>{api.requestPlugin('notes').then(data=>{setText(data.text);setLoaded(true)})},[]);return R.createElement('div',{className:'app'},R.createElement('h1',null,'Notes ${version}'),R.createElement('input',{'aria-label':'Note',disabled:!loaded,value:text,onChange:e=>setText(e.target.value)}),R.createElement('button',{disabled:!loaded,onClick:()=>api.requestPlugin('notes',{text}).then(()=>setSaved(true))},'Save note'),saved&&R.createElement('p',{role:'status'},'Saved'))}`,'.js');
  const backend = asset(String.raw`#!/usr/bin/python3
import os, sys, json, base64, pathlib
root=pathlib.Path(os.environ['LUMO_APP_DATA'])
root.mkdir(parents=True,exist_ok=True)
file=root/'note.txt'
if len(sys.argv)>1 and sys.argv[1]=='read':
 print(file.read_text() if file.exists() else '')
 sys.exit(0)
raw=sys.stdin.buffer.read()
head,_,body=raw.partition(b'\r\n\r\n')
if head.startswith(b'POST '):
 value=json.loads(body)
 file.write_text(value.get('text',''))
reply=json.dumps({'ok':True,'data':{'text':file.read_text() if file.exists() else ''}}).encode()
print(json.dumps({'status':200,'headers':{'Content-Type':['application/json']},'body':base64.b64encode(reply).decode()}))
`,'.bin');
  const pi = asset(`export default function(pi){pi.registerTool({name:'lumo_notes_read',label:'Read notes',description:'Read the saved note',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'fixture'}]})})}`,'.mjs');
  return {name:'notes',manifest:{schemaVersion:1,hostApiVersion:1,id:'plugin:notes',name:'Notes',description:'A separately installed notebook.',version,license:'AGPL-3.0-only',icon:'IconGrid',window:{width:620,height:440,minWidth:320,minHeight:260},entry,permissions:['account'],backend:{protocolVersion:1,entry:backend,platform:`linux/${ubuntu('uname','-m') === 'aarch64' ? 'arm64' : 'amd64'}`,routes:['GET /api/v1/plugins/notes','POST /api/v1/plugins/notes']},pi:{entry:pi,setting:'notes',readTools:['lumo_notes_read'],writeTools:[]}},files};
}

test('A new complete plugin installs, saves, updates, rolls back and uninstalls per account without a host restart', async ({page}) => {
  await page.goto('/');
  await page.getByTestId('login-username').fill('alice'); await page.getByTestId('login-password').fill('alice-pass'); await page.getByTestId('login-submit').click();
  await page.getByTestId('dock-app-library').click();
  const pid = ubuntu('systemctl','show','lumod-gateway','--property=MainPID','--value');
  const csrf=(await page.context().cookies()).find((c)=>c.name==='lumo_csrf')!.value;
  const upload = async (version: string) => {
    await page.getByRole('button',{name:'All Apps',exact:true}).click();
    await page.getByTestId('plugin-import-file').setInputFiles({name:`notes-${version}.lumoplugin`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(notesBundle(version)))});
    await expect(page.getByRole('heading',{name:'Notes',exact:true})).toBeVisible();
  };
  await upload('1.0.0');
  expect((await page.request.get('/api/v1/plugins/notes')).status()).toBe(503);
  await page.getByTestId('plugin-install').click();
  await expect(page.getByTestId('dock-app-plugin:notes')).toBeVisible();
  await page.getByTestId('library-open').click();
  await expect(page.getByRole('heading',{name:'Notes 1.0.0',exact:true})).toBeVisible();
  await page.getByRole('textbox',{name:'Note',exact:true}).fill('A note that survives package changes.');
  await page.getByRole('button',{name:'Save note',exact:true}).click(); await expect(page.getByText('Saved',{exact:true})).toContainText('Saved');
  expect(ubuntu('runuser','-u','alice','--','/usr/local/bin/lumod','plugin','notes','read')).toBe('A note that survives package changes.');
  expect(ubuntu('stat','-c','%U','/home/alice/.local/share/lumo/native-plugins/data/notes/note.txt')).toBe('alice');
  const manifest=await (await page.request.get('/api/v1/app-plugins/assets/notes/manifest.json')).json();
  for(const asset of [manifest.backend.entry,manifest.pi.entry]) expect((await page.request.get(`/api/v1/app-plugins/assets/notes/${asset}`)).status()).toBe(404);
  await page.getByTestId('window-close-plugin:notes').click();
  await upload('1.1.0'); await page.getByTestId('plugin-update').click();
  await expect(page.getByTestId('plugin-rollback')).toBeVisible();
  await page.getByTestId('library-open').click(); await expect(page.getByRole('heading',{name:'Notes 1.1.0',exact:true})).toBeVisible(); await expect(page.getByRole('textbox',{name:'Note',exact:true})).toHaveValue('A note that survives package changes.');
  await page.getByTestId('window-close-plugin:notes').click();
  await page.getByTestId('plugin-rollback').click(); await page.getByTestId('library-open').click(); await expect(page.getByRole('heading',{name:'Notes 1.0.0',exact:true})).toBeVisible();
  await page.getByTestId('window-close-plugin:notes').click();
  const catalog=await (await page.request.get('/api/v1/app-plugins')).json();
  const note=catalog.data.find((app:{name:string})=>app.name==='notes');
  const stale=await page.request.post('/api/v1/app-plugins/action',{headers:{'X-Lumo-CSRF':csrf},data:{requestId:crypto.randomUUID(),name:'notes',action:'uninstall',revision:'stale'}}); expect(stale.status()).toBe(409);
  expect(note.installed).toBe(true);
  await page.getByTestId('plugin-install').click(); await page.getByTestId('server-app-confirm-ok').click();
  await expect(page.getByTestId('dock-app-plugin:notes')).toHaveCount(0);
  expect((await page.request.get('/api/v1/plugins/notes')).status()).toBe(503);
  expect(ubuntu('cat','/home/alice/.local/share/lumo/native-plugins/data/notes/note.txt')).toContain('survives');
  expect(ubuntu('systemctl','show','lumod-gateway','--property=MainPID','--value')).toBe(pid);
});

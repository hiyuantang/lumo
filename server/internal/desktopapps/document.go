// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"encoding/base64"
	"encoding/json"
	"html"
	"strings"
)

const Bootstrap = `const pending=new Map();let port;let serial=0;let rendered=false;
function report(status,message=''){if(port)port.postMessage({type:'report',status,message:String(message).slice(0,2000)});}
globalThis.lumo=Object.freeze({call(method,params){return new Promise((resolve,reject)=>{if(!port)return reject(new Error('App connection unavailable.'));if(pending.size>=8)return reject(new Error('Too many requests.'));const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Request timed out.'));},10000);pending.set(id,{resolve,reject,timer});port.postMessage({type:'call',id,method,params});});},ready(){rendered=true;report('ready');}});
addEventListener('message',function connect(event){if(event.source!==parent||event.data?.type!=='lumo-connect'||!event.ports[0]||port)return;port=event.ports[0];port.onmessage=({data})=>{if(data?.type==='theme'){document.documentElement.dataset.theme=data.theme;document.documentElement.dataset.motion=data.motion;return;}const p=pending.get(data?.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(Object.assign(new Error(data.error),{code:data.code})):p.resolve(data.value);};port.start();dispatchEvent(new Event('lumo-connected'));if(rendered)report('ready');});
addEventListener('error',event=>report('error',event.message));addEventListener('unhandledrejection',event=>report('error',event.reason?.message||event.reason));
parent.postMessage({type:'lumo-ready'},'*');
`

func Document(b Bundle, handshake ...string) (string, string) {
	nonce := Token()
	policy := "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; img-src data:; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; frame-ancestors 'self'; sandbox allow-scripts, script-src 'unsafe-inline'; style-src 'unsafe-inline'"
	js, _ := json.Marshal(base64.StdEncoding.EncodeToString([]byte(b.JS)))
	bootstrap := Bootstrap
	if len(handshake) > 0 {
		key, _ := json.Marshal(handshake[0])
		bootstrap = strings.Replace(bootstrap, "{type:'lumo-ready'}", "{type:'lumo-ready',handshake:"+string(key)+"}", 1)
	}
	runner := bootstrap + `addEventListener('lumo-connected',()=>{const script=document.createElement('script');script.type='module';script.nonce=` + `document.currentScriptNonce` + `;script.textContent=new TextDecoder().decode(Uint8Array.from(atob(` + string(js) + `),c=>c.charCodeAt(0)));document.body.append(script);},{once:true});`
	runner = `document.currentScriptNonce=` + `'` + nonce + `';` + runner
	css, _ := json.Marshal(base64.StdEncoding.EncodeToString([]byte(b.CSS)))
	runner = `const style=document.createElement('style');style.nonce='` + nonce + `';style.textContent=new TextDecoder().decode(Uint8Array.from(atob(` + string(css) + `),c=>c.charCodeAt(0)));document.head.append(style);` + runner
	document := "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + html.EscapeString(b.Manifest.Name) + "</title></head><body><main id=\"app\"></main><script nonce=\"" + nonce + "\">" + runner + "</script></body></html>"
	return document, policy
}

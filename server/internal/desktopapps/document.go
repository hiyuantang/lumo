// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"html"
	"strings"
)

//go:embed sdk.js
var Bootstrap string

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

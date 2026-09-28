// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func authTestServer(t *testing.T) *Server {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Fatal("Cached Node.js is required for the offline Pi adapter tests")
	}
	t.Setenv("PI_CODING_AGENT_DIR", "")
	s := NewServer(Deps{})
	s.pi.home = t.TempDir()
	root := filepath.Join(t.TempDir(), "fixture")
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"package.json": `{"name":"@earendil-works/pi-coding-agent","type":"module","license":"AGPL-3.0-only","exports":{".":{"import":"./index.mjs"}}}`,
		"pi":           "fixture",
		"index.mjs": `
import fs from 'node:fs/promises';
export class ModelRuntime {
 static async create(options) { if(options.allowModelNetwork || options.refreshOnCreate || options.modelsPath !== null) throw new Error();const runtime=new ModelRuntime();runtime.path=options.authPath;return runtime; }
 getProviders(){return [{id:'fixture',name:'Fixture',auth:{apiKey:{name:'API key',login(){}},oauth:{name:'Subscription',login(){}}}}];}
 getProvider(id){return this.getProviders().find(p=>p.id===id);}
 async listCredentials(){try {await fs.stat(this.path);return [{providerId:'fixture',type:'api_key'}]} catch{return []}}
 async login(id,method,interaction){
  if(method==='oauth'){
   interaction.notify({type:'device_code',verificationUri:'https://login.example.test/device',userCode:'ABCD-EFGH'});
   await interaction.prompt({type:'manual_code',message:'Paste authorization code'});
  } else {
   const key=await interaction.prompt({type:'secret',message:'API key'});
   if(key==='reject')throw new Error('secret=reject');
   const choice=await interaction.prompt({type:'select',message:'Account',options:[{id:'personal',label:'Personal'},{id:'work',label:'Work'}]});
   if(choice!=='work')throw new Error();
  }
  await fs.mkdir(this.path.slice(0,this.path.lastIndexOf('/')),{recursive:true,mode:0o700});
  await fs.writeFile(this.path,'fixture credential',{mode:0o600});
 }
 async logout(){await fs.rm(this.path,{force:true})}
}
`,
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s.pi.path = func() string { return filepath.Join(root, "pi") }
	t.Cleanup(func() {
		s.piAuth.mu.Lock()
		flow := s.piAuth.flow
		s.piAuth.mu.Unlock()
		if flow != nil {
			flow.stop()
		}
	})
	return s
}
func authRequest(t *testing.T, s *Server, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, _ := json.Marshal(body)
	res := httptest.NewRecorder()
	s.Handler().ServeHTTP(res, httptest.NewRequest(method, "/api/v1/pi/"+path, bytes.NewReader(data)))
	return res
}
func authStart(t *testing.T, s *Server, method, operation string) piAuthState {
	t.Helper()
	res := authRequest(t, s, "POST", "auth/start", map[string]string{"requestId": piID(), "provider": "fixture", "method": method, "operation": operation})
	if res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	var response struct {
		Data piAuthState `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response.Data
}
func authWait(t *testing.T, s *Server, id string, match func(piAuthState) bool) piAuthState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		res := authRequest(t, s, "GET", "auth?id="+id, nil)
		var response struct {
			Data piAuthState `json:"data"`
		}
		json.Unmarshal(res.Body.Bytes(), &response)
		if match(response.Data) {
			return response.Data
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Timed out waiting for offline provider fixture")
	return piAuthState{}
}
func authReply(t *testing.T, s *Server, state piAuthState, value string) *httptest.ResponseRecorder {
	t.Helper()
	return authRequest(t, s, "POST", "auth/reply", map[string]string{"requestId": piID(), "id": state.ID, "promptId": state.Prompt.ID, "value": value})
}
func TestPiAuthNativeKeyFlowAndDisconnect(t *testing.T) {
	s := authTestServer(t)
	res := authRequest(t, s, "GET", "providers", nil)
	if res.Code != 200 || !strings.Contains(res.Body.String(), "Sign in with browser") || res.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(res.Body.String())
	}
	start := authStart(t, s, "api_key", "login")
	prompt := authWait(t, s, start.ID, func(v piAuthState) bool { return v.Prompt != nil })
	if prompt.Prompt.Type != "secret" {
		t.Fatal(prompt)
	}
	if s.ActiveOperations() != 1 {
		t.Fatal("Auth flow does not keep agent alive")
	}
	conflict := authRequest(t, s, "POST", "auth/start", map[string]string{"requestId": "second", "provider": "fixture", "method": "oauth", "operation": "login"})
	if conflict.Code != 409 {
		t.Fatal("Allowed overlapping sign-in")
	}
	for _, key := range []string{"!touch /tmp/not-allowed", "$API_KEY", "line\nbreak"} {
		if res := authReply(t, s, prompt, key); res.Code != 400 {
			t.Fatalf("Accepted executable or invalid key: %d", res.Code)
		}
	}
	res = authReply(t, s, prompt, "private-test-key")
	if res.Code != 200 || strings.Contains(res.Body.String(), "private-test-key") {
		t.Fatal(res.Body.String())
	}
	if res := authReply(t, s, prompt, "stale"); res.Code != 409 {
		t.Fatal("Accepted stale prompt")
	}
	choice := authWait(t, s, start.ID, func(v piAuthState) bool { return v.Prompt != nil && v.Prompt.Type == "select" })
	if res := authReply(t, s, choice, "absent"); res.Code != 400 {
		t.Fatal("Accepted unknown option")
	}
	if res := authReply(t, s, choice, "work"); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	state := authWait(t, s, start.ID, func(v piAuthState) bool { return v.Status != "working" })
	if state.Status != "done" || state.Prompt != nil {
		t.Fatal(state)
	}
	res = authRequest(t, s, "GET", "providers", nil)
	if !strings.Contains(res.Body.String(), `"credential":"api_key"`) || strings.Contains(res.Body.String(), "private-test-key") {
		t.Fatal(res.Body.String())
	}
	logout := authStart(t, s, "api_key", "logout")
	state = authWait(t, s, logout.ID, func(v piAuthState) bool { return v.Status != "working" })
	if state.Status != "done" {
		t.Fatal(state)
	}
	if _, err := os.Stat(filepath.Join(s.pi.home, ".pi/agent/auth.json")); !os.IsNotExist(err) {
		t.Fatal("Did not disconnect")
	}
}
func TestPiAuthBrowserPromptsCancellationAndSecretErrors(t *testing.T) {
	s := authTestServer(t)
	start := authStart(t, s, "oauth", "login")
	prompt := authWait(t, s, start.ID, func(v piAuthState) bool { return v.Prompt != nil })
	if prompt.Prompt.Type != "manual_code" || len(prompt.Events) != 1 || prompt.Events[0].Code != "ABCD-EFGH" {
		t.Fatal(prompt)
	}
	if res := authRequest(t, s, "GET", "auth?id=other-user", nil); res.Code != 404 {
		t.Fatal("Leaked auth flow")
	}
	res := authRequest(t, s, "POST", "auth/cancel", map[string]string{"requestId": "cancel", "id": start.ID})
	if res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	if state := authWait(t, s, start.ID, func(v piAuthState) bool { return v.Status == "cancelled" }); state.Prompt != nil {
		t.Fatal(state)
	}
	start = authStart(t, s, "api_key", "login")
	prompt = authWait(t, s, start.ID, func(v piAuthState) bool { return v.Prompt != nil })
	if res := authReply(t, s, prompt, "reject"); res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	state := authWait(t, s, start.ID, func(v piAuthState) bool { return v.Status == "error" })
	if strings.Contains(state.Error, "reject") {
		t.Fatal("Leaked provider error credentials")
	}
}
func TestPiAuthRecordsDoNotExposeUnexpectedFields(t *testing.T) {
	f := &piAuthFlow{state: piAuthState{Status: "working"}, input: nopAuthWriter{}}
	f.record([]byte(`{"type":"prompt","prompt":{"id":"1","type":"secret","message":"Key","credential":"hidden"}}`))
	f.record([]byte(`{"type":"prompt_end","id":"1"}`))
	if f.state.Prompt != nil {
		t.Fatal("Callback did not clear prompt")
	}
	f.record([]byte(`{"type":"event","event":{"type":"auth_url","url":"javascript:alert(1)","secret":"hidden"}}`))
	if f.state.Events[0].URL != "" {
		t.Fatal("Unsafe link")
	}
	data, _ := json.Marshal(f.state)
	if strings.Contains(string(data), "hidden") {
		t.Fatal("Leaked unknown field")
	}
	for _, link := range []string{"http://example.com", "https://user:secret@example.com", "data:text/html,a"} {
		if piAuthURL(link) != "" {
			t.Fatal("Accepted unsafe link")
		}
	}
	f.record([]byte(`{"type":"done"}`))
	f.record([]byte(`{"type":"prompt","prompt":{"id":"2","type":"secret","message":"Late"}}`))
	if f.state.Prompt != nil {
		t.Fatal("Reopened completed flow")
	}
}

type nopAuthWriter struct{}

func (nopAuthWriter) Write(p []byte) (int, error) { return io.Discard.Write(p) }
func (nopAuthWriter) Close() error                { return nil }

// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"lumo/server/internal/ipc"
)

const testToken = "session-token-1"
const testCSRF = "csrf-token-1"

func startStub(t *testing.T, name string, handler http.Handler) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "ltgw")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	sockPath := filepath.Join(dir, name)
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = ipc.ServeUnix(ln, handler) }()
	t.Cleanup(func() { _ = ln.Close() })
	return sockPath
}

func stubSessiond(t *testing.T) string {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /login", func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["password"] != "correct" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"token":       testToken,
			"csrf":        testCSRF,
			"user":        map[string]any{"name": "alice", "uid": 1000, "gid": 1000, "home": "/home/alice"},
			"agentSocket": stubAgent(t),
		})
	})
	mux.HandleFunc("POST /validate", func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["token"] != testToken {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"token":       testToken,
			"csrf":        testCSRF,
			"user":        map[string]any{"name": "alice", "uid": 1000, "gid": 1000, "home": "/home/alice"},
			"agentSocket": stubAgent(t),
			"reauthUntil": 0,
		})
	})
	mux.HandleFunc("POST /logout", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	})
	return startStub(t, "sessiond.sock", mux)
}

var agentSock string

func stubAgent(t *testing.T) string {
	if agentSock != "" {
		return agentSock
	}
	agentSock = startStub(t, "agent.sock", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":   true,
			"path": r.URL.Path,
			"auth": r.Header.Get("X-Lumo-Session"),
		})
	}))
	return agentSock
}

func testGateway(t *testing.T) (*Gateway, *httptest.Server) {
	t.Helper()
	agentSock = ""
	gw := New(Config{
		Addr:           "127.0.0.1:0",
		SessiondSocket: stubSessiond(t),
		Version:        "test",
	})
	srv := httptest.NewServer(gw.Handler())
	t.Cleanup(srv.Close)
	return gw, srv
}

func loginCookies(t *testing.T, srv *httptest.Server) []*http.Cookie {
	t.Helper()
	resp, err := http.Post(srv.URL+"/api/v1/auth/login", "application/json", strings.NewReader(`{"username":"alice","password":"correct"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("login status %d", resp.StatusCode)
	}
	var sessionCookie *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == "lumo_session" {
			sessionCookie = c
			if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" {
				t.Errorf("session cookie attributes: %+v", c)
			}
		}
		if c.Name == "lumo_csrf" && c.HttpOnly {
			t.Error("csrf cookie must be readable")
		}
	}
	if sessionCookie == nil {
		t.Fatal("no lumo_session cookie")
	}
	return resp.Cookies()
}

func TestLoginAndSession(t *testing.T) {
	_, srv := testGateway(t)
	cookies := loginCookies(t, srv)

	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/auth/session", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("session status %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"name":"alice"`) {
		t.Errorf("body = %s", body)
	}
}

func TestSessionRequired(t *testing.T) {
	_, srv := testGateway(t)
	resp, err := http.Get(srv.URL + "/api/v1/services")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d", resp.StatusCode)
	}
}

func TestSecurityHeaders(t *testing.T) {
	_, srv := testGateway(t)
	resp, err := http.Get(srv.URL + "/api/v1/meta/version")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	csp := resp.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "default-src 'self'") || !strings.Contains(csp, "frame-ancestors 'none'") {
		t.Errorf("content security policy = %q", csp)
	}
	if resp.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Errorf("referrer policy = %q", resp.Header.Get("Referrer-Policy"))
	}
	if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("content type options = %q", resp.Header.Get("X-Content-Type-Options"))
	}
	if resp.Header.Get("Cross-Origin-Opener-Policy") != "same-origin" || resp.Header.Get("Cross-Origin-Resource-Policy") != "same-origin" {
		t.Errorf("cross-origin headers = %q %q", resp.Header.Get("Cross-Origin-Opener-Policy"), resp.Header.Get("Cross-Origin-Resource-Policy"))
	}
	if resp.Header.Get("Permissions-Policy") != "camera=(), microphone=(), geolocation=(), payment=(), usb=()" {
		t.Errorf("permissions policy = %q", resp.Header.Get("Permissions-Policy"))
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("cache control = %q", resp.Header.Get("Cache-Control"))
	}
	if resp.Header.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS must not be sent over plain HTTP")
	}
}

func TestHSTSOnTLS(t *testing.T) {
	agentSock = ""
	gw := New(Config{SessiondSocket: stubSessiond(t), Version: "test"})
	srv := httptest.NewTLSServer(gw.Handler())
	defer srv.Close()
	resp, err := srv.Client().Get(srv.URL + "/api/v1/meta/version")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.Header.Get("Strict-Transport-Security") != "max-age=31536000" {
		t.Errorf("HSTS = %q", resp.Header.Get("Strict-Transport-Security"))
	}
}

func TestCSRFRequired(t *testing.T) {
	_, srv := testGateway(t)
	cookies := loginCookies(t, srv)

	do := func(withHeader bool) int {
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1/files/delete", strings.NewReader(`{"path":"/tmp/x","requestId":"r1"}`))
		for _, c := range cookies {
			req.AddCookie(c)
		}
		if withHeader {
			req.Header.Set("X-Lumo-CSRF", testCSRF)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if status := do(false); status != http.StatusForbidden {
		t.Errorf("no csrf header: %d", status)
	}
	if status := do(true); status != http.StatusOK {
		t.Errorf("with csrf: %d", status)
	}
}

func TestLogoutRequiresSessionAndCSRF(t *testing.T) {
	_, srv := testGateway(t)
	cookies := loginCookies(t, srv)

	request := func(withCookies, withCSRF bool, body string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest("POST", srv.URL+"/api/v1/auth/logout", strings.NewReader(body))
		if withCookies {
			for _, cookie := range cookies {
				req.AddCookie(cookie)
			}
		}
		if withCSRF {
			req.Header.Set("X-Lumo-CSRF", testCSRF)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	resp := request(false, true, `{}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("logout without session = %d", resp.StatusCode)
	}
	resp = request(true, false, `{}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("logout without CSRF = %d", resp.StatusCode)
	}
	resp = request(true, true, `{"unexpected":true}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("logout with unknown field = %d", resp.StatusCode)
	}
	resp = request(true, true, `{}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid logout = %d", resp.StatusCode)
	}
	cleared := map[string]bool{}
	for _, cookie := range resp.Cookies() {
		if cookie.MaxAge < 0 {
			cleared[cookie.Name] = true
		}
	}
	if !cleared["lumo_session"] || !cleared["lumo_csrf"] {
		t.Fatalf("logout cookies were not cleared: %v", cleared)
	}
}

func TestAuthBodiesRejectUnknownTrailingAndOversizedJSON(t *testing.T) {
	_, srv := testGateway(t)
	for _, body := range []string{
		`{"username":"alice","password":"correct","unexpected":true}`,
		`{"username":"alice","password":"correct"} {}`,
		`{"username":"alice","password":"` + strings.Repeat("x", maxAuthBodyBytes) + `"}`,
	} {
		resp, err := http.Post(srv.URL+"/api/v1/auth/login", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("login accepted malformed body with status %d", resp.StatusCode)
		}
	}
}

func TestProxyForwardsSessionToken(t *testing.T) {
	_, srv := testGateway(t)
	cookies := loginCookies(t, srv)
	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/system/identity", nil)
	for _, c := range cookies {
		req.AddCookie(c)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"auth":"`+testToken+`"`) {
		t.Errorf("agent did not receive session token: %s", body)
	}
}

func TestLoginWrongPassword(t *testing.T) {
	_, srv := testGateway(t)
	resp, err := http.Post(srv.URL+"/api/v1/auth/login", "application/json", strings.NewReader(`{"username":"alice","password":"wrong"}`))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d", resp.StatusCode)
	}
}

func TestLoginRateLimit(t *testing.T) {
	limiter := newLoginLimiter(accountLimiterThreshold)
	for i := 0; i < accountLimiterThreshold-1; i++ {
		limiter.record("k")
		if limiter.blocked("k") != 0 {
			t.Fatalf("blocked too early at %d", i)
		}
	}
	limiter.record("k")
	if limiter.blocked("k") <= 0 {
		t.Fatal("not blocked after threshold")
	}
	limiter.reset("k")
	if limiter.blocked("k") != 0 {
		t.Fatal("still blocked after reset")
	}
}

func TestLoginRateLimitsAccountAndSourceSeparately(t *testing.T) {
	gw, _ := testGateway(t)
	attempt := func(username, password, source string) int {
		t.Helper()
		body := fmt.Sprintf(`{"username":%q,"password":%q}`, username, password)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
		req.RemoteAddr = source
		w := httptest.NewRecorder()
		gw.handleLogin(w, req)
		return w.Code
	}

	for i := 0; i < accountLimiterThreshold; i++ {
		status := attempt("alice", "wrong", fmt.Sprintf("192.0.2.%d:4000", i+1))
		if status != http.StatusUnauthorized {
			t.Fatalf("account failure %d = %d", i, status)
		}
	}
	if status := attempt(" ALICE ", "correct", "192.0.2.100:4000"); status != http.StatusConflict {
		t.Fatalf("rotating source bypassed account limit: %d", status)
	}

	for i := 0; i < sourceLimiterThreshold; i++ {
		status := attempt(fmt.Sprintf("rotating-%d", i), "wrong", "198.51.100.10:5000")
		if status != http.StatusUnauthorized {
			t.Fatalf("source failure %d = %d", i, status)
		}
	}
	if status := attempt("fresh", "correct", "198.51.100.10:5001"); status != http.StatusConflict {
		t.Fatalf("rotating account bypassed source limit: %d", status)
	}
}

func TestLoginLimiterExpiresAndBoundsEntries(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	limiter := newLoginLimiter(accountLimiterThreshold)
	limiter.now = func() time.Time { return now }
	for i := 0; i < accountLimiterThreshold; i++ {
		limiter.record("alice")
	}
	if limiter.blocked("alice") <= 0 {
		t.Fatal("account was not blocked")
	}
	now = now.Add(limiterWindow)
	if limiter.blocked("alice") != 0 {
		t.Fatal("expired account remained blocked")
	}
	for i := 0; i < limiterMaxEntries+10; i++ {
		limiter.record(fmt.Sprintf("key-%d", i))
	}
	if len(limiter.failed) != limiterMaxEntries {
		t.Fatalf("entry count = %d", len(limiter.failed))
	}
	if loginAccountKey(" Alice ") != loginAccountKey("alice") || len(loginAccountKey(strings.Repeat("a", 80))) != 64 {
		t.Fatal("account key normalization is unstable")
	}
}

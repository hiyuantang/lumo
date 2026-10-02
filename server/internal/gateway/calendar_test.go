// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"net/http"
	"strings"
	"testing"
)

func TestGoogleReturnCookieIsRestrictedAndRedirectIsPreserved(t *testing.T) {
	_, srv := testGateway(t)
	agentSock = startStub(t, "calendar-agent.sock", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Lumo-Session") != testToken {
			t.Error("missing authenticated user")
		}
		if r.URL.Path == "/api/v1/calendar/google/callback" {
			http.Redirect(w, r, "/?calendar=google-connected", http.StatusSeeOther)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true,"data":{}}`))
	}))
	cookies := loginCookies(t, srv)
	client := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/calendar/google", strings.NewReader(`{"action":"connect"}`))
	for _, c := range cookies {
		req.AddCookie(c)
	}
	req.Header.Set("X-Lumo-CSRF", testCSRF)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal(res.StatusCode)
	}
	var oauth *http.Cookie
	for _, cookie := range res.Cookies() {
		if cookie.Name == "lumo_calendar_oauth" {
			oauth = cookie
		}
	}
	if oauth == nil || !oauth.HttpOnly || oauth.Path != "/api/v1/calendar/google/callback" || oauth.SameSite != http.SameSiteLaxMode || oauth.MaxAge != 600 {
		t.Fatalf("unrestricted return cookie: %+v", oauth)
	}
	req, _ = http.NewRequest("GET", srv.URL+"/api/v1/pi/extensions", nil)
	req.AddCookie(oauth)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("return cookie authenticated unrelated API")
	}
	req, _ = http.NewRequest("GET", srv.URL+"/api/v1/calendar/google/callback?state=state&code=code", nil)
	req.AddCookie(oauth)
	res, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 303 || res.Header.Get("Location") != "/?calendar=google-connected" {
		t.Fatalf("redirect swallowed: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
	cleared := false
	for _, cookie := range res.Cookies() {
		if cookie.Name == oauth.Name && cookie.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Fatal("return cookie retained")
	}
}

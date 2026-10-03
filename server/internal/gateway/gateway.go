// SPDX-License-Identifier: AGPL-3.0-only
package gateway

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"

	"lumo/server/internal/appplugins"
	"lumo/server/internal/httpapi"
	"lumo/server/internal/ipc"
	"lumo/server/internal/strictjson"
)

const (
	contentSecurityPolicy = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; worker-src 'none'; manifest-src 'self'"
	maxAuthBodyBytes      = 1 << 20
)

type User struct {
	Name string `json:"name"`
	UID  uint32 `json:"uid"`
	GID  uint32 `json:"gid"`
	Home string `json:"home"`
}

type sessionInfo struct {
	Token       string
	CSRF        string
	User        User
	AgentSocket string
}

type Config struct {
	Addr           string
	SessiondSocket string
	Static         http.Handler
	Version        string
}

type Gateway struct {
	cfg            Config
	sessiond       *http.Client
	accountLimiter *loginLimiter
	sourceLimiter  *loginLimiter

	clientsMu sync.Mutex
	clients   map[string]*http.Client
}

func New(cfg Config) *Gateway {
	return &Gateway{
		cfg:            cfg,
		sessiond:       ipc.HTTPClient(cfg.SessiondSocket),
		accountLimiter: newLoginLimiter(accountLimiterThreshold),
		sourceLimiter:  newLoginLimiter(sourceLimiterThreshold),
		clients:        map[string]*http.Client{},
	}
}

func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/login", g.handleLogin)
	mux.HandleFunc("POST /api/v1/auth/logout", g.handleLogout)
	mux.HandleFunc("GET /api/v1/auth/session", g.handleSession)
	mux.HandleFunc("POST /api/v1/auth/reauth", g.handleReauth)
	mux.HandleFunc("GET /api/v1/meta/version", g.handleVersion)
	mux.HandleFunc("GET /api/v1/ws", g.handleWS)
	for _, method := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
		mux.HandleFunc(method+" /api/v1/", g.handleAPI)
	}
	if g.cfg.Static != nil {
		mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				httpapi.WriteError(w, httpapi.NewError(httpapi.CodeNotFound, "Unknown endpoint."))
				return
			}
			g.cfg.Static.ServeHTTP(w, r)
		}))
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeNotFound, "Unknown endpoint."))
	})
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", contentSecurityPolicy)
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		if r.URL.Path == "/api/v1/desktop-apps/frame" {
			w.Header().Set("Content-Security-Policy", "sandbox allow-scripts; frame-ancestors 'self'; base-uri 'none'")
			w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		}
		w.Header().Set("X-Permitted-Cross-Domain-Policies", "none")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		if r.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (g *Gateway) handleVersion(w http.ResponseWriter, _ *http.Request) {
	httpapi.WriteData(w, map[string]any{
		"version":          g.cfg.Version,
		"protocolVersions": []int{1},
	})
}

func (g *Gateway) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := strictjson.Decode(w, r, maxAuthBodyBytes, &req); err != nil {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	accountKey := loginAccountKey(req.Username)
	sourceKey := clientIP(r)
	retryAfter := g.accountLimiter.blocked(accountKey)
	if sourceRetryAfter := g.sourceLimiter.blocked(sourceKey); sourceRetryAfter > retryAfter {
		retryAfter = sourceRetryAfter
	}
	if retryAfter > 0 {
		err := httpapi.NewError(httpapi.CodeBusy, "Too many failed attempts; retry later.")
		err.Details = map[string]any{"retryAfterMs": retryAfter.Milliseconds()}
		httpapi.WriteError(w, err)
		return
	}
	var resp struct {
		Token       string `json:"token"`
		CSRF        string `json:"csrf"`
		User        User   `json:"user"`
		AgentSocket string `json:"agentSocket"`
	}
	status, err := g.sessiondCall("/login", map[string]any{"username": req.Username, "password": req.Password}, &resp)
	if err != nil {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnavailable, "The session daemon is unavailable."))
		return
	}
	if status == http.StatusUnauthorized {
		g.accountLimiter.record(accountKey)
		g.sourceLimiter.record(sourceKey)
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnauthorized, "Invalid username or password."))
		return
	}
	if status != http.StatusOK {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnavailable, "Login is unavailable."))
		return
	}
	g.accountLimiter.reset(accountKey)
	g.setSessionCookies(w, r, resp.Token, resp.CSRF)
	httpapi.WriteData(w, map[string]any{"user": resp.User, "csrf": resp.CSRF})
}

func (g *Gateway) handleLogout(w http.ResponseWriter, r *http.Request) {
	sess, apiErr := g.requireSession(r)
	if apiErr != nil {
		httpapi.WriteError(w, apiErr)
		return
	}
	if apiErr := g.checkCSRF(r, sess); apiErr != nil {
		httpapi.WriteError(w, apiErr)
		return
	}
	var req struct{}
	if err := strictjson.Decode(w, r, maxAuthBodyBytes, &req); err != nil {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	status, err := g.sessiondCall("/logout", map[string]any{"token": sess.Token}, nil)
	if err != nil || status != http.StatusOK {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnavailable, "Logout is unavailable."))
		return
	}
	g.clearSessionCookies(w, r)
	httpapi.WriteData(w, map[string]any{"ok": true})
}

func (g *Gateway) handleSession(w http.ResponseWriter, r *http.Request) {
	sess, apiErr := g.requireSession(r)
	if apiErr != nil {
		httpapi.WriteError(w, apiErr)
		return
	}
	httpapi.WriteData(w, map[string]any{"user": sess.User})
}

func (g *Gateway) handleReauth(w http.ResponseWriter, r *http.Request) {
	sess, apiErr := g.requireSession(r)
	if apiErr != nil {
		httpapi.WriteError(w, apiErr)
		return
	}
	if apiErr := g.checkCSRF(r, sess); apiErr != nil {
		httpapi.WriteError(w, apiErr)
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := strictjson.Decode(w, r, maxAuthBodyBytes, &req); err != nil {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeValidationFailed, "Body must be a JSON object."))
		return
	}
	var resp struct {
		ReauthenticatedUntil int64 `json:"reauthenticatedUntil"`
	}
	status, err := g.sessiondCall("/reauth", map[string]any{"token": sess.Token, "password": req.Password}, &resp)
	if err != nil {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnavailable, "The session daemon is unavailable."))
		return
	}
	if status == http.StatusUnauthorized {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnauthorized, "Invalid password."))
		return
	}
	if status != http.StatusOK {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnavailable, "Reauthentication is unavailable."))
		return
	}
	httpapi.WriteData(w, map[string]any{"reauthenticatedUntil": resp.ReauthenticatedUntil})
}

func (g *Gateway) handleAPI(w http.ResponseWriter, r *http.Request) {
	sess, apiErr := g.requireSession(r)
	if apiErr != nil {
		httpapi.WriteError(w, apiErr)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		if apiErr := g.checkCSRF(r, sess); apiErr != nil {
			httpapi.WriteError(w, apiErr)
			return
		}
	}
	if app := appplugins.AuthForPath(r.URL.Path, true); app != nil {
		g.pluginOAuthCookie(w, r, app, "", -1)
	}
	g.proxyREST(w, r, sess)
}

func (g *Gateway) requireSession(r *http.Request) (*sessionInfo, *httpapi.Error) {
	cookie, err := r.Cookie("lumo_session")
	if err != nil && r.Method == http.MethodGet {
		if app := appplugins.AuthForPath(r.URL.Path, true); app != nil {
			cookie, err = r.Cookie("lumo_" + app.Name + "_oauth")
		}
	}
	if err != nil || cookie.Value == "" {
		return nil, httpapi.NewError(httpapi.CodeUnauthorized, "No session.")
	}
	var resp struct {
		Token       string `json:"token"`
		CSRF        string `json:"csrf"`
		User        User   `json:"user"`
		AgentSocket string `json:"agentSocket"`
	}
	status, err := g.sessiondCall("/validate", map[string]any{"token": cookie.Value}, &resp)
	if err != nil {
		return nil, httpapi.NewError(httpapi.CodeUnavailable, "The session daemon is unavailable.")
	}
	if status == http.StatusNotFound || status == http.StatusUnauthorized {
		return nil, httpapi.NewError(httpapi.CodeUnauthorized, "Session expired or unknown.")
	}
	if status != http.StatusOK {
		return nil, httpapi.NewError(httpapi.CodeUnavailable, "The session agent could not be started. Please try again.")
	}
	return &sessionInfo{Token: resp.Token, CSRF: resp.CSRF, User: resp.User, AgentSocket: resp.AgentSocket}, nil
}

func (g *Gateway) checkCSRF(r *http.Request, sess *sessionInfo) *httpapi.Error {
	header := r.Header.Get("X-Lumo-CSRF")
	if header == "" || header != sess.CSRF {
		return httpapi.NewError(httpapi.CodeForbidden, "CSRF check failed.")
	}
	cookie, err := r.Cookie("lumo_csrf")
	if err != nil || cookie.Value != sess.CSRF {
		return httpapi.NewError(httpapi.CodeForbidden, "CSRF check failed.")
	}
	return nil
}

func (g *Gateway) setSessionCookies(w http.ResponseWriter, r *http.Request, token, csrf string) {
	secure := r.TLS != nil
	http.SetCookie(w, &http.Cookie{
		Name:     "lumo_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "lumo_csrf",
		Value:    csrf,
		Path:     "/",
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
}

func (g *Gateway) pluginOAuthCookie(w http.ResponseWriter, r *http.Request, app *appplugins.Package, token string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: "lumo_" + app.Name + "_oauth", Value: token, Path: app.Manifest.Auth.Callback, HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}
func (g *Gateway) clearSessionCookies(w http.ResponseWriter, r *http.Request) {
	secure := r.TLS != nil
	for _, name := range appplugins.Names() {
		if app, err := appplugins.Load(name); err == nil && app.Manifest.Auth != nil {
			g.pluginOAuthCookie(w, r, app, "", -1)
		}
	}
	for _, name := range []string{"lumo_session", "lumo_csrf"} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			MaxAge:   -1,
			HttpOnly: name == "lumo_session",
			Secure:   secure,
			SameSite: http.SameSiteStrictMode,
		})
	}
}

func (g *Gateway) sessiondCall(path string, body any, out any) (int, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequest("POST", "http://sessiond"+path, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.sessiond.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if out != nil && resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return 0, err
		}
	} else {
		_, _ = io.Copy(io.Discard, resp.Body)
	}
	return resp.StatusCode, nil
}

func (g *Gateway) agentClient(socketPath string) *http.Client {
	g.clientsMu.Lock()
	defer g.clientsMu.Unlock()
	if c, ok := g.clients[socketPath]; ok {
		return c
	}
	c := ipc.HTTPClient(socketPath)
	g.clients[socketPath] = c
	return c
}

func (g *Gateway) proxyREST(w http.ResponseWriter, r *http.Request, sess *sessionInfo) {
	req2 := r.Clone(r.Context())
	req2.URL.Scheme = "http"
	req2.URL.Host = "agent"
	req2.RequestURI = ""
	req2.Header = r.Header.Clone()
	req2.Header.Set("X-Lumo-Session", sess.Token)
	client := g.agentClient(sess.AgentSocket)
	if appplugins.AuthForPath(r.URL.Path, true) != nil {
		copy := *client
		copy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
		client = &copy
	}
	resp, err := client.Do(req2)
	if err != nil {
		httpapi.WriteError(w, httpapi.NewError(httpapi.CodeUnavailable, "The session agent is unavailable."))
		return
	}
	defer resp.Body.Close()
	if r.Method == http.MethodPost && resp.StatusCode == http.StatusOK {
		if app := appplugins.AuthForPath(r.URL.Path, false); app != nil {
			g.pluginOAuthCookie(w, r, app, sess.Token, 600)
		}
	}
	copyHeader(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func copyHeader(dst, src http.Header) {
	hopByHop := map[string]bool{
		"Connection": true, "Keep-Alive": true, "Proxy-Authenticate": true,
		"Proxy-Authorization": true, "Te": true, "Trailer": true,
		"Transfer-Encoding": true, "Upgrade": true,
	}
	for k, values := range src {
		if hopByHop[http.CanonicalHeaderKey(k)] {
			continue
		}
		for _, v := range values {
			dst.Add(k, v)
		}
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func loginAccountKey(username string) string {
	key := strings.ToLower(strings.TrimSpace(username))
	if len(key) > 64 {
		key = key[:64]
	}
	return key
}

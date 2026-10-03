// SPDX-License-Identifier: AGPL-3.0-only
package plugin

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"time"
)

const MaxBodyBytes = 1 << 20
const (
	CodeUnauthorized     = "unauthorized"
	CodeForbidden        = "forbidden"
	CodeNotFound         = "not_found"
	CodeConflict         = "conflict"
	CodeStaleRevision    = "stale_revision"
	CodeValidationFailed = "validation_failed"
	CodeBusy             = "busy"
	CodeUnavailable      = "unavailable"
	CodeInternal         = "internal"
)

type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string             { return e.Code + ": " + e.Message }
func NewError(code, message string) *Error { return &Error{code, message} }
func WriteData(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": data})
}
func WriteError(w http.ResponseWriter, err error) {
	api := NewError(CodeInternal, "Internal server error.")
	if !errors.As(err, &api) {
		switch {
		case errors.Is(err, os.ErrNotExist):
			api = NewError(CodeNotFound, "The path does not exist.")
		case errors.Is(err, os.ErrPermission):
			api = NewError(CodeForbidden, "Permission denied.")
		}
	}
	status := map[string]int{CodeUnauthorized: 401, CodeForbidden: 403, CodeNotFound: 404, CodeConflict: 409, CodeStaleRevision: 409, CodeValidationFailed: 400, CodeBusy: 409, CodeUnavailable: 503, CodeInternal: 500}[api.Code]
	if status == 0 {
		status = 500
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": api})
}
func Unavailable(w http.ResponseWriter, r *http.Request) {
	WriteError(w, NewError(CodeUnavailable, "This capability is unavailable."))
}
func ValidRequestID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for _, c := range id {
		if c < 0x21 || c > 0x7e {
			return false
		}
	}
	return true
}

type BrokerAction struct {
	RequestID string         `json:"requestId"`
	Action    string         `json:"action"`
	Arguments map[string]any `json:"arguments"`
	Expected  any            `json:"expected,omitempty"`
}
type Reply struct {
	Status  int           `json:"status"`
	Headers http.Header   `json:"headers"`
	Body    []byte        `json:"body"`
	Broker  *BrokerAction `json:"broker,omitempty"`
}

func ForwardBrokerAction(w http.ResponseWriter, _ *http.Request, action BrokerAction, _ time.Duration) {
	raw, err := json.Marshal(action)
	if err != nil {
		WriteError(w, err)
		return
	}
	w.Header().Set("X-Lumo-Plugin-Broker", string(raw))
}
func Serve(handler http.Handler) {
	request, err := http.ReadRequest(bufio.NewReader(io.LimitReader(os.Stdin, MaxBodyBytes+65536)))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Invalid host request.")
		os.Exit(1)
	}
	request.Body = http.MaxBytesReader(nil, request.Body, MaxBodyBytes)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	result := Reply{Status: recorder.Code, Headers: recorder.Header(), Body: recorder.Body.Bytes()}
	if raw := result.Headers.Get("X-Lumo-Plugin-Broker"); raw != "" {
		if err = json.Unmarshal([]byte(raw), &result.Broker); err != nil {
			fmt.Fprintln(os.Stderr, "Invalid broker request.")
			os.Exit(1)
		}
		result.Headers.Del("X-Lumo-Plugin-Broker")
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		os.Exit(1)
	}
}

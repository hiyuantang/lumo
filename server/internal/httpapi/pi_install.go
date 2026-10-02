// SPDX-License-Identifier: AGPL-3.0-only
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"lumo/server/internal/broker"
	"lumo/server/internal/piruntime"
	"lumo/server/internal/strictjson"
	"lumo/server/internal/terminal"
	"lumo/server/internal/updates"
)

var piVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$`)
var ansiOutput = regexp.MustCompile(`\x1b\[[0-?]*[ -/]*[@-~]`)

type piPlan struct {
	updates.Plan
	Path string
	From string
}
type piSaved struct {
	Jobs    map[string]updates.Progress    `json:"jobs"`
	History []broker.AppUpdateHistoryEntry `json:"history"`
}
type piWorker struct {
	mu        sync.Mutex
	operation sync.Mutex
	home      string
	path      func() string
	latest    func(context.Context) (string, error)
	run       func(context.Context, string, ...string) (string, error)
	plans     map[string]piPlan
	saved     piSaved
	loadError error
}

func newPiWorker() *piWorker {
	home := ""
	if u, err := user.Current(); err == nil {
		home = u.HomeDir
	}
	worker := &piWorker{home: home, path: terminal.PiPath, latest: latestPiVersion, plans: map[string]piPlan{}, saved: piSaved{Jobs: map[string]updates.Progress{}, History: []broker.AppUpdateHistoryEntry{}}}
	worker.run = worker.command
	data, err := os.ReadFile(worker.statePath())
	if err == nil {
		worker.loadError = json.Unmarshal(data, &worker.saved)
		for id, progress := range worker.saved.Jobs {
			if !progress.Done {
				progress.Done = true
				progress.Error = "The server restarted during this operation. Check the installed version before trying again."
				progress.Phase = "complete"
				worker.saved.Jobs[id] = progress
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		worker.loadError = err
	}
	if worker.saved.Jobs == nil {
		worker.saved.Jobs = map[string]updates.Progress{}
	}
	return worker
}

func (o *piWorker) statePath() string {
	return filepath.Join(o.home, ".local/state/lumo/pi-operations.json")
}
func (o *piWorker) save() error {
	if o.home == "" {
		return errors.New("Linux account home is unavailable")
	}
	path := o.statePath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(o.saved)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".pi-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}

func latestPiVersion(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://registry.npmjs.org/@earendil-works%2fpi-coding-agent/latest", nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(req)
	if err != nil {
		return "", errors.New("Could not check the latest Pi version. Check the server's internet connection.")
	}
	defer response.Body.Close()
	var release struct {
		Version string `json:"version"`
	}
	if response.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&release) != nil || !piVersion.MatchString(release.Version) {
		return "", errors.New("Pi version information is unavailable")
	}
	return release.Version, nil
}

type limitedCommandOutput struct {
	mu   sync.Mutex
	text string
}

func (b *limitedCommandOutput) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.text += string(data)
	if len(b.text) > 8192 {
		b.text = b.text[len(b.text)-8192:]
	}
	return len(data), nil
}
func (o *piWorker) command(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = o.home
	cmd.Env = append(os.Environ(), "HOME="+o.home, "PATH="+piruntime.Bin(o.home)+":"+filepath.Join(o.home, ".local/share/lumo/pi/bin")+":"+filepath.Join(o.home, ".local/bin")+":/usr/local/bin:/usr/bin:/bin", "CI=1", "NO_COLOR=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	output := &limitedCommandOutput{}
	cmd.Stdout = output
	cmd.Stderr = output
	err := cmd.Run()
	return strings.TrimSpace(ansiOutput.ReplaceAllString(output.text, "")), err
}
func (o *piWorker) version(ctx context.Context, path string) (string, error) {
	if path == "" {
		return "", nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	value, err := o.run(ctx, path, "--version")
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	if err != nil || !piVersion.MatchString(value) {
		return "", errors.New("Could not read the installed Pi version")
	}
	return value, nil
}
func newerPiVersion(latest, installed string) bool {
	if installed == "" {
		return true
	}
	latestParts := strings.SplitN(latest, "-", 2)
	installedParts := strings.SplitN(installed, "-", 2)
	a := strings.Split(latestParts[0], ".")
	b := strings.Split(installedParts[0], ".")
	for i := 0; i < 3; i++ {
		x, _ := strconv.ParseUint(a[i], 10, 64)
		y, _ := strconv.ParseUint(b[i], 10, 64)
		if x != y {
			return x > y
		}
	}
	if len(latestParts) != len(installedParts) {
		return len(latestParts) < len(installedParts)
	}
	return false
}

func piID() string {
	var bytes [12]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		panic(err)
	}
	return "pi_" + hex.EncodeToString(bytes[:])
}

func (o *piWorker) plan(ctx context.Context, operation string) (updates.Plan, error) {
	if !o.operation.TryLock() {
		return updates.Plan{}, NewError(CodeConflict, "Pi installation or update is already running.")
	}
	defer o.operation.Unlock()
	path := o.path()
	if operation == "install" && path != "" {
		return updates.Plan{}, NewError(CodeConflict, "Pi is already installed. Check for updates instead.")
	}
	if operation == "update" && path == "" {
		return updates.Plan{}, NewError(CodeConflict, "Pi is no longer installed. Install it first.")
	}
	if path != "" && path != filepath.Join(o.home, ".local/share/lumo/pi/bin/pi") {
		return updates.Plan{}, NewError(CodeForbidden, "Update this copy of Pi using the package manager that installed it.")
	}
	from, err := o.version(ctx, path)
	if err != nil {
		return updates.Plan{}, NewError(CodeUnavailable, err.Error())
	}
	latest, err := o.latest(ctx)
	if err != nil {
		return updates.Plan{}, NewError(CodeUnavailable, err.Error())
	}
	now := time.Now().UTC()
	plan := updates.Plan{ID: piID(), AppID: "pi", Operation: operation, CreatedAt: now, ExpiresAt: now.Add(15 * time.Minute), Packages: []updates.Package{}}
	if newerPiVersion(latest, from) {
		plan.Packages = append(plan.Packages, updates.Package{Name: "pi", FromVersion: from, ToVersion: latest})
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	for id, saved := range o.plans {
		if saved.ExpiresAt.Before(now) {
			delete(o.plans, id)
		}
	}
	if len(o.plans) >= 100 {
		return updates.Plan{}, NewError(CodeConflict, "Too many pending Pi operations. Try again later.")
	}
	o.plans[plan.ID] = piPlan{Plan: plan, Path: path, From: from}
	return plan, nil
}

func (o *piWorker) start(requestID, planID string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.loadError != nil {
		return NewError(CodeUnavailable, "Pi operation history could not be read.")
	}
	if previous, ok := o.saved.Jobs[requestID]; ok {
		if previous.PlanID != planID {
			return NewError(CodeConflict, "This request already belongs to a different operation.")
		}
		return nil
	}
	plan, ok := o.plans[planID]
	if !ok || time.Now().After(plan.ExpiresAt) {
		return NewError(CodeConflict, "Pi plan expired. Check again before continuing.")
	}
	for _, job := range o.saved.Jobs {
		if job.PlanID == planID {
			return NewError(CodeConflict, "This Pi plan has already been applied.")
		}
	}
	if !o.operation.TryLock() {
		return NewError(CodeConflict, "Pi installation or update is already running.")
	}
	progress := updates.Progress{RequestID: requestID, PlanID: planID, Phase: "installing", Percent: 10, Message: "Installing Pi…", UpdatedAt: time.Now().UTC()}
	if plan.Operation == "update" {
		progress.Message = "Updating Pi…"
	}
	if len(o.saved.Jobs) >= 100 {
		oldest := ""
		var when time.Time
		for id, job := range o.saved.Jobs {
			if job.Done && (oldest == "" || job.UpdatedAt.Before(when)) {
				oldest = id
				when = job.UpdatedAt
			}
		}
		delete(o.saved.Jobs, oldest)
	}
	o.saved.Jobs[requestID] = progress
	if err := o.save(); err != nil {
		delete(o.saved.Jobs, requestID)
		o.operation.Unlock()
		return NewError(CodeUnavailable, "Could not save the Pi operation.")
	}
	go o.execute(requestID, plan)
	return nil
}

func (o *piWorker) stage(id, message string, percent int) {
	o.mu.Lock()
	defer o.mu.Unlock()
	progress := o.saved.Jobs[id]
	progress.Message = message
	progress.Percent = percent
	progress.UpdatedAt = time.Now().UTC()
	o.saved.Jobs[id] = progress
}

func (o *piWorker) execute(id string, plan piPlan) {
	defer o.operation.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	run := func() (string, error) {
		path := o.path()
		from, err := o.version(ctx, path)
		if err != nil {
			return "", err
		}
		if path != plan.Path || from != plan.From {
			return "", errors.New("The Pi installation changed. Check again before continuing.")
		}
		if len(plan.Packages) == 0 {
			return from, nil
		}
		o.stage(id, "Preparing Pi's runtime…", 10)
		npm, err := piruntime.Ensure(ctx, o.home, o.run)
		if err != nil {
			return "", err
		}
		o.stage(id, "Installing Pi for your account…", 30)
		output, err := o.run(ctx, npm, "install", "--global", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", filepath.Join(o.home, ".local/share/lumo/pi"), "@earendil-works/pi-coding-agent@"+plan.Packages[0].ToVersion)
		if err != nil {
			return "", fmt.Errorf("Pi command failed: %w. %s", err, output)
		}
		o.stage(id, "Checking the installed version…", 90)
		to, err := o.version(ctx, o.path())
		if err != nil {
			return "", err
		}
		if to == "" {
			return "", errors.New("The command finished but Pi was not found")
		}
		if to != plan.Packages[0].ToVersion {
			return "", errors.New("The command finished but the requested Pi version is not installed")
		}
		return to, nil
	}
	to, err := run()
	o.mu.Lock()
	defer o.mu.Unlock()
	progress := o.saved.Jobs[id]
	progress.Done = true
	progress.Success = err == nil
	progress.Phase = "complete"
	progress.Percent = 100
	progress.UpdatedAt = time.Now().UTC()
	progress.Message = "Pi is ready"
	if err != nil {
		progress.Error = err.Error()
		progress.Message = "Pi operation failed"
	}
	o.saved.Jobs[id] = progress
	if plan.Operation == "update" && len(plan.Packages) > 0 {
		packages := append([]updates.Package(nil), plan.Packages...)
		if to != "" {
			packages[0].ToVersion = to
		}
		o.saved.History = append([]broker.AppUpdateHistoryEntry{{RequestID: id, AppID: "pi", CompletedAt: progress.UpdatedAt.Format(time.RFC3339Nano), Success: progress.Success, Error: progress.Error, Packages: packages}}, o.saved.History...)
		if len(o.saved.History) > 50 {
			o.saved.History = o.saved.History[:50]
		}
	}
	if err := o.save(); err != nil {
		progress.Success = false
		progress.Error = "The command completed, but its result could not be saved. Refresh installed apps to check the result."
		o.saved.Jobs[id] = progress
	}
}

func (s *Server) handlePiPlan(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequestID string `json:"requestId"`
		Operation string `json:"operation"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || (req.Operation != "install" && req.Operation != "update") {
		WriteError(w, NewError(CodeValidationFailed, "Choose install or update."))
		return
	}
	s.mutate(w, req.RequestID, func(w http.ResponseWriter) {
		plan, err := s.pi.plan(r.Context(), req.Operation)
		if err != nil {
			WriteError(w, err)
			return
		}
		WriteData(w, map[string]any{"plan": plan})
	})
}
func (s *Server) handlePiApply(w http.ResponseWriter, r *http.Request) {
	if s.piRunning() {
		WriteError(w, NewError(CodeConflict, "Close Pi projects before updating."))
		return
	}
	var req struct {
		RequestID string `json:"requestId"`
		PlanID    string `json:"planId"`
	}
	if strictjson.Decode(w, r, maxBodyBytes, &req) != nil || !validRequestID(req.RequestID) || !strings.HasPrefix(req.RequestID, "pi_") {
		WriteError(w, NewError(CodeValidationFailed, "An Pi requestId and planId are required."))
		return
	}
	if err := s.pi.start(req.RequestID, req.PlanID); err != nil {
		WriteError(w, err)
		return
	}
	WriteData(w, map[string]any{"requestId": req.RequestID})
}
func (s *Server) handlePiProgress(w http.ResponseWriter, r *http.Request) {
	s.pi.mu.Lock()
	progress, ok := s.pi.saved.Jobs[r.URL.Query().Get("requestId")]
	s.pi.mu.Unlock()
	if !ok {
		WriteError(w, NewError(CodeNotFound, "Pi operation not found. Refresh installed apps before trying again."))
		return
	}
	WriteData(w, progress)
}

func (s *Server) ActiveOperations() int {
	s.pi.mu.Lock()
	defer s.pi.mu.Unlock()
	s.piRPC.mu.Lock()
	count := int(s.folderMoves.Load()) + len(s.piRPC.processes)
	if s.piAuthRunning() {
		count++
	}
	s.piRPC.mu.Unlock()
	for _, progress := range s.pi.saved.Jobs {
		if !progress.Done {
			count++
		}
	}
	return count
}

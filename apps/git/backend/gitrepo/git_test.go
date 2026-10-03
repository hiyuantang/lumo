// SPDX-License-Identifier: AGPL-3.0-only
package gitrepo

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	data, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, data)
	}
	return string(data)
}
func fixture(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Fatal("Git is required for offline repository tests")
	}
	path := t.TempDir()
	git(t, path, "init", "-b", "main")
	git(t, path, "config", "user.name", "Local test")
	git(t, path, "config", "user.email", "local@example.invalid")
	git(t, path, "config", "commit.gpgsign", "false")
	git(t, path, "config", "core.hooksPath", "/dev/null")
	return path
}
func write(t *testing.T, path, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(path, name), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}
func snapshot(t *testing.T, path string) Snapshot {
	t.Helper()
	s, err := Read(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func action(t *testing.T, path, kind string, fields Action) {
	t.Helper()
	fields.Path = path
	fields.Action = kind
	fields.Revision = snapshot(t, path).Revision
	if err := Run(context.Background(), fields); err != nil {
		t.Fatal(err)
	}
}
func TestStageCommitHistoryAndPartialStage(t *testing.T) {
	p := fixture(t)
	write(t, p, "file with spaces.txt", "first\n")
	s := snapshot(t, p)
	if s.Head != "" || len(s.Files) != 1 || s.Branch != "main" {
		t.Fatalf("unborn: %+v", s)
	}
	d, err := GetDiff(context.Background(), p, "file with spaces.txt", "", false)
	if err != nil || !strings.Contains(d.Text, "+first") {
		t.Fatalf("new diff %+v %v", d, err)
	}
	action(t, p, "stage", Action{File: "file with spaces.txt"})
	action(t, p, "unstage", Action{File: "file with spaces.txt"})
	if snapshot(t, p).Files[0].Index != "?" {
		t.Fatal("unborn unstage lost file")
	}
	action(t, p, "stage", Action{File: "file with spaces.txt"})
	action(t, p, "commit", Action{Message: "First commit\n\nBody"})
	s = snapshot(t, p)
	if len(s.Files) != 0 || len(s.History) != 1 || s.History[0].Subject != "First commit" || !strings.Contains(s.History[0].Body, "Body") {
		t.Fatalf("history %+v", s)
	}
	write(t, p, "file with spaces.txt", "staged\n")
	action(t, p, "stage", Action{File: "file with spaces.txt"})
	write(t, p, "file with spaces.txt", "unstaged\n")
	d, err = GetDiff(context.Background(), p, "file with spaces.txt", "", true)
	if err != nil || !strings.Contains(d.Text, "+staged") || strings.Contains(d.Text, "+unstaged") {
		t.Fatalf("staged %+v %v", d, err)
	}
	action(t, p, "commit", Action{Message: "Only index"})
	if !strings.Contains(git(t, p, "show", "HEAD:file with spaces.txt"), "staged") {
		t.Fatal("committed working content")
	}
	if snapshot(t, p).Files[0].Worktree != "M" {
		t.Fatal("working edit lost")
	}
}
func TestStaleRevisionAndLiteralPaths(t *testing.T) {
	p := fixture(t)
	write(t, p, "normal.txt", "first\n")
	write(t, p, ":(glob)*", "literal\n")
	stale := snapshot(t, p)
	write(t, p, "normal.txt", "changed elsewhere\n")
	err := Run(context.Background(), Action{Path: p, Revision: stale.Revision, Action: "stage", File: "normal.txt"})
	if !errors.Is(err, ErrStale) {
		t.Fatalf("expected stale, got %v", err)
	}
	action(t, p, "stage", Action{File: ":(glob)*"})
	s := snapshot(t, p)
	for _, f := range s.Files {
		if f.Path == "normal.txt" && f.Index != "?" {
			t.Fatal("pathspec expanded")
		}
	}
	for _, file := range []string{"../outside", "/etc/passwd", "a/../../outside", ""} {
		err := Run(context.Background(), Action{Path: p, Revision: s.Revision, Action: "stage", File: file})
		if err == nil {
			t.Fatalf("accepted %q", file)
		}
	}
}
func TestBranchesAndOfflineRemoteSync(t *testing.T) {
	p := fixture(t)
	write(t, p, "file.txt", "one\n")
	action(t, p, "stage", Action{File: "file.txt"})
	action(t, p, "commit", Action{Message: "Initial"})
	remote := t.TempDir()
	git(t, remote, "init", "--bare", "-b", "main")
	git(t, p, "remote", "add", "origin", remote)
	action(t, p, "push", Action{Remote: "origin"})
	if snapshot(t, p).Upstream != "origin/main" {
		t.Fatal("upstream missing")
	}
	other := fixture(t)
	git(t, other, "remote", "add", "origin", remote)
	git(t, other, "pull", "origin", "main")
	write(t, other, "other.txt", "remote\n")
	git(t, other, "add", ".")
	git(t, other, "commit", "-m", "Remote commit")
	git(t, other, "push", "origin", "main")
	action(t, p, "fetch", Action{Remote: "origin"})
	if snapshot(t, p).Behind != 1 {
		t.Fatal("behind missing")
	}
	action(t, p, "pull", Action{Remote: "origin"})
	if _, err := os.Stat(filepath.Join(p, "other.txt")); err != nil {
		t.Fatal(err)
	}
	action(t, p, "create-branch", Action{Branch: "feature/local"})
	action(t, p, "switch", Action{Branch: "main"})
	write(t, p, "file.txt", "dirty\n")
	s := snapshot(t, p)
	for _, a := range []Action{{Action: "switch", Branch: "feature/local"}, {Action: "pull", Remote: "origin"}} {
		a.Path = p
		a.Revision = s.Revision
		if Run(context.Background(), a) == nil {
			t.Fatal("accepted dirty operation")
		}
	}
	git(t, p, "checkout", "--", "file.txt")
	write(t, p, "local.txt", "local\n")
	action(t, p, "stage", Action{File: "local.txt"})
	action(t, p, "commit", Action{Message: "Diverge locally"})
	write(t, other, "remote.txt", "remote\n")
	git(t, other, "add", ".")
	git(t, other, "commit", "-m", "Diverge remotely")
	git(t, other, "push", "origin", "main")
	s = snapshot(t, p)
	remoteHead := git(t, remote, "rev-parse", "refs/heads/main")
	if Run(context.Background(), Action{Path: p, Revision: s.Revision, Action: "push", Remote: "origin"}) == nil {
		t.Fatal("divergent push succeeded")
	}
	if snapshot(t, p).Head != s.Head || git(t, remote, "rev-parse", "refs/heads/main") != remoteHead {
		t.Fatal("rejected push changed local or remote HEAD")
	}
	err := Run(context.Background(), Action{Path: p, Revision: s.Revision, Action: "pull", Remote: "origin"})
	if err == nil {
		t.Fatal("divergent pull merged")
	}
	if snapshot(t, p).Head != s.Head {
		t.Fatal("pull changed local HEAD")
	}
}
func TestRenameBinaryAndDetached(t *testing.T) {
	p := fixture(t)
	write(t, p, "old name", "content\n")
	action(t, p, "stage", Action{File: "old name"})
	action(t, p, "commit", Action{Message: "Initial"})
	git(t, p, "mv", "old name", "new name")
	s := snapshot(t, p)
	if len(s.Files) != 1 || s.Files[0].Original != "old name" || s.Files[0].Path != "new name" {
		t.Fatalf("rename %+v", s.Files)
	}
	action(t, p, "unstage", Action{File: "new name"})
	if _, err := os.Stat(filepath.Join(p, "new name")); err != nil {
		t.Fatal(err)
	}
	write(t, p, "binary", "a\x00b")
	d, err := GetDiff(context.Background(), p, "binary", "", false)
	if err != nil || !strings.Contains(d.Text, "Binary") {
		t.Fatalf("binary %+v %v", d, err)
	}
	git(t, p, "checkout", "--detach")
	if snapshot(t, p).Branch != "" {
		t.Fatal("detached branch wrong")
	}
}
func TestConflictsAndActiveOperations(t *testing.T) {
	p := fixture(t)
	write(t, p, "a", "first\n")
	action(t, p, "stage", Action{File: "a"})
	action(t, p, "commit", Action{Message: "Initial"})
	git(t, p, "switch", "-c", "other")
	write(t, p, "a", "other\n")
	git(t, p, "commit", "-am", "Other")
	git(t, p, "switch", "main")
	write(t, p, "a", "main\n")
	git(t, p, "commit", "-am", "Main")
	_ = exec.Command("git", "-C", p, "merge", "other").Run()
	s := snapshot(t, p)
	if s.Operation != "MERGE_HEAD" || !s.Files[0].Conflict {
		t.Fatalf("conflict %+v", s)
	}
	if Run(context.Background(), Action{Path: p, Revision: s.Revision, Action: "commit", Message: "Wrong"}) == nil {
		t.Fatal("accepted conflict commit")
	}
}

func TestRemoteBranchesDefaultTrackingAndStaleTarget(t *testing.T) {
	p := fixture(t)
	write(t, p, "file.txt", "base\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "Base")
	remote := t.TempDir()
	git(t, remote, "init", "--bare", "-b", "main")
	git(t, p, "remote", "add", "origin", remote)
	git(t, p, "push", "-u", "origin", "main")
	git(t, p, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main")
	git(t, p, "push", "origin", "HEAD:refs/heads/feature/nested")
	action(t, p, "fetch", Action{Remote: "origin"})
	s := snapshot(t, p)
	defaults := 0
	for _, b := range s.BranchDetails {
		if b.Default {
			defaults++
		}
		if strings.HasSuffix(b.Ref, "/HEAD") || b.Date == "" {
			t.Fatalf("invalid branch metadata: %+v", b)
		}
	}
	if defaults != 2 {
		t.Fatalf("default markers: %+v", s.BranchDetails)
	}
	action(t, p, "switch-remote", Action{Branch: "refs/remotes/origin/feature/nested"})
	s = snapshot(t, p)
	if s.Branch != "feature/nested" || s.Upstream != "origin/feature/nested" {
		t.Fatalf("tracking: %+v", s)
	}
	action(t, p, "switch", Action{Branch: "main"})
	if err := Run(context.Background(), Action{Path: p, Revision: snapshot(t, p).Revision, Action: "switch-remote", Branch: "refs/remotes/origin/feature/nested"}); err == nil {
		t.Fatal("overwrote existing local branch")
	}
	old := snapshot(t, p)
	git(t, p, "branch", "other")
	if err := Run(context.Background(), Action{Path: p, Revision: old.Revision, Action: "merge", Branch: "refs/heads/other"}); !errors.Is(err, ErrStale) {
		t.Fatalf("refs were not versioned: %v", err)
	}
}

func TestMergeFastForwardDivergedConflictAndAbort(t *testing.T) {
	p := fixture(t)
	write(t, p, "file.txt", "base\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "Base")
	git(t, p, "switch", "-c", "feature")
	write(t, p, "extra.txt", "feature\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "Feature")
	target := snapshot(t, p).Head
	git(t, p, "switch", "main")
	action(t, p, "merge", Action{Branch: "refs/heads/feature"})
	if snapshot(t, p).Head != target {
		t.Fatal("fast forward failed")
	}
	git(t, p, "switch", "feature")
	write(t, p, "feature.txt", "more\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "More feature")
	git(t, p, "switch", "main")
	write(t, p, "main.txt", "main\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "More main")
	action(t, p, "merge", Action{Branch: "refs/heads/feature"})
	if len(strings.Fields(git(t, p, "rev-list", "--parents", "-n", "1", "HEAD"))) != 3 {
		t.Fatal("no merge commit")
	}
	git(t, p, "switch", "feature")
	write(t, p, "file.txt", "feature conflict\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "Feature edit")
	git(t, p, "switch", "main")
	write(t, p, "file.txt", "main conflict\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "Main edit")
	before := snapshot(t, p)
	err := Run(context.Background(), Action{Path: p, Revision: before.Revision, Action: "merge", Branch: "refs/heads/feature"})
	after := snapshot(t, p)
	if err == nil || after.Operation != "MERGE_HEAD" || !after.Files[0].Conflict {
		t.Fatalf("conflict missing: %v %+v", err, after)
	}
	action(t, p, "abort-merge", Action{})
	after = snapshot(t, p)
	if after.Head != before.Head || after.Operation != "" || len(after.Files) != 0 {
		t.Fatal("abort did not restore clean original state")
	}
	write(t, p, "file.txt", "uncommitted\n")
	for _, branch := range []string{"refs/heads/feature", "--help", "refs/heads/missing"} {
		if err := Run(context.Background(), Action{Path: p, Revision: snapshot(t, p).Revision, Action: "merge", Branch: branch}); err == nil {
			t.Fatalf("accepted dirty merge %q", branch)
		}
	}
}

func TestMergePreservesIgnoredFiles(t *testing.T) {
	p := fixture(t)
	write(t, p, ".gitignore", "local.txt\n")
	git(t, p, "add", ".")
	git(t, p, "commit", "-m", "Ignore local data")
	git(t, p, "switch", "-c", "feature")
	write(t, p, "local.txt", "tracked remote data\n")
	git(t, p, "add", "-f", "local.txt")
	git(t, p, "commit", "-m", "Track file")
	git(t, p, "switch", "main")
	write(t, p, "local.txt", "keep local data\n")
	s := snapshot(t, p)
	if len(s.Files) != 0 {
		t.Fatal("fixture file should be ignored")
	}
	if err := Run(context.Background(), Action{Path: p, Revision: s.Revision, Action: "merge", Branch: "refs/heads/feature"}); err == nil {
		t.Fatal("merge overwrote ignored file")
	}
	data, _ := os.ReadFile(filepath.Join(p, "local.txt"))
	if string(data) != "keep local data\n" || snapshot(t, p).Head != s.Head {
		t.Fatal("ignored file or HEAD changed")
	}
}

func TestCreateCloneAndProtectDestinations(t *testing.T) {
	ctx := context.Background()
	parent := t.TempDir()
	path := filepath.Join(parent, "new project")
	if err := Run(ctx, Action{Action: "init", Path: path}); err != nil {
		t.Fatal(err)
	}
	if s := snapshot(t, path); s.Branch != "main" || s.Head != "" {
		t.Fatalf("new repository: %+v", s)
	}
	write(t, path, "keep.txt", "keep")
	if err := Run(ctx, Action{Action: "init", Path: path}); err == nil {
		t.Fatal("existing destination accepted")
	}
	if data, _ := os.ReadFile(filepath.Join(path, "keep.txt")); string(data) != "keep" {
		t.Fatal("existing file changed")
	}
	source := fixture(t)
	write(t, source, "hello.txt", "hello")
	git(t, source, "add", ".")
	git(t, source, "commit", "-m", "Initial")
	cloned := filepath.Join(parent, "cloned")
	if err := Run(ctx, Action{Action: "clone", Path: cloned, URL: source}); err != nil {
		t.Fatal(err)
	}
	if s := snapshot(t, cloned); s.Upstream != "origin/main" || len(s.History) != 1 {
		t.Fatalf("clone: %+v", s)
	}
	for _, url := range []string{"", "--upload-pack=bad", "missing-repository", "ext::bad"} {
		if err := Run(ctx, Action{Action: "clone", Path: filepath.Join(parent, "failed"), URL: url}); err == nil {
			t.Fatalf("accepted %q", url)
		}
	}
	for _, dest := range []string{"relative", parent + "/../escape", filepath.Join(parent, "missing", "child")} {
		if err := Run(ctx, Action{Action: "init", Path: dest}); err == nil {
			t.Fatalf("accepted %q", dest)
		}
	}
}

func TestSyncUsesDifferentlyNamedTrackingBranch(t *testing.T) {
	upstream := fixture(t)
	write(t, upstream, "hello.txt", "one")
	git(t, upstream, "add", ".")
	git(t, upstream, "commit", "-m", "Initial")
	local := filepath.Join(t.TempDir(), "clone")
	if err := Run(context.Background(), Action{Action: "clone", Path: local, URL: upstream}); err != nil {
		t.Fatal(err)
	}
	git(t, local, "branch", "-m", "work")
	git(t, local, "config", "user.name", "Local test")
	git(t, local, "config", "user.email", "local@example.invalid")
	git(t, local, "config", "commit.gpgsign", "false")
	write(t, upstream, "hello.txt", "two")
	git(t, upstream, "add", ".")
	git(t, upstream, "commit", "-m", "Remote change")
	action(t, local, "pull", Action{Remote: "origin"})
	if snapshot(t, local).Head != snapshot(t, upstream).Head {
		t.Fatal("pull did not use tracking branch")
	}
	git(t, upstream, "switch", "-c", "other")
	write(t, local, "hello.txt", "three")
	git(t, local, "add", ".")
	git(t, local, "commit", "-m", "Local change")
	action(t, local, "push", Action{Remote: "origin"})
	if strings.TrimSpace(git(t, upstream, "rev-parse", "main")) != snapshot(t, local).Head {
		t.Fatal("push did not update tracking branch")
	}
	if snapshot(t, local).Upstream != "origin/main" {
		t.Fatal("push changed tracking branch")
	}
}

func TestBatchStageAndUnstage(t *testing.T) {
	p := fixture(t)
	write(t, p, "first.txt", "one")
	write(t, p, "second.txt", "two")
	action(t, p, "stage", Action{Files: []string{"first.txt", "second.txt"}})
	for _, f := range snapshot(t, p).Files {
		if f.Index != "A" {
			t.Fatalf("not staged: %+v", f)
		}
	}
	action(t, p, "unstage", Action{Files: []string{"first.txt", "second.txt"}})
	for _, f := range snapshot(t, p).Files {
		if f.Index != "?" {
			t.Fatalf("not unstaged: %+v", f)
		}
	}
	s := snapshot(t, p)
	if err := Run(context.Background(), Action{Path: p, Revision: s.Revision, Action: "stage", Files: []string{"first.txt", "missing.txt"}}); !errors.Is(err, ErrStale) {
		t.Fatalf("missing selection: %v", err)
	}
	if snapshot(t, p).Files[0].Index != "?" {
		t.Fatal("part of an invalid selection was staged")
	}
	action(t, p, "stage", Action{File: "first.txt"})
	write(t, p, "first.txt", "changed after staging")
	action(t, p, "stage", Action{Files: []string{"second.txt"}})
	if got := git(t, p, "show", ":first.txt"); got != "one" {
		t.Fatal("partial staging overwritten")
	}
	action(t, p, "commit", Action{Message: "Initial"})
	write(t, p, "second.txt", "new content")
	action(t, p, "stage", Action{Files: []string{"first.txt", "second.txt"}})
	action(t, p, "unstage", Action{Files: []string{"first.txt", "second.txt"}})
	for _, f := range snapshot(t, p).Files {
		if f.Index != " " {
			t.Fatalf("not unstaged after commit: %+v", f)
		}
	}
}

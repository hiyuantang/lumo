// SPDX-License-Identifier: AGPL-3.0-only
package gitrepo

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

type File struct {
	Path     string `json:"path"`
	Original string `json:"original,omitempty"`
	Index    string `json:"index"`
	Worktree string `json:"worktree"`
	Conflict bool   `json:"conflict"`
}
type Commit struct {
	ID      string `json:"id"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	Body    string `json:"body"`
}
type Snapshot struct {
	Path          string   `json:"path"`
	Branch        string   `json:"branch"`
	Head          string   `json:"head"`
	Revision      string   `json:"revision"`
	Upstream      string   `json:"upstream"`
	Ahead         int      `json:"ahead"`
	Behind        int      `json:"behind"`
	Branches      []string `json:"branches"`
	BranchDetails []Branch `json:"branchDetails"`
	Remotes       []string `json:"remotes"`
	Files         []File   `json:"files"`
	History       []Commit `json:"history"`
	Operation     string   `json:"operation"`
}
type Diff struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}
type Action struct {
	Files    []string `json:"files,omitempty"`
	URL      string   `json:"url,omitempty"`
	Path     string   `json:"path"`
	Revision string   `json:"revision"`
	Action   string   `json:"action"`
	File     string   `json:"file,omitempty"`
	Branch   string   `json:"branch,omitempty"`
	Remote   string   `json:"remote,omitempty"`
	Message  string   `json:"message,omitempty"`
}

var ErrStale = errors.New("The repository changed. Refresh and review the changes before trying again.")
var oid = regexp.MustCompile(`^[a-f0-9]{40}([a-f0-9]{24})?$`)

const limit = 4 << 20

type bounded struct {
	bytes.Buffer
	truncated bool
}

func (b *bounded) Write(p []byte) (int, error) {
	n := len(p)
	remaining := limit - b.Len()
	if len(p) > remaining {
		p = p[:remaining]
		b.truncated = true
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}
func command(ctx context.Context, path string, args ...string) (string, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	base := []string{"--no-pager", "--literal-pathspecs", "-c", "color.ui=false", "-c", "core.quotePath=false"}
	if path != "" {
		base = append(base, "-C", path)
	}
	cmd := exec.CommandContext(ctx, "git", append(base, args...)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	for _, entry := range os.Environ() {
		key := strings.SplitN(entry, "=", 2)[0]
		if !strings.HasPrefix(key, "GIT_") && key != "LC_ALL" {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_TERMINAL_PROMPT=0", "GIT_SSH_COMMAND=ssh -oBatchMode=yes -oStrictHostKeyChecking=yes", "GIT_OPTIONAL_LOCKS=0", "LC_ALL=C", "GIT_EDITOR=true", "GIT_SEQUENCE_EDITOR=true")
	var out, stderr bounded
	cmd.Stdout = &out
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() != nil {
		return "", false, errors.New("Git timed out. Refresh to check the repository before retrying.")
	}
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return out.String(), out.truncated, fmt.Errorf("%s", message)
	}
	return out.String(), out.truncated, nil
}
func read(ctx context.Context, path string, args ...string) (string, error) {
	out, truncated, err := command(ctx, path, args...)
	if truncated {
		return "", errors.New("Repository output exceeds the supported size.")
	}
	return out, err
}
func Root(ctx context.Context, path string) (string, error) {
	if !filepath.IsAbs(path) || strings.ContainsAny(path, "\x00\r\n") {
		return "", errors.New("Choose an absolute repository folder.")
	}
	root, err := read(ctx, path, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", errors.New("This folder is not an accessible Git working repository.")
	}
	return strings.TrimSuffix(root, "\n"), nil
}
func statusFiles(raw string) []File {
	result := []File{}
	entries := strings.Split(raw, "\x00")
	for i := 0; i < len(entries); i++ {
		line := entries[i]
		if len(line) < 4 {
			continue
		}
		f := File{Path: line[3:], Index: line[:1], Worktree: line[1:2]}
		f.Conflict = strings.Contains(line[:2], "U") || line[:2] == "AA" || line[:2] == "DD"
		if strings.ContainsAny(line[:2], "RC") && i+1 < len(entries) {
			i++
			f.Original = entries[i]
		}
		result = append(result, f)
	}
	return result
}
func Read(ctx context.Context, path string) (Snapshot, error) {
	root, err := Root(ctx, path)
	if err != nil {
		return Snapshot{}, err
	}
	s := Snapshot{Path: root, Files: []File{}, Branches: []string{}, Remotes: []string{}, History: []Commit{}}
	raw, err := read(ctx, root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return s, err
	}
	s.Files = statusFiles(raw)
	head, headErr := read(ctx, root, "rev-parse", "--verify", "HEAD")
	if headErr == nil {
		s.Head = strings.TrimSpace(head)
	}
	branch, _ := read(ctx, root, "symbolic-ref", "--quiet", "--short", "HEAD")
	s.Branch = strings.TrimSpace(branch)
	branches, err := read(ctx, root, "for-each-ref", "--format=%(refname:short)", "refs/heads/")
	if err != nil {
		return s, err
	}
	s.Branches = lines(branches)
	if s.Branch != "" && !contains(s.Branches, s.Branch) {
		s.Branches = append(s.Branches, s.Branch)
	}
	remotes, err := read(ctx, root, "remote")
	if err != nil {
		return s, err
	}
	s.Remotes = lines(remotes)
	upstream, _ := read(ctx, root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	s.Upstream = strings.TrimSpace(upstream)
	if s.Upstream != "" {
		counts, err := read(ctx, root, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
		if err != nil {
			return s, err
		}
		_, _ = fmt.Sscanf(counts, "%d\t%d", &s.Ahead, &s.Behind)
	}
	var refs string
	s.BranchDetails, refs, err = branchDetails(ctx, s)
	if err != nil {
		return s, err
	}
	if s.Head != "" {
		history, err := read(ctx, root, "log", "-50", "--format=%H%x00%s%x00%an%x00%aI%x00%b%x00", "HEAD", "--")
		if err != nil {
			return s, err
		}
		fields := strings.Split(history, "\x00")
		for i := 0; i+4 < len(fields); i += 5 {
			s.History = append(s.History, Commit{strings.TrimSpace(fields[i]), fields[i+1], fields[i+2], fields[i+3], fields[i+4]})
		}
	}
	for _, marker := range []string{"MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"} {
		location, err := read(ctx, root, "rev-parse", "--git-path", marker)
		if err != nil {
			return s, err
		}
		location = strings.TrimSpace(location)
		if !filepath.IsAbs(location) {
			location = filepath.Join(root, location)
		}
		if _, err := os.Stat(location); err == nil {
			s.Operation = marker
			break
		}
	}
	hash := sha256.New()
	_, _ = io.WriteString(hash, raw+s.Head+s.Branch+s.Operation+refs+strings.Join(s.Remotes, "\x00"))
	index, err := read(ctx, root, "diff", "--cached", "--raw", "--full-index", "--no-abbrev", "--no-ext-diff", "--no-textconv", "--")
	if err != nil {
		return s, err
	}
	_, _ = io.WriteString(hash, index)
	for _, f := range s.Files {
		info, err := os.Lstat(filepath.Join(root, f.Path))
		if err == nil {
			_, _ = fmt.Fprintf(hash, "%s:%d:%d:%v", f.Path, info.Size(), info.ModTime().UnixNano(), info.Mode())
		}
	}
	s.Revision = hex.EncodeToString(hash.Sum(nil))
	return s, nil
}
func lines(s string) []string {
	result := []string{}
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		if line != "" {
			result = append(result, line)
		}
	}
	return result
}
func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
func validFile(path string) bool {
	return path != "" && !filepath.IsAbs(path) && filepath.Clean(path) == path && path != ".." && !strings.HasPrefix(path, "../") && !strings.ContainsRune(path, 0)
}
func GetDiff(ctx context.Context, path, file, commit string, staged bool) (Diff, error) {
	root, err := Root(ctx, path)
	if err != nil {
		return Diff{}, err
	}
	args := []string{"diff", "--no-ext-diff", "--no-textconv", "--no-color"}
	if commit != "" {
		if !oid.MatchString(commit) {
			return Diff{}, errors.New("Choose a commit from history.")
		}
		args = []string{"show", "--format=", "--no-ext-diff", "--no-textconv", "--no-color", commit}
	} else if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--")
	if file != "" {
		if !validFile(file) {
			return Diff{}, errors.New("Choose a repository file.")
		}
		args = append(args, file)
	}
	if commit == "" && !staged && file != "" {
		status, err := read(ctx, root, "status", "--porcelain=v1", "-z", "--", file)
		if err != nil {
			return Diff{}, err
		}
		if strings.HasPrefix(status, "?? ") {
			full := filepath.Join(root, file)
			info, err := os.Lstat(full)
			if err != nil {
				return Diff{}, err
			}
			if !info.Mode().IsRegular() {
				return Diff{Text: "Preview is unavailable for this file type."}, nil
			}
			handle, err := os.Open(full)
			if err != nil {
				return Diff{}, err
			}
			defer handle.Close()
			data, err := io.ReadAll(io.LimitReader(handle, limit+1))
			if err != nil {
				return Diff{}, err
			}
			truncated := len(data) > limit
			if truncated {
				data = data[:limit]
			}
			if bytes.ContainsRune(data, 0) {
				return Diff{Text: "Binary file — preview unavailable."}, nil
			}
			return Diff{Text: "New file: " + file + "\n" + "+" + strings.ReplaceAll(string(data), "\n", "\n+"), Truncated: truncated}, nil
		}
	}
	out, truncated, err := command(ctx, root, args...)
	return Diff{out, truncated}, err
}
func Run(ctx context.Context, req Action) error {
	if req.Action == "clone" || req.Action == "init" {
		return createRepository(ctx, req)
	}
	s, err := Read(ctx, req.Path)
	if err != nil {
		return err
	}
	if req.Revision == "" || req.Revision != s.Revision {
		return ErrStale
	}
	var args []string
	switch req.Action {
	case "stage", "unstage":
		selected := req.Files
		if req.File != "" {
			if len(selected) > 0 {
				return errors.New("Choose files using one selection field.")
			}
			selected = []string{req.File}
		}
		if len(selected) == 0 || len(selected) > 10000 {
			return errors.New("Choose changed repository files.")
		}
		paths := []string{}
		seen := map[string]bool{}
		for _, name := range selected {
			if !validFile(name) {
				return errors.New("Choose changed repository files.")
			}
			var chosen *File
			for _, f := range s.Files {
				if f.Path == name {
					copy := f
					chosen = &copy
					break
				}
			}
			if chosen == nil {
				return ErrStale
			}
			if chosen.Conflict {
				return errors.New("Resolve conflicts in Terminal before staging here.")
			}
			for _, path := range []string{chosen.Path, chosen.Original} {
				if path != "" && !seen[path] {
					paths = append(paths, path)
					seen[path] = true
				}
			}
		}
		if req.Action == "stage" {
			args = append([]string{"add", "--"}, paths...)
		} else if s.Head == "" {
			args = append([]string{"rm", "--cached", "--"}, paths...)
		} else {
			args = append([]string{"reset", "--quiet", "HEAD", "--"}, paths...)
		}
	case "commit":
		if s.Operation != "" {
			return errors.New("Finish the active Git operation in Terminal before committing here.")
		}
		staged := false
		for _, f := range s.Files {
			if f.Conflict {
				return errors.New("Resolve all conflicts before committing.")
			}
			if f.Index != " " && f.Index != "?" {
				staged = true
			}
		}
		if !staged || strings.TrimSpace(req.Message) == "" || len(req.Message) > 16384 || strings.ContainsRune(req.Message, 0) {
			return errors.New("Stage changes and enter a commit summary.")
		}
		args = []string{"commit", "-m", req.Message}
	case "switch", "create-branch":
		if s.Operation != "" || len(s.Files) > 0 {
			return errors.New("Commit or stash your changes in Terminal before switching branches.")
		}
		if req.Branch == "" || strings.HasPrefix(req.Branch, "-") {
			return errors.New("Enter a valid branch name.")
		}
		if _, err := read(ctx, s.Path, "check-ref-format", "refs/heads/"+req.Branch); err != nil {
			return errors.New("Enter a valid branch name.")
		}
		if req.Action == "switch" {
			if !contains(s.Branches, req.Branch) {
				return errors.New("Choose a local branch.")
			}
			args = []string{"switch", "--no-guess", req.Branch}
		} else {
			args = []string{"switch", "-c", req.Branch}
		}
	case "switch-remote", "merge":
		if s.Operation != "" || len(s.Files) > 0 {
			return errors.New("Commit or stash your changes in Terminal before switching or merging branches.")
		}
		var target *Branch
		for _, b := range s.BranchDetails {
			if b.Ref == req.Branch {
				copy := b
				target = &copy
				break
			}
		}
		if target == nil {
			return errors.New("Choose an available branch.")
		}
		if req.Action == "switch-remote" {
			if target.Remote == "" {
				return errors.New("Choose a remote branch.")
			}
			local := strings.TrimPrefix(target.Name, target.Remote+"/")
			if contains(s.Branches, local) {
				return errors.New("A local branch with this name already exists. Select it from Local branches.")
			}
			if local == "" || strings.HasPrefix(local, "-") {
				return errors.New("This remote branch cannot be checked out here.")
			}
			args = []string{"switch", "--track", "-c", local, target.Ref}
		} else {
			if s.Branch == "" || s.Head == "" || target.Ref == "refs/heads/"+s.Branch {
				return errors.New("Choose another branch to merge into the current local branch.")
			}
			args = []string{"-c", "merge.autoStash=false", "merge", "--no-edit", "--no-overwrite-ignore", "--", target.Ref}
		}
	case "abort-merge":
		if s.Operation != "MERGE_HEAD" {
			return errors.New("There is no merge to abort.")
		}
		args = []string{"merge", "--abort"}
	case "fetch", "pull", "push":
		if !contains(s.Remotes, req.Remote) || strings.HasPrefix(req.Remote, "-") {
			return errors.New("Choose a configured remote.")
		}
		if req.Action == "fetch" {
			args = []string{"fetch", "--", req.Remote}
		} else {
			if s.Branch == "" || s.Head == "" || s.Operation != "" {
				return errors.New("Choose a branch and finish active Git operations first.")
			}
			remoteBranch := s.Branch
			trackingRemote := ""
			for _, name := range s.Remotes {
				if strings.HasPrefix(s.Upstream, name+"/") && len(name) > len(trackingRemote) {
					trackingRemote = name
				}
			}
			if trackingRemote == req.Remote {
				remoteBranch = strings.TrimPrefix(s.Upstream, req.Remote+"/")
			}
			if req.Action == "pull" {
				if len(s.Files) > 0 {
					return errors.New("Commit or stash your changes in Terminal before pulling.")
				}
				args = []string{"-c", "rebase.autoStash=false", "-c", "merge.autoStash=false", "pull", "--ff-only", "--no-rebase", "--", req.Remote, remoteBranch}
			} else {
				args = []string{"-c", "remote." + req.Remote + ".mirror=false", "push", "--no-follow-tags", "--recurse-submodules=no", "--set-upstream", "--", req.Remote, "HEAD:refs/heads/" + remoteBranch}
			}
		}
	default:
		return errors.New("Unsupported Git action.")
	}
	_, _, err = command(ctx, s.Path, args...)
	return err
}

// SPDX-License-Identifier: AGPL-3.0-only
package skills

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"unicode/utf8"

	"gopkg.in/yaml.v3"
)

const MaxEntries = 512
const MaxBytes = 256 << 10

type Skill struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Path        string `json:"path"`
	Issue       string `json:"issue,omitempty"`
}

type Catalog struct {
	Path    string  `json:"path"`
	Skills  []Skill `json:"skills"`
	Limited bool    `json:"limited"`
}

type Detail struct {
	Skill
	Body string `json:"body"`
	Raw  string `json:"raw"`
}

func open(home string) (*os.Root, error) {
	root, err := os.OpenRoot(home)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.OpenRoot(".agents/skills")
}

func List(home string) (Catalog, error) {
	result := Catalog{Path: filepath.Join(home, ".agents", "skills"), Skills: []Skill{}}
	root, err := open(home)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return result, err
	}
	defer dir.Close()
	entries, err := dir.ReadDir(MaxEntries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return result, err
	}
	result.Limited = len(entries) > MaxEntries
	if result.Limited {
		entries = entries[:MaxEntries]
	}
	for _, entry := range entries {
		if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			continue
		}
		detail, err := read(root, result.Path, entry.Name())
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			detail.Issue = "Could not read SKILL.md. Check access and keep linked files inside this skills folder."
		}
		result.Skills = append(result.Skills, detail.Skill)
	}
	sort.Slice(result.Skills, func(i, j int) bool { return result.Skills[i].Name < result.Skills[j].Name })
	return result, nil
}

func Read(home, id string) (Detail, error) {
	if id == "" || id == "." || id == ".." || filepath.Base(id) != id || strings.ContainsAny(id, "/\\\x00") {
		return Detail{}, os.ErrInvalid
	}
	root, err := open(home)
	if err != nil {
		return Detail{}, err
	}
	defer root.Close()
	return read(root, filepath.Join(home, ".agents", "skills"), id)
}

func read(root *os.Root, path, id string) (Detail, error) {
	detail := Detail{Skill: Skill{ID: id, Name: id, Path: filepath.Join(path, id, "SKILL.md")}}
	file, err := root.OpenFile(filepath.Join(id, "SKILL.md"), os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return detail, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return detail, err
	}
	if !info.Mode().IsRegular() {
		detail.Issue = "SKILL.md must be a regular text file."
		return detail, nil
	}
	data, err := io.ReadAll(io.LimitReader(file, MaxBytes+1))
	if err != nil {
		return detail, err
	}
	if len(data) > MaxBytes {
		detail.Issue = "SKILL.md exceeds the 256 KB reading limit."
		return detail, nil
	}
	if !utf8.Valid(data) || strings.ContainsRune(string(data), '\x00') {
		detail.Issue = "SKILL.md must use UTF-8 text."
		return detail, nil
	}
	detail.Raw = string(data)
	detail.Body = detail.Raw
	lines := strings.Split(strings.ReplaceAll(strings.TrimPrefix(detail.Raw, "\ufeff"), "\r\n", "\n"), "\n")
	if lines[0] != "---" {
		detail.Issue = "Add a YAML header with a name and description."
		return detail, nil
	}
	end := 1
	for end < len(lines) && lines[end] != "---" {
		end++
	}
	if end == len(lines) {
		detail.Issue = "The YAML header is missing its closing separator."
		return detail, nil
	}
	detail.Body = strings.Join(lines[end+1:], "\n")
	var meta struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
	}
	if err := yaml.Unmarshal([]byte(strings.Join(lines[1:end], "\n")), &meta); err != nil {
		detail.Issue = "The YAML header could not be read."
		return detail, nil
	}
	if strings.TrimSpace(meta.Name) != "" {
		detail.Name = strings.TrimSpace(meta.Name)
	}
	detail.Description = strings.TrimSpace(meta.Description)
	if strings.TrimSpace(meta.Name) == "" || detail.Description == "" {
		detail.Issue = "The YAML header needs a name and description."
	}
	return detail, nil
}

// SPDX-License-Identifier: AGPL-3.0-only
package pihistory

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHistoryBoundedIndexSearchAndEntry(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chat.jsonl")
	var lines []string
	lines = append(lines, `{"type":"session","version":3}`)
	add := func(id, parent, role, text string) {
		data, _ := json.Marshal(map[string]any{"type": "message", "id": id, "parentId": parent, "message": map[string]any{"role": role, "content": []any{map[string]string{"type": "text", "text": text}}}})
		lines = append(lines, string(data))
	}
	add("a", "", "user", "First question")
	add("b", "a", "assistant", strings.Repeat("界", 4500)+"answer")
	add("c", "b", "toolResult", strings.Repeat("x", 3<<20))
	add("d", "a", "user", "Different branch")
	lines = append(lines, `{"type":"compaction","id":"e","parentId":"d","summary":"A short summary"}`, `{"incomplete":`)
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0600); err != nil {
		t.Fatal(err)
	}
	index, err := Read(path, Options{Limit: 2})
	if err != nil || len(index.Entries) != 2 || index.Entries[0].ID != "d" || index.NextBefore != 5 || index.Skipped != 2 {
		t.Fatalf("index: %+v %v", index, err)
	}
	older, err := Read(path, Options{Before: index.NextBefore})
	if err != nil || len(older.Entries) != 1 || older.Entries[0].ID != "a" {
		t.Fatalf("older: %+v %v", older, err)
	}
	found, err := Read(path, Options{Query: "ANSWER"})
	if err != nil || len(found.Entries) != 1 || found.Entries[0].ID != "b" || !strings.Contains(found.Entries[0].Text, "answer") || len([]rune(found.Entries[0].Text)) > 240 {
		t.Fatalf("search: %+v %v", found, err)
	}
	entry, err := Read(path, Options{Entry: "b"})
	if err != nil || len(entry.Entries) != 1 || entry.Entries[0].NextOffset != 4000 || len([]rune(entry.Entries[0].Text)) != 4000 || entry.Entries[0].ParentID != "a" {
		t.Fatalf("entry: %+v %v", entry, err)
	}
	tail, err := Read(path, Options{Entry: "b", Offset: 4000})
	if err != nil || tail.Entries[0].Text != strings.Repeat("界", 500)+"answer" || tail.Entries[0].NextOffset != 0 {
		t.Fatalf("tail: %+v %v", tail, err)
	}
	if _, err := Read(path, Options{Limit: 21}); err == nil {
		t.Fatal("accepted unbounded limit")
	}
	archive := filepath.Join(filepath.Dir(path), ".archive")
	os.Mkdir(archive, 0700)
	os.Rename(path, filepath.Join(archive, filepath.Base(path)))
	if _, err := Read(path, Options{}); err != nil {
		t.Fatal("archived reference:", err)
	}
	os.Symlink(filepath.Join(archive, filepath.Base(path)), path)
	if _, err := Read(path, Options{}); err == nil {
		t.Fatal("followed leaf symlink")
	}
}

func TestHistoryRejectsOtherFiles(t *testing.T) {
	for _, content := range []string{"", `{"type":"message","id":"a"}`, "not JSON"} {
		path := filepath.Join(t.TempDir(), "chat.jsonl")
		os.WriteFile(path, []byte(content), 0600)
		if _, err := Read(path, Options{}); err == nil {
			t.Fatalf("accepted %q", content)
		}
	}
}

func TestHistoryIndexesUserTextWithoutReferenceBoilerplate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chat.jsonl")
	text := "[Lumo conversation references]\n[]\nLookup instructions\n[/Lumo conversation references]\n\nFind my earlier design decision"
	data, _ := json.Marshal(map[string]any{"type": "message", "id": "a", "message": map[string]string{"role": "user", "content": text}})
	os.WriteFile(path, append([]byte("{\"type\":\"session\"}\n"), data...), 0600)
	result, err := Read(path, Options{})
	if err != nil || len(result.Entries) != 1 || result.Entries[0].Text != "Find my earlier design decision" {
		t.Fatalf("index: %+v %v", result, err)
	}
	result, err = Read(path, Options{Entry: "a"})
	if err != nil || result.Entries[0].Text != text {
		t.Fatalf("original: %+v %v", result, err)
	}
}

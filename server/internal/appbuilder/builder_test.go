// SPDX-License-Identifier: AGPL-3.0-only
package appbuilder

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"lumo/server/internal/appplugins"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T, backend, pi bool) (string, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("LUMO_PLUGIN_DIR", t.TempDir())
	t.Setenv("LUMO_PLUGIN_BUNDLED_DIR", t.TempDir())
	project := filepath.Join(t.TempDir(), "notes")
	if _, err := Create(project, "builder-notes", "Builder Notes", backend, pi); err != nil {
		t.Fatal(err)
	}
	return home, project
}
func edit(t *testing.T, project, file, from, to string) {
	t.Helper()
	p := filepath.Join(project, file)
	raw, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), from) {
		t.Fatal("missing text", from)
	}
	if err = os.WriteFile(p, []byte(strings.Replace(string(raw), from, to, 1)), 0600); err != nil {
		t.Fatal(err)
	}
}
func requireOK(t *testing.T, r Report) {
	t.Helper()
	if !r.OK {
		t.Fatalf("validation: %+v", r.Diagnostics)
	}
}
func TestNativeBuilderLifecycleAndSharedBackend(t *testing.T) {
	home, project := fixture(t, true, true)
	ctx := context.Background()
	report := Build(ctx, home, project, true)
	requireOK(t, report)
	if len(appplugins.NamesFor(home)) != 0 {
		t.Fatal("build activated the plugin")
	}
	change := appplugins.Change{Name: "builder-notes", Action: "install", Digest: report.Release.Digest, RequestID: "install-1", Trust: true}
	requireOK(t, Install(ctx, home, change))
	requireOK(t, Install(ctx, home, change))
	app, err := appplugins.LoadFor(home, "builder-notes")
	if err != nil {
		t.Fatal(err)
	}
	invoke := func(op, input string) (string, error) {
		cmd, err := app.Command(ctx, home, op)
		if err != nil {
			return "", err
		}
		cmd.Env = append(os.Environ(), "LUMO_APP_DATA="+appplugins.DataDirectory(home, "builder-notes"))
		cmd.Stdin = strings.NewReader(input)
		raw, err := cmd.Output()
		return string(raw), err
	}
	saved, err := invoke("save", `{"text":"Shared with Pi","revision":"","requestId":"save-1"}`)
	if err != nil {
		t.Fatal(err)
	}
	again, err := invoke("save", `{"text":"Shared with Pi","revision":"","requestId":"save-1"}`)
	if err != nil || again != saved {
		t.Fatal("save replay", again, err)
	}
	if _, err = invoke("save", `{"text":"stale","revision":"","requestId":"save-2"}`); err == nil {
		t.Fatal("stale save accepted")
	}
	response, err := invoke("serve", "GET /api/v1/plugins/builder-notes HTTP/1.1\r\nHost: lumo-plugin\r\n\r\n")
	if err != nil {
		t.Fatal(err)
	}
	var reply struct {
		Status int    `json:"status"`
		Body   []byte `json:"body"`
	}
	if json.Unmarshal([]byte(response), &reply) != nil || reply.Status != 200 || !strings.Contains(string(reply.Body), "Shared with Pi") {
		t.Fatal(response)
	}
	before := appplugins.Catalog(home)[0]
	edit(t, project, "lumo.plugin.json", `"0.1.0"`, `"0.2.0"`)
	updated := Build(ctx, home, project, true)
	requireOK(t, updated)
	change.Digest = updated.Release.Digest
	change.Revision = before.Revision
	change.RequestID = "install-2"
	requireOK(t, Install(ctx, home, change))
	if err = appplugins.Apply(home, appplugins.Change{Name: change.Name, Action: "uninstall", Revision: before.Revision}); err == nil {
		t.Fatal("stale catalog revision accepted")
	}
	current := appplugins.Catalog(home)[0]
	if current.Previous != report.Release.Digest {
		t.Fatal(current)
	}
	restore := appplugins.Change{Name: change.Name, Action: "rollback", Revision: current.Revision, Digest: "", RequestID: "restore-1", Trust: true}
	requireOK(t, Install(ctx, home, restore))
	requireOK(t, Install(ctx, home, restore))
	if text, err := invoke("read", "{}"); err != nil || !strings.Contains(text, "Shared with Pi") {
		t.Fatal(text, err)
	}
	if len(appplugins.Catalog(t.TempDir())) != 0 {
		t.Fatal("plugin leaked to another account")
	}
}
func TestNativeBuilderRejectsThenRepairs(t *testing.T) {
	home, project := fixture(t, true, true)
	ctx := context.Background()
	if err := os.WriteFile(filepath.Join(project, "validate.mjs"), []byte("process.exit(0)"), 0600); err != nil {
		t.Fatal(err)
	}
	edit(t, project, "pi/extension.mjs", "lumo_builder_notes_read", "lumo_builder_notes_missing")
	failed := Build(ctx, home, project, true)
	if failed.OK || len(failed.Diagnostics) == 0 || failed.Diagnostics[0].Fix == "" || len(appplugins.Catalog(home)) != 0 {
		t.Fatal("bad extension staged", failed)
	}
	edit(t, project, "pi/extension.mjs", "lumo_builder_notes_missing", "lumo_builder_notes_read")
	edit(t, project, "src/main.tsx", "from 'react'", "from 'unavailable-package'")
	failed = Build(ctx, home, project, true)
	if failed.OK || failed.Diagnostics[0].Code != "dependency" || failed.Diagnostics[0].Line == 0 {
		t.Fatal(failed)
	}
	edit(t, project, "src/main.tsx", "from 'unavailable-package'", "from 'react'")
	requireOK(t, Build(ctx, home, project, false))
	if len(appplugins.Catalog(home)) != 0 {
		t.Fatal("validation staged files")
	}
	report := Build(ctx, home, project, true)
	requireOK(t, report)
	app, err := appplugins.Staged(home, "builder-notes", report.Release.Digest)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(app.Directory, app.Manifest.Entry), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	failed = Install(ctx, home, appplugins.Change{Name: "builder-notes", Action: "install", Digest: report.Release.Digest, Trust: true, RequestID: "damaged"})
	if failed.OK || len(appplugins.NamesFor(home)) != 0 {
		t.Fatal("damaged app installed", failed)
	}
}
func TestNativeBuilderOptionalPartsAndLocalModules(t *testing.T) {
	for _, parts := range [][2]bool{{false, false}, {true, false}} {
		t.Run("parts", func(t *testing.T) {
			home, project := fixture(t, parts[0], parts[1])
			if err := os.WriteFile(filepath.Join(project, "src/title.ts"), []byte("export const title: string = 'Module title';"), 0600); err != nil {
				t.Fatal(err)
			}
			edit(t, project, "src/main.tsx", "export default function App()", "import { title } from './title';\nexport default function App()")
			edit(t, project, "src/main.tsx", `{"Builder Notes"}`, `{title}`)
			requireOK(t, Build(context.Background(), home, project, true))
		})
	}
}
func TestNativeBuilderRejectsSymlinksAndNamespaces(t *testing.T) {
	home, project := fixture(t, true, true)
	edit(t, project, "lumo.plugin.json", "GET /api/v1/plugins/builder-notes", "GET /api/v1/pi")
	if Build(context.Background(), home, project, true).OK {
		t.Fatal("route escaped namespace")
	}
	edit(t, project, "lumo.plugin.json", "GET /api/v1/pi", "GET /api/v1/plugins/builder-notes")
	outside := filepath.Join(t.TempDir(), "external.ts")
	os.WriteFile(outside, []byte("export default 1"), 0600)
	if err := os.Symlink(outside, filepath.Join(project, "src/outside.ts")); err != nil {
		t.Fatal(err)
	}
	if Build(context.Background(), home, project, true).OK {
		t.Fatal("symlink source accepted")
	}
}

func TestNativeValidationDoesNotExecuteAppCode(t *testing.T) {
	home, project := fixture(t, true, true)
	marker := filepath.Join(t.TempDir(), "executed")
	encoded, _ := json.Marshal(marker)
	edit(t, project, "backend/main.mjs", "const directory =", "fs.writeFileSync("+string(encoded)+", 'unexpected');\nconst directory =")
	requireOK(t, Build(context.Background(), home, project, false))
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("validation executed app code", err)
	}
}

func TestBuilderBundlesAndRejectsIcon(t *testing.T) {
	home, project := fixture(t, false, false)
	raw, err := os.ReadFile(filepath.Join(project, "lumo.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m appplugins.Manifest
	json.Unmarshal(raw, &m)
	m.IconImage = "assets/icon.png"
	m.Permissions = append(m.Permissions, "notifications.send")
	raw, _ = json.Marshal(m)
	os.WriteFile(filepath.Join(project, "lumo.plugin.json"), raw, 0600)
	os.MkdirAll(filepath.Join(project, "assets"), 0700)
	data, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKIRjWg0gxg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAcejZH8iJt+oVIAAAAASUVORK5CYII=")
	os.WriteFile(filepath.Join(project, "assets/icon.png"), data, 0600)
	report := Build(context.Background(), home, project, true)
	requireOK(t, report)
	if report.Release.Manifest.IconImage != "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDMKIRjWg0gxg3E/Ornr2kEhAQEBAQEBAQEBAQEBAQSAcejZH8iJt+oVIAAAAASUVORK5CYII=" {
		t.Fatal("icon not embedded")
	}
	os.WriteFile(filepath.Join(project, "assets/icon.png"), []byte("not an image"), 0600)
	if Build(context.Background(), home, project, true).OK {
		t.Fatal("invalid icon passed validation")
	}
}

func TestBuilderDesktopConnectionsAndBackground(t *testing.T) {
	home, project := fixture(t, false, false)
	raw, err := os.ReadFile(filepath.Join(project, "lumo.plugin.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m appplugins.Manifest
	if err = json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	m.Background = "src/background.tsx"
	m.Window.Multiple = true
	raw, _ = json.Marshal(m)
	if err = os.WriteFile(filepath.Join(project, "lumo.plugin.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	frontend := `import {useAppMenus,useAppWindow,useAppState,FilePicker,AppModal} from '@lumo/sdk/app'; export default function App(){useAppWindow({title:'Draft',badge:'2'});useAppMenus({tools:[{id:'export',label:'Export',run(){}}]});return null;}`
	if err = os.WriteFile(filepath.Join(project, "src/main.tsx"), []byte(frontend), 0600); err != nil {
		t.Fatal(err)
	}
	background := `import {useEffect} from 'react'; export default function Background(){useEffect(()=>()=>{},[]);return null;}`
	if err = os.WriteFile(filepath.Join(project, m.Background), []byte(background), 0600); err != nil {
		t.Fatal(err)
	}
	result := Build(context.Background(), home, project, true)
	requireOK(t, result)
	if result.Release.Manifest.Background == "" || !result.Release.Manifest.Window.Multiple {
		t.Fatal("missing desktop declarations")
	}
	requireOK(t, Install(context.Background(), home, appplugins.Change{Name: "builder-notes", Action: "install", Digest: result.Release.Digest, RequestID: "connections-install", Trust: true}))
	edit(t, project, m.Background, "export default function", "export function")
	failed := Build(context.Background(), home, project, false)
	if failed.OK || failed.Diagnostics[0].Code != "entry" || failed.Diagnostics[0].File != m.Background {
		t.Fatal(failed)
	}
	edit(t, project, m.Background, "export function", "export default function")
	edit(t, project, m.Background, "from 'react'", "from 'unsupported'")
	failed = Build(context.Background(), home, project, false)
	if failed.OK || failed.Diagnostics[0].Code != "dependency" {
		t.Fatal(failed)
	}
}

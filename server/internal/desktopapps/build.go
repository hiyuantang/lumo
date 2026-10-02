// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const TemplateJS = `// SPDX-License-Identifier: AGPL-3.0-only
const root = document.getElementById('app');
root.innerHTML = '<header><h1>Server Pulse</h1><p>CPU and memory usage</p></header><section class="cards"><article><span>CPU</span><strong id="cpu">—</strong></article><article><span>Memory</span><strong id="memory">—</strong></article></section><p id="status" role="status">Connecting</p><button id="refresh">Refresh</button>';
async function refresh() {
  try {
    const sample = await lumo.call('system.metrics.read');
    document.getElementById('cpu').textContent = sample.cpuPercent.toFixed(1) + '%';
    document.getElementById('memory').textContent = (sample.memoryUsedBytes / 1073741824).toFixed(1) + ' / ' + (sample.memoryTotalBytes / 1073741824).toFixed(1) + ' GB';
    document.getElementById('status').textContent = 'Updated ' + new Date(sample.at).toLocaleTimeString();
    lumo.ready();
  } catch (error) { document.getElementById('status').textContent = error.message; }
}
document.getElementById('refresh').addEventListener('click', refresh);
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
`
const TemplateCSS = `/* SPDX-License-Identifier: AGPL-3.0-only */
:root{font:14px/1.5 system-ui,sans-serif;color:#242424;background:#fff;color-scheme:light} :root[data-theme=dark]{color:#eee;background:#202020;color-scheme:dark}body{margin:0;padding:24px}h1{font-size:24px;margin:0}p{opacity:.7}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin:24px 0}article{padding:20px;border:1px solid #8885;border-radius:12px}strong{display:block;font-size:26px;margin-top:8px}button{font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px;padding:6px 12px;cursor:pointer}button:focus-visible{outline:2px solid #638dc8;outline-offset:2px}
`
const SDKTypes = `// SPDX-License-Identifier: AGPL-3.0-only
interface LumoMetrics { cpuPercent: number; memoryUsedBytes: number; memoryTotalBytes: number; at: number }
type LumoJSON = null | boolean | number | string | LumoJSON[] | { [key: string]: LumoJSON };
interface LumoData { revision: string; value: LumoJSON }
declare const lumo: { call(method: 'system.metrics.read'): Promise<LumoMetrics>; call(method: 'app.storage.get'): Promise<LumoData>; call(method: 'app.storage.set', params: LumoData): Promise<LumoData>; ready(): void };
`

func Create(project, id, name string, template ...string) (any, error) {
	kind := "pulse"
	if len(template) > 0 && template[0] != "" {
		kind = template[0]
	}
	if kind != "pulse" && kind != "counter" {
		return nil, ErrInvalid
	}
	if !filepath.IsAbs(project) || !idPattern.MatchString(id) || len(name) < 1 || len(name) > 80 {
		return nil, ErrInvalid
	}
	m := Manifest{SchemaVersion: 1, ID: id, Name: name, Version: "0.1.0", Description: "CPU and memory usage for this server.", License: "AGPL-3.0-only", APIVersion: 1, Entry: "src/main.js", Styles: "src/style.css", Window: Window{720, 480, 390, 320}, Capabilities: []Capability{{"system.metrics.read"}}}
	if kind == "counter" {
		m.Description = "A counter saved across windows and server restarts."
		m.Capabilities = []Capability{{"app.storage"}}
	}
	if validate(m) != nil {
		return nil, ErrInvalid
	}
	if _, e := os.Lstat(project); !os.IsNotExist(e) {
		return nil, errors.New("Choose a new project directory. Existing files are never overwritten.")
	}
	if e := os.Mkdir(project, 0700); e != nil {
		return nil, e
	}
	data, _ := json.MarshalIndent(m, "", "  ")
	if e := os.Mkdir(filepath.Join(project, "src"), 0700); e != nil {
		return nil, e
	}
	nameJSON, _ := json.Marshal(name)
	js := strings.Replace(TemplateJS, "async function refresh() {", "root.querySelector('h1').textContent = "+string(nameJSON)+";\nasync function refresh() {", 1)
	if kind == "counter" {
		js = strings.Replace(CounterJS, "TITLE", string(nameJSON), 1)
	}
	for file, content := range map[string]string{"lumo.app.json": string(data) + "\n", "src/main.js": js, "src/style.css": TemplateCSS, "lumo.d.ts": SDKTypes, "README.md": "# " + name + "\n\nEdit src/main.js and src/style.css. Increase lumo.app.json version before rebuilding changed source. Use Pi's lumo_app_build, lumo_app_preview and lumo_app_install tools. The runtime exposes lumo.call and lumo.ready; see lumo.d.ts. Storage values must stay backward compatible across app versions. Preview data is temporary and separate from installed data. No external imports or package scripts are supported.\n"} {
		if e := os.WriteFile(filepath.Join(project, file), []byte(content), 0600); e != nil {
			return nil, e
		}
	}
	return map[string]string{"project": project, "id": id}, nil
}
func (s *Store) Build(ctx context.Context, project string) (Bundle, error) {
	if !filepath.IsAbs(project) {
		return Bundle{}, ErrInvalid
	}
	info, e := os.Lstat(project)
	if e != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Bundle{}, ErrInvalid
	}
	root, e := os.OpenRoot(project)
	if e != nil {
		return Bundle{}, e
	}
	defer root.Close()
	read := func(name string, limit int64) ([]byte, error) {
		for part := name; part != "."; part = filepath.Dir(part) {
			info, e := root.Lstat(part)
			if e != nil || info.Mode()&os.ModeSymlink != 0 {
				return nil, ErrInvalid
			}
		}
		f, e := root.Open(name)
		if e != nil {
			return nil, e
		}
		defer f.Close()
		info, e := f.Stat()
		if e != nil || !info.Mode().IsRegular() {
			return nil, ErrInvalid
		}
		b, e := io.ReadAll(io.LimitReader(f, limit+1))
		if int64(len(b)) > limit {
			return nil, ErrInvalid
		}
		return b, e
	}
	raw, e := read("lumo.app.json", 16384)
	if e != nil {
		return Bundle{}, e
	}
	var m Manifest
	if strict(raw, &m) != nil || validate(m) != nil {
		return Bundle{}, ErrInvalid
	}
	js, e := read(m.Entry, 1<<20)
	if e != nil {
		return Bundle{}, e
	}
	css, e := read(m.Styles, 128<<10)
	if e != nil {
		return Bundle{}, e
	}
	node, e := exec.LookPath("node")
	if e != nil {
		return Bundle{}, errors.New("Node.js is required to check app source. Install it explicitly before building.")
	}
	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(checkCtx, node, "--input-type=module", "--check")
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + s.Home}
	cmd.Stdin = strings.NewReader(string(js))
	if output, e := cmd.CombinedOutput(); e != nil {
		if len(output) > 4000 {
			output = output[:4000]
		}
		return Bundle{}, errors.New("JavaScript check failed: " + string(output))
	}
	return s.Stage(Bundle{Manifest: m, JS: string(js), CSS: string(css)})
}

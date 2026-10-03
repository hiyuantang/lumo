// SPDX-License-Identifier: AGPL-3.0-only
package desktopapps

import (
	"bytes"
	"context"
	"embed"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

//go:embed toolchain/*
var appToolchain embed.FS

func compileTSX(ctx context.Context, node, home string, source []byte) ([]byte, error) {
	compiler, e := appToolchain.ReadFile("toolchain/compiler.cjs")
	if e != nil {
		return nil, errors.New("The React app compiler is missing. Build lumod with npm run build:app-sdk first.")
	}
	runtime, e := appToolchain.ReadFile("toolchain/runtime.js")
	if e != nil {
		return nil, errors.New("The React app runtime is missing. Build lumod with npm run build:app-sdk first.")
	}
	dir, e := os.MkdirTemp("", "lumo-app-compiler-")
	if e != nil {
		return nil, e
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "compiler.cjs")
	if e = os.WriteFile(file, compiler, 0600); e != nil {
		return nil, e
	}
	cmd := exec.CommandContext(ctx, node, "--max-old-space-size=256", file)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + home}
	cmd.Stdin = bytes.NewReader(source)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, e := cmd.Output()
	if e != nil {
		return nil, errors.New("TypeScript syntax check failed: " + string(stderr.Bytes()[:min(stderr.Len(), 4000)]))
	}
	if len(output) > 1<<20 {
		return nil, ErrInvalid
	}
	wrapper := string(runtime) + "\n(function(require,exports){\n" + string(output) + "\n})(name=>{switch(name){case 'react':return LumoReactV1.react;case 'react-dom/client':return LumoReactV1.client;case 'react/jsx-runtime':return LumoReactV1.jsx;case '@lumo/ui':return LumoReactV1.ui;default:throw new Error('Unsupported SDK import.');}},{});"
	return []byte(wrapper), nil
}

func CompilePlugin(ctx context.Context, node, home string, input []byte) ([]byte, error) {
	compiler, err := appToolchain.ReadFile("toolchain/native.cjs")
	if err != nil {
		return nil, errors.New("Native app validator is missing; rebuild Lumo with npm run build:app-sdk")
	}
	dir, err := os.MkdirTemp("", "lumo-plugin-compiler-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	file := filepath.Join(dir, "native.cjs")
	if err = os.WriteFile(file, compiler, 0600); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, node, "--max-old-space-size=256", file)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + home}
	cmd.Stdin = bytes.NewReader(input)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		return nil, errors.New("Native validator failed: " + string(stderr.Bytes()[:min(stderr.Len(), 4000)]))
	}
	return output, nil
}

#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO="$ROOT/.tools/go/bin/go"
export GOMODCACHE="$ROOT/.tools/gomodcache"
export GOCACHE="$ROOT/.tools/gocache"
export GOPATH="$ROOT/.tools/gopath"

cd "$ROOT"
npm run build
npm run build:packages

rm -rf server/internal/static/dist
cp -R dist server/internal/static/dist

mkdir -p server/bin
(cd server && "$GO" build -tags webdist -o bin/lumod ./cmd/lumod)

mkdir -p server/bin/plugins
cp -R .tools/plugin-packages/. server/bin/plugins/
echo "built server/bin/lumod and server/bin/plugins"

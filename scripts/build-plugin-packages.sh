#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GOMODCACHE="$ROOT/.tools/gomodcache" GOCACHE="$ROOT/.tools/gocache" GOPATH="$ROOT/.tools/gopath"
export GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local
cd "$ROOT/server"
"$ROOT/.tools/go/bin/go" run ./cmd/package-plugins "$@"

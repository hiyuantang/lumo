#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
export GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GOMODCACHE="$ROOT/.tools/gomodcache"
export GOCACHE="$ROOT/.tools/gocache"
export GOPATH="$ROOT/.tools/gopath"

cd "$ROOT/server"
"$ROOT/.tools/go/bin/go" test ./...
cd "$ROOT"
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v

node --test tests/pi-questions.test.mjs tests/pi-model-images.test.mjs tests/lumo-use.test.mjs

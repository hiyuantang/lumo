#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "Preparing test dependencies. This explicit setup command uses the network."
docker build --target build-deps -t lumo-test-build:deps -f "$ROOT/docker/Dockerfile.test-deps" "$ROOT"
docker build --target runtime-deps -t lumo-test-runtime:deps -f "$ROOT/docker/Dockerfile.test-deps" "$ROOT"

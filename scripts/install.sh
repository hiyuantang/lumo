#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
[[ "$(uname -s)" == Linux && "$EUID" == 0 ]] || { echo 'Run this installer with sudo on Ubuntu.' >&2; exit 1; }
if ! command -v python3 >/dev/null; then
  apt-get update
  apt-get install -y python3
fi
exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install.py" "$@"

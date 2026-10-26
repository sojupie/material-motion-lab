#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d .local/opencv/usr/lib64 ]; then
  export LD_LIBRARY_PATH="$PWD/.local/opencv/usr/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
exec ./bin/ui-motion "$@"

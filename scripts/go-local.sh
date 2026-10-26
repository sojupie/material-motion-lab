#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Use system OpenCV when available. The optional local SDK is only for this host.
if pkg-config --exists opencv4; then
  exec go "$@"
fi
sdk="$PWD/.local/opencv/usr"
if [ ! -f "$sdk/include/opencv4/opencv2/core.hpp" ]; then
  echo 'Install OpenCV 4.13 development files, or set up .local/opencv first.' >&2
  exit 1
fi
export CGO_CPPFLAGS="-I$sdk/include/opencv4 ${CGO_CPPFLAGS:-}"
export CGO_LDFLAGS="-L$sdk/lib64 -Wl,-rpath,$sdk/lib64 -lopencv_core -lopencv_imgproc -lopencv_imgcodecs ${CGO_LDFLAGS:-}"
export LD_LIBRARY_PATH="$sdk/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec go "$1" -tags customenv,gocv_specific_modules "${@:2}"

#!/usr/bin/env bash
# Installs build dependencies and packages Lemon IRC as a single Linux AppImage in dist/
set -euo pipefail
cd "$(dirname "$0")"
. ./tools/node.sh
echo "Installing build dependencies..."
npm ci --no-audit --no-fund
echo "Packaging the Electron app..."
npm run dist:linux
echo
echo "Done. Output is in $(pwd)/dist"

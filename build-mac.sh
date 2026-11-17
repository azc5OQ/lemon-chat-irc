#!/usr/bin/env bash
# Installs build dependencies and packages Lemon IRC as macOS disk images for Intel and Apple silicon in dist/
# Run this on a Mac. The app is not code-signed, so Gatekeeper asks for confirmation on first launch.
set -euo pipefail
cd "$(dirname "$0")"
if [ "$(uname -s)" != "Darwin" ]; then
    echo "macOS packages must be built on a Mac." >&2
    exit 1
fi
. ./tools/node.sh
echo "Installing build dependencies..."
npm ci --no-audit --no-fund
echo "Packaging the Electron app..."
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
echo
echo "Done. Output is in $(pwd)/dist"

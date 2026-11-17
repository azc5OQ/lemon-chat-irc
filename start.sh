#!/bin/sh
set -eu
cd "$(dirname "$0")"
. ./tools/node.sh
node tools/stop-bridge.cjs
node build.cjs
exec node bridge/server.cjs --open

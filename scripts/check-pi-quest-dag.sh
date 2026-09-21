#!/bin/sh
# Strict DAG gate wrapper.
set -e
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
exec deno run --allow-read "$SCRIPT_DIR/check-pi-quest-dag.ts" "$@"

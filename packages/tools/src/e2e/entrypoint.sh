#!/usr/bin/env bash
# Thin shim — all orchestration lives in cron.ts (env validation, chain
# selection, balance check, stress invocation, Slack formatting/post, exit-code
# suppression). Keep this script free of manipulation logic.
set -euo pipefail

SDK_DIR="${SDK_DIR:-/app/nexus-sdk}"
cd "$SDK_DIR"
exec packages/tools/node_modules/.bin/tsx packages/tools/src/e2e/cron.ts

#!/bin/bash

# V2 Statekeeper Integration Test Runner
#
# Usage: ./test/integration/run-v2-test.sh
#
# Prerequisites:
# - Local services running (statekeeper on 9080)
# - pnpm installed

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=========================================="
echo "V2 Statekeeper Integration Tests"
echo "=========================================="
echo ""

# Check if statekeeper is running
echo "Checking statekeeper health..."
if curl -s http://localhost:9080/health > /dev/null 2>&1; then
    echo "✓ Statekeeper is running on port 9080"
else
    echo "✗ Statekeeper is not running on port 9080"
    echo ""
    echo "Please start the statekeeper first:"
    echo "  cd /path/to/statekeeper && cargo run"
    exit 1
fi

echo ""
echo "Running integration tests..."
echo ""

cd "$PROJECT_ROOT"
pnpm tsx test/integration/v2-statekeeper.test.ts

echo ""
echo "Done!"

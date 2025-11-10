#!/bin/bash

# Create a local installable tarball for @avail-project/nexus-core without publishing.
# This script builds packages, rewrites workspace deps for packaging, packs to dist-tarballs/, and restores files.
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
DEST_DIR="$ROOT_DIR/dist-tarballs"

cd "$ROOT_DIR"

# Pre-flight
if [[ ! -f package.json ]] || [[ ! -d packages ]]; then
  err "Run from repo root"
  exit 1
fi

mkdir -p "$DEST_DIR"

info "Cleaning and building packages..."
pnpm run clean
pnpm -F @nexus/commons build
pnpm -F @avail-project/nexus-core build

# Pack core (already named @avail-project/nexus-core; remove workspace-only deps)
info "Packing core as @avail-project/nexus-core (local tarball)..."
pushd packages/core >/dev/null
cp package.json package.json.backup

# Remove @nexus/commons (bundled into dist)
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.dependencies){delete p.dependencies['@nexus/commons'];}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

CORE_TARBALL=$(npm pack --pack-destination "$DEST_DIR" --silent)
mv package.json.backup package.json
popd >/dev/null

info "Created core tarball: $DEST_DIR/$CORE_TARBALL (name: @avail-project/nexus-core)"

info "Done. Tarballs are in $DEST_DIR"
echo ""
echo "Install in a project with:"
echo "  pnpm add $DEST_DIR/$CORE_TARBALL"
echo "or"
echo "  npm i $DEST_DIR/$CORE_TARBALL"



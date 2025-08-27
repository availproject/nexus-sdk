#!/bin/bash

# Create local installable tarballs for @nexus/core and @nexus/widgets without publishing.
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
pnpm -F @nexus/core build
pnpm -F @nexus/widgets build

# Pack core (keep @nexus/core name; remove workspace-only deps)
info "Packing core as @avail-project/nexus (local tarball)..."
pushd packages/core >/dev/null
cp package.json package.json.backup

# Remove @nexus/commons (bundled into dist) and rename to published name
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.name='@avail-project/nexus';if(p.dependencies){delete p.dependencies['@nexus/commons'];}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

CORE_TARBALL=$(npm pack --pack-destination "$DEST_DIR" --silent)
mv package.json.backup package.json
popd >/dev/null

info "Created core tarball: $DEST_DIR/$CORE_TARBALL (name: @avail-project/nexus)"

# Pack widgets (keep @nexus/widgets name; remove workspace-only deps; pin @nexus/core to current version)
info "Packing widgets as @avail-project/nexus-widgets (local tarball)..."
pushd packages/widgets >/dev/null
cp package.json package.json.backup

CORE_VERSION=$(node -p "require('../core/package.json').version")
export CORE_VERSION

node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.name='@avail-project/nexus-widgets';p.dependencies=p.dependencies||{};if(p.dependencies['@nexus/commons']){delete p.dependencies['@nexus/commons'];}if(p.dependencies['@nexus/core']){delete p.dependencies['@nexus/core'];p.dependencies['@avail-project/nexus']=process.env.CORE_VERSION;}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

WIDGETS_TARBALL=$(npm pack --pack-destination "$DEST_DIR" --silent)
mv package.json.backup package.json
popd >/dev/null

info "Created widgets tarball: $DEST_DIR/$WIDGETS_TARBALL (name: @avail-project/nexus-widgets)"

info "Done. Tarballs are in $DEST_DIR"
echo ""
echo "Install in a project with:"
echo "  pnpm add $DEST_DIR/$CORE_TARBALL $DEST_DIR/$WIDGETS_TARBALL"
echo "or"
echo "  npm i $DEST_DIR/$CORE_TARBALL $DEST_DIR/$WIDGETS_TARBALL"



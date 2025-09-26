#!/bin/bash

# Nexus Core SDK Release Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}[CORE RELEASE]${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

# Check if we're in the root directory
if [[ ! -f "package.json" ]] || [[ ! -d "packages/core" ]]; then
    print_error "Please run this script from the monorepo root directory"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    print_error "There are uncommitted changes. Please commit or stash them first."
    exit 1
fi

# Get the release type from command line argument
RELEASE_TYPE=${1:-"dev"}
VERSION_TYPE=${2:-"patch"}
PRERELEASE_ID=${3:-"dev"}

if [[ "$RELEASE_TYPE" != "dev" && "$RELEASE_TYPE" != "prod" ]]; then
    print_error "Invalid release type. Use 'dev' or 'prod'"
    echo "Usage: $0 [dev|prod] [patch|minor|major] [prerelease-id]"
    echo "Examples:"
    echo "  $0 dev patch alpha    # Creates 1.0.1-alpha.0"
    echo "  $0 dev minor beta     # Creates 1.1.0-beta.0"
    echo "  $0 dev patch          # Creates 1.0.1-dev.0 (default)"
    exit 1
fi

if [[ "$VERSION_TYPE" != "patch" && "$VERSION_TYPE" != "minor" && "$VERSION_TYPE" != "major" ]]; then
    print_error "Invalid version type. Use 'patch', 'minor', or 'major'"
    echo "Usage: $0 [dev|prod] [patch|minor|major] [prerelease-id]"
    exit 1
fi

print_header "Starting @avail-project/nexus-core $RELEASE_TYPE release ($VERSION_TYPE)..."

# Run type checking
print_status "Running type check..."
pnpm run typecheck

# Clean previous builds
print_status "Cleaning previous builds..."
pnpm run clean

# Build commons (dependency)
print_status "Building commons package..."
pnpm run build:commons

# Build core package
print_status "Building @avail-project/nexus-core package..."
pnpm run build:core

if [[ "$RELEASE_TYPE" == "prod" ]]; then
    print_header "Creating production release..."

    # Ensure we're on main branch for production releases
    CURRENT_BRANCH=$(git branch --show-current)
    if [[ "$CURRENT_BRANCH" != "main" ]]; then
        print_warning "Not on main branch. Current branch: $CURRENT_BRANCH"
        read -p "Do you want to continue with production release from this branch? (y/N): " confirm
        if [[ $confirm != [yY] ]]; then
            print_error "Aborting production release. Switch to main branch first."
            exit 1
        fi
    fi

    # Version bump
    print_status "Bumping version ($VERSION_TYPE)..."
    cd packages/core
    npm version $VERSION_TYPE --no-git-tag-version
    CORE_VERSION=$(node -p "require('./package.json').version")
    cd ../..

    # Update root package.json version to match
    npm version $CORE_VERSION --no-git-tag-version --allow-same-version

    # Commit version changes
    git add packages/core/package.json package.json
    git commit -m "chore(core): release v$CORE_VERSION"

    # Create tag (only if it doesn't exist)
    if git tag --list | grep -q "^core-v$CORE_VERSION$"; then
        print_warning "Tag core-v$CORE_VERSION already exists, skipping tag creation"
    else
        git tag "core-v$CORE_VERSION"
    fi

    # Temporarily rename package for publishing
    print_status "Preparing package for publishing as @avail-project/nexus-core..."
    cd packages/core

    # Backup original package.json
    cp package.json package.json.backup

    # Update package name for publishing
    sed -i.tmp 's/"name": "@nexus\/core"/"name": "@avail-project\/nexus-core"/' package.json
    rm package.json.tmp 2>/dev/null || true

    # Remove workspace-only dependencies that should be bundled (e.g., @nexus/commons)
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.dependencies&&p.dependencies['@nexus/commons']){delete p.dependencies['@nexus/commons'];}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

    # Bundle internal commons into dist (imports already aliased by Rollup)
    print_status "Bundling internal @nexus/commons into dist..."
    mkdir -p dist/commons
    cp -R ../commons/dist/* dist/commons/

    # Publish to npm
    print_status "Publishing @avail-project/nexus-core@$CORE_VERSION to npm..."
    npm publish --access public

    # Restore original package.json
    mv package.json.backup package.json
    cd ../..

    # Push changes and tags
    print_status "Pushing changes to git..."
    git push origin $CURRENT_BRANCH
    git push origin "core-v$CORE_VERSION"

    print_header "✅ Production release completed!"
    print_status "🚀 @avail-project/nexus-core@$CORE_VERSION published successfully!"
    print_status "📦 Install with: npm install @avail-project/nexus-core"

else
    print_header "Creating development release..."

    # Fetch latest version from npm to avoid conflicts
    print_status "Fetching latest version from npm..."
    LATEST_NPM_VERSION=$(npm view @avail-project/nexus-core version 2>/dev/null || echo "0.0.0")
    # Try to get latest version for the specific prerelease tag, fall back to latest stable
    LATEST_PRERELEASE_VERSION=$(npm view @avail-project/nexus-core@$PRERELEASE_ID version 2>/dev/null || echo "$LATEST_NPM_VERSION")

    print_status "Latest npm version: $LATEST_NPM_VERSION"
    print_status "Latest $PRERELEASE_ID version: $LATEST_PRERELEASE_VERSION"

    # Version bump (let npm manage prerelease numbers based on latest)
    print_status "Bumping $PRERELEASE_ID version (pre$VERSION_TYPE with preid=$PRERELEASE_ID)..."
    cd packages/core

    # Set current version to latest prerelease version to ensure proper increment
    npm version "$LATEST_PRERELEASE_VERSION" --no-git-tag-version --allow-same-version
    npm version pre$VERSION_TYPE --preid=$PRERELEASE_ID --no-git-tag-version

    PRERELEASE_VERSION=$(node -p "require('./package.json').version")
    export PRERELEASE_VERSION
    cd ../..

    # Update root package.json to match
    npm version "$PRERELEASE_VERSION" --no-git-tag-version --allow-same-version

    # Commit version changes
    git add packages/core/package.json package.json
    git commit -m "chore(core): $PRERELEASE_ID release v$PRERELEASE_VERSION"

    # Create tag (only if it doesn't exist)
    if git tag --list | grep -q "^core-v$PRERELEASE_VERSION$"; then
        print_warning "Tag core-v$PRERELEASE_VERSION already exists, skipping tag creation"
    else
        git tag "core-v$PRERELEASE_VERSION"
    fi

    # Temporarily rename package for publishing
    print_status "Preparing package for publishing as @avail-project/nexus-core..."
    cd packages/core

    # Backup original package.json
    cp package.json package.json.backup

    # Update package name for publishing
    sed -i.tmp 's/"name": "@nexus\/core"/"name": "@avail-project\/nexus-core"/' package.json
    rm package.json.tmp 2>/dev/null || true

    # Remove workspace-only dependencies that should be bundled (e.g., @nexus/commons)
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));if(p.dependencies&&p.dependencies['@nexus/commons']){delete p.dependencies['@nexus/commons'];}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

    # Bundle internal commons into dist (imports already aliased by Rollup)
    print_status "Bundling internal @nexus/commons into dist..."
    mkdir -p dist/commons
    cp -R ../commons/dist/* dist/commons/

    # Publish to npm with prerelease tag
    print_status "Publishing @avail-project/nexus-core@$PRERELEASE_VERSION to npm ($PRERELEASE_ID tag)..."
    npm publish --access public --tag $PRERELEASE_ID
    # Add incremental tag (e.g., alpha-1, beta-2) matching pre-release number
    INCREMENTAL_TAG=$(node -e "const v=process.env.PRERELEASE_VERSION||'';const m=v.match(/$PRERELEASE_ID\\.(\\d+)/);console.log(m ? ('$PRERELEASE_ID-' + m[1]) : '$PRERELEASE_ID')")
    if [ -n "$INCREMENTAL_TAG" ] && [ "$INCREMENTAL_TAG" != "$PRERELEASE_ID" ]; then
      print_status "Adding dist-tag $INCREMENTAL_TAG for @avail-project/nexus-core@$PRERELEASE_VERSION..."
      npm dist-tag add @avail-project/nexus-core@$PRERELEASE_VERSION $INCREMENTAL_TAG || true
    fi

    # Restore original package.json
    mv package.json.backup package.json
    cd ../..

    # Push changes and tags
    print_status "Pushing changes to git..."
    git push origin $(git branch --show-current)
    git push origin "core-v$PRERELEASE_VERSION"

    print_header "✅ Development release completed!"
    print_status "🚀 @avail-project/nexus-core@$PRERELEASE_VERSION published successfully!"
    print_status "📦 Install with: npm install @avail-project/nexus-core@$PRERELEASE_ID"
fi

print_header "🎉 @avail-project/nexus-core release process completed successfully!"

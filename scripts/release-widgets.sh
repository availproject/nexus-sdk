#!/bin/bash

# Nexus Widgets SDK Release Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
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
    echo -e "${PURPLE}[WIDGETS RELEASE]${NC} $1"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

# Check if we're in the root directory
if [[ ! -f "package.json" ]] || [[ ! -d "packages/widgets" ]]; then
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

if [[ "$RELEASE_TYPE" != "dev" && "$RELEASE_TYPE" != "prod" ]]; then
    print_error "Invalid release type. Use 'dev' or 'prod'"
    echo "Usage: $0 [dev|prod] [patch|minor|major]"
    exit 1
fi

if [[ "$VERSION_TYPE" != "patch" && "$VERSION_TYPE" != "minor" && "$VERSION_TYPE" != "major" ]]; then
    print_error "Invalid version type. Use 'patch', 'minor', or 'major'"
    echo "Usage: $0 [dev|prod] [patch|minor|major]"
    exit 1
fi

print_header "Starting @avail-project/nexus-widgets $RELEASE_TYPE release ($VERSION_TYPE)..."

# Run type checking
print_status "Running type check..."
pnpm run typecheck

# Clean previous builds
print_status "Cleaning previous builds..."
pnpm run clean

# Build dependencies and widgets package
print_status "Building dependencies and @avail-project/nexus-widgets package..."
pnpm run build:widgets

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
    
    # Check if @avail-project/nexus is published and available
    print_status "Checking @avail-project/nexus dependency..."
    if ! npm view @avail-project/nexus > /dev/null 2>&1; then
        print_error "@avail-project/nexus is not published. Please release core package first."
        print_status "Run: ./scripts/release-core.sh prod"
        exit 1
    fi
    
    # Version bump
    print_status "Bumping version ($VERSION_TYPE)..."
    cd packages/widgets
    npm version $VERSION_TYPE --no-git-tag-version
    WIDGETS_VERSION=$(node -p "require('./package.json').version")
    cd ../..
    
    # Commit version changes
    git add packages/widgets/package.json
    git commit -m "chore(widgets): release v$WIDGETS_VERSION"
    
    # Create tag
    git tag "widgets-v$WIDGETS_VERSION"
    
    # Temporarily rename package for publishing
    print_status "Preparing package for publishing as @avail-project/nexus-widgets..."
    cd packages/widgets
    
    # Backup original package.json
    cp package.json package.json.backup
    
    # Update package name for publishing
    sed -i.tmp 's/"name": "@nexus\/widgets"/"name": "@avail-project\/nexus-widgets"/' package.json
    rm package.json.tmp 2>/dev/null || true
    
    # Publish to npm
    print_status "Publishing @avail-project/nexus-widgets@$WIDGETS_VERSION to npm..."
    npm publish --access public
    
    # Restore original package.json
    mv package.json.backup package.json
    cd ../..
    
    # Push changes and tags
    print_status "Pushing changes to git..."
    git push origin $CURRENT_BRANCH
    git push origin "widgets-v$WIDGETS_VERSION"
    
    print_header "✅ Production release completed!"
    print_status "🚀 @avail-project/nexus-widgets@$WIDGETS_VERSION published successfully!"
    print_status "📦 Install with: npm install @avail-project/nexus-widgets"
    print_status "🎨 Includes React components for cross-chain transactions"
    
else
    print_header "Creating development release..."
    
    # Version bump with dev suffix
    print_status "Bumping dev version ($VERSION_TYPE)..."
    cd packages/widgets
    
    # Get current version and increment
    CURRENT_VERSION=$(node -p "require('./package.json').version")
    npm version $VERSION_TYPE --no-git-tag-version
    NEW_VERSION=$(node -p "require('./package.json').version")
    DEV_VERSION="$NEW_VERSION-dev.$(date +%s)"
    
    # Set dev version
    npm version $DEV_VERSION --no-git-tag-version
    cd ../..
    
    # Commit version changes
    git add packages/widgets/package.json
    git commit -m "chore(widgets): dev release v$DEV_VERSION"
    
    # Create tag
    git tag "widgets-v$DEV_VERSION"
    
    # Temporarily rename package for publishing
    print_status "Preparing package for publishing as @avail-project/nexus-widgets..."
    cd packages/widgets
    
    # Backup original package.json
    cp package.json package.json.backup
    
    # Update package name for publishing
    sed -i.tmp 's/"name": "@nexus\/widgets"/"name": "@avail-project\/nexus-widgets"/' package.json
    rm package.json.tmp 2>/dev/null || true
    
    # Publish to npm with dev tag
    print_status "Publishing @avail-project/nexus-widgets@$DEV_VERSION to npm (dev tag)..."
    npm publish --access public --tag dev
    
    # Restore original package.json
    mv package.json.backup package.json
    cd ../..
    
    # Push changes and tags
    print_status "Pushing changes to git..."
    git push origin $(git branch --show-current)
    git push origin "widgets-v$DEV_VERSION"
    
    print_header "✅ Development release completed!"
    print_status "🚀 @avail-project/nexus-widgets@$DEV_VERSION published successfully!"
    print_status "📦 Install with: npm install @avail-project/nexus-widgets@dev"
    print_status "🎨 Includes React components for cross-chain transactions"
fi

print_header "🎉 @avail-project/nexus-widgets release process completed successfully!"
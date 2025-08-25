#!/bin/bash

# Nexus SDK Complete Release Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
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
    echo -e "${CYAN}[NEXUS SDK RELEASE]${NC} $1"
}

print_separator() {
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

# Check if we're in the root directory
if [[ ! -f "package.json" ]] || [[ ! -d "packages" ]]; then
    print_error "Please run this script from the monorepo root directory"
    exit 1
fi

# Get the release type from command line argument
RELEASE_TYPE=${1:-"dev"}
VERSION_TYPE=${2:-"patch"}

if [[ "$RELEASE_TYPE" != "dev" && "$RELEASE_TYPE" != "prod" ]]; then
    print_error "Invalid release type. Use 'dev' or 'prod'"
    echo "Usage: $0 [dev|prod] [patch|minor|major]"
    echo ""
    echo "Examples:"
    echo "  $0 dev patch    # Release dev versions with patch bump"
    echo "  $0 prod minor   # Release production versions with minor bump"
    exit 1
fi

if [[ "$VERSION_TYPE" != "patch" && "$VERSION_TYPE" != "minor" && "$VERSION_TYPE" != "major" ]]; then
    print_error "Invalid version type. Use 'patch', 'minor', or 'major'"
    echo "Usage: $0 [dev|prod] [patch|minor|major]"
    exit 1
fi

print_separator
print_header "🚀 Starting Complete Nexus SDK Release"
print_header "Release Type: $RELEASE_TYPE | Version Bump: $VERSION_TYPE"
print_separator

if [[ "$RELEASE_TYPE" == "prod" ]]; then
    print_warning "⚠️  PRODUCTION RELEASE DETECTED ⚠️"
    print_status "This will publish packages to npm with public access"
    print_status "Packages will be tagged as 'latest' and available for production use"
    echo ""
    read -p "Are you sure you want to proceed with production release? (y/N): " confirm
    if [[ $confirm != [yY] ]]; then
        print_error "Aborting production release."
        exit 1
    fi
    print_separator
fi

# Step 1: Release Core Package
print_header "📦 Step 1: Releasing @avail-project/nexus..."
print_separator
if ./scripts/release-core.sh $RELEASE_TYPE $VERSION_TYPE; then
    print_status "✅ @avail-project/nexus released successfully"
else
    print_error "❌ Failed to release @avail-project/nexus"
    exit 1
fi

print_separator

# Step 2: Release Widgets Package
print_header "🎨 Step 2: Releasing @avail-project/nexus-widgets..."
print_separator
if ./scripts/release-widgets.sh $RELEASE_TYPE $VERSION_TYPE; then
    print_status "✅ @avail-project/nexus-widgets released successfully"
else
    print_error "❌ Failed to release @avail-project/nexus-widgets"
    exit 1
fi

print_separator
print_header "🎉 COMPLETE RELEASE SUCCESSFUL! 🎉"
print_separator

if [[ "$RELEASE_TYPE" == "prod" ]]; then
    print_status "📦 Both packages are now available on npm:"
    print_status "   • npm install @avail-project/nexus"
    print_status "   • npm install @avail-project/nexus-widgets"
    print_status ""
    print_status "🔗 Package URLs:"
    print_status "   • https://www.npmjs.com/package/@avail-project/nexus"
    print_status "   • https://www.npmjs.com/package/@avail-project/nexus-widgets"
else
    print_status "🧪 Both dev packages are now available on npm:"
    print_status "   • npm install @avail-project/nexus@dev"
    print_status "   • npm install @avail-project/nexus-widgets@dev"
    print_status ""
    print_status "💡 Dev packages are tagged with 'dev' for testing"
fi

print_status ""
print_status "📚 Documentation: https://docs.nexus-sdk.com"
print_status "🐛 Issues: https://github.com/your-org/nexus-sdk/issues"
print_separator
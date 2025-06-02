#!/bin/bash

# Avail Nexus SDK Release Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository"
    exit 1
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    print_error "There are uncommitted changes. Please commit or stash them first."
    exit 1
fi

# Get the release type from command line argument
RELEASE_TYPE=${1:-"dev"}

if [[ "$RELEASE_TYPE" != "dev" && "$RELEASE_TYPE" != "prod" ]]; then
    print_error "Invalid release type. Use 'dev' or 'prod'"
    echo "Usage: $0 [dev|prod]"
    exit 1
fi

print_status "Starting $RELEASE_TYPE release..."


# Run linting
print_status "Running linter..."
npm run lint

# Type checking
print_status "Running type check..."
npm run typecheck

if [[ "$RELEASE_TYPE" == "prod" ]]; then
    print_status "Creating production release..."
    
    # Ensure we're on main branch for production releases
    CURRENT_BRANCH=$(git branch --show-current)
    if [[ "$CURRENT_BRANCH" != "main" ]]; then
        print_warning "Not on main branch. Switching to main..."
        git checkout main
        git pull origin main
    fi
    
    # Build and publish production version
    npm run release:prod
    
    # Push tags to git
    git push origin main --tags
    
    print_status "Production release completed! 🚀"
    print_status "Users can install with: npm install avail-nexus-sdk"
    
else
    print_status "Creating development release..."
    
    # Build and publish development version
    npm run release:dev
    
    # Push tags to git
    git push origin $(git branch --show-current) --tags
    
    print_status "Development release completed! 🚀"
    print_status "Users can install with: npm install avail-nexus-sdk@dev"
fi

print_status "Release process completed successfully!" 
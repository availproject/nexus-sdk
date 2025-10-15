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

# Flags
NON_INTERACTIVE=0
for arg in "$@"; do
    if [[ "$arg" == "--yes" || "$arg" == "-y" || "$arg" == "--ci" ]]; then
        NON_INTERACTIVE=1
    fi
done
DRY_RUN=0
for arg in "$@"; do
    if [[ "$arg" == "--dry-run" || "$arg" == "-n" ]]; then
        DRY_RUN=1
    fi
done

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

# Get the release type from command line argument (positional defaults)
RELEASE_TYPE=${1:-"dev"}
VERSION_TYPE=${2:-"patch"}
PRERELEASE_ID=${3:-"dev"}

# Interactive wizard (skipped with --yes)
if [[ $NON_INTERACTIVE -eq 0 ]]; then
    echo ""
    print_header "Interactive release wizard"
    echo "This will publish @avail-project/nexus-widgets."
    echo ""
    echo "Examples:"
    echo "  dev prerelease: 0.0.2-beta.0 -> 0.0.2-beta.1 ... -> 0.0.2-beta.9 -> 0.0.3-beta.0"
    echo "  prod release:   0.0.2 -> 0.0.3 (patch), 0.1.0 (minor), 1.0.0 (major)"
    echo ""
    read -p "Release type [dev|prod] (default: $RELEASE_TYPE): " _rt
    if [[ -n "$_rt" ]]; then RELEASE_TYPE="$_rt"; fi
    if [[ "$RELEASE_TYPE" != "dev" && "$RELEASE_TYPE" != "prod" ]]; then
        print_error "Invalid release type. Use 'dev' or 'prod'"
        exit 1
    fi
    if [[ "$RELEASE_TYPE" == "dev" ]]; then
        read -p "Pre-release tag (e.g. beta, alpha, dev) (default: $PRERELEASE_ID): " _pre
        if [[ -n "$_pre" ]]; then PRERELEASE_ID="$_pre"; fi
        echo ""
        echo "Base bump is applied ONLY when starting a new $PRERELEASE_ID series."
        echo "Examples: start at 0.0.2-$PRERELEASE_ID.0 (patch), or 0.1.0-$PRERELEASE_ID.0 (minor)."
        read -p "Base bump for new series [patch|minor|major] (default: $VERSION_TYPE): " _vt
        if [[ -n "$_vt" ]]; then VERSION_TYPE="$_vt"; fi
    else
        read -p "Version bump [patch|minor|major] (default: $VERSION_TYPE): " _vtp
        if [[ -n "$_vtp" ]]; then VERSION_TYPE="$_vtp"; fi
    fi
fi

if [[ "$RELEASE_TYPE" != "dev" && "$RELEASE_TYPE" != "prod" ]]; then
    print_error "Invalid release type. Use 'dev' or 'prod'"
    echo "Usage: $0 [dev|prod] [patch|minor|major] [prerelease-id]"
    echo "Examples:"
    echo "  $0 dev patch alpha    # Creates 0.1.1-alpha.0"
    echo "  $0 dev minor beta     # Creates 0.2.0-beta.0"
    echo "  $0 dev patch          # Creates 0.1.1-dev.0 (default)"
    exit 1
fi

if [[ "$VERSION_TYPE" != "patch" && "$VERSION_TYPE" != "minor" && "$VERSION_TYPE" != "major" ]]; then
    print_error "Invalid version type. Use 'patch', 'minor', or 'major'"
    echo "Usage: $0 [dev|prod] [patch|minor|major] [prerelease-id]"
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
        if [[ $NON_INTERACTIVE -eq 0 ]]; then
            read -p "Do you want to continue with production release from this branch? (y/N): " confirm
            if [[ $confirm != [yY] ]]; then
                print_error "Aborting production release. Switch to main branch first."
                exit 1
            fi
        else
            print_status "--yes provided. Continuing from $CURRENT_BRANCH."
        fi
    fi

    # Check if @avail-project/nexus-core is published and available
    print_status "Checking @avail-project/nexus-core dependency..."
    if ! npm view @avail-project/nexus-core > /dev/null 2>&1; then
        print_error "@avail-project/nexus-core is not published. Please release core package first."
        print_status "Run: ./scripts/release-core.sh prod"
        exit 1
    fi

    # Fetch latest version from npm to ensure proper increment
    print_status "Fetching latest version from npm..."
    LATEST_WIDGETS_VERSION=$(npm view @avail-project/nexus-widgets version 2>/dev/null || echo "0.0.0")
    print_status "Latest widgets version: $LATEST_WIDGETS_VERSION"

    # Version bump
    print_status "Bumping version ($VERSION_TYPE)..."
    cd packages/widgets

    # Set current version to latest version to ensure proper increment
    npm version "$LATEST_WIDGETS_VERSION" --no-git-tag-version --allow-same-version
    npm version $VERSION_TYPE --no-git-tag-version

    WIDGETS_VERSION=$(node -p "require('./package.json').version")
    cd ../..

    # Commit version changes
    git add packages/widgets/package.json
    git commit -m "chore(widgets): release v$WIDGETS_VERSION"

    # Create tag (remove existing if present, then create new)
    if git tag -l | grep -q "^widgets-v$WIDGETS_VERSION$"; then
        print_warning "Tag widgets-v$WIDGETS_VERSION already exists, removing it..."
        git tag -d "widgets-v$WIDGETS_VERSION"
    fi
    git tag "widgets-v$WIDGETS_VERSION"

    # Temporarily rewrite package for publishing
    print_status "Preparing package for publishing as @avail-project/nexus-widgets..."
    cd packages/widgets

    # Backup original package.json
    cp package.json package.json.backup

    # Resolve published core version (prod)
    CORE_PUBLISHED_VERSION=$(npm view @avail-project/nexus-core version 2>/dev/null || true)
    export CORE_PUBLISHED_VERSION
    if [[ -z "$CORE_PUBLISHED_VERSION" ]]; then
        print_error "@avail-project/nexus-core is not published or version could not be resolved. Release core first."
        exit 1
    fi

    # Rewrite package.json: name -> @avail-project/nexus-widgets, deps: @nexus/core -> @avail-project/nexus-core@<version>, remove @nexus/commons
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.name='@avail-project/nexus-widgets';p.dependencies=p.dependencies||{};if(p.dependencies['@nexus/core']){delete p.dependencies['@nexus/core'];p.dependencies['@avail-project/nexus-core']=process.env.CORE_PUBLISHED_VERSION;}if(p.dependencies['@nexus/commons']){delete p.dependencies['@nexus/commons'];}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

    # Bundle internal commons into dist (imports already aliased by Rollup)
    print_status "Bundling internal @nexus/commons into widgets dist..."
    mkdir -p dist/commons
    cp -R ../commons/dist/* dist/commons/

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

    # Compute next prerelease version with 0-9 rollover by publication time
    print_status "Computing next $PRERELEASE_ID version with rollover logic..."
    cd packages/widgets
    export PRERELEASE_ID
    export VERSION_TYPE
    export PKG='@avail-project/nexus-widgets'
    PRERELEASE_VERSION=$(node -e '
const cp=require("child_process");
const fs=require("fs");
const pkg=process.env.PKG;
const pre=process.env.PRERELEASE_ID||"dev";
const bump=process.env.VERSION_TYPE||"patch";
const current=JSON.parse(fs.readFileSync("package.json","utf8")).version;
function exec(cmd){try{return cp.execSync(cmd,{stdio:["pipe","pipe","ignore"]}).toString().trim();}catch(e){return "";}}
function parse(v){const m=v&&v.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+)\.(\d+))?$/);if(!m) return null;return {M:+m[1],m:+m[2],p:+m[3],pre:m[4],n:m[5]?+m[5]:null};}
function cmpBase(a,b){if(a.M!==b.M) return a.M-b.M; if(a.m!==b.m) return a.m-b.m; return a.p-b.p;}
function bumpBase(base,t){if(t==="major") return {M:base.M+1,m:0,p:0}; if(t==="minor") return {M:base.M,m:base.m+1,p:0}; return {M:base.M,m:base.m,p:base.p+1};}
function toStr(b,preid,idx){return `${b.M}.${b.m}.${b.p}-${preid}.${idx}`}
let timesJSON = exec(`npm view ${pkg} time --json`);
let times={};try{times=JSON.parse(timesJSON||"{}");}catch(_){times={};}
let preEntries=Object.entries(times).filter(([v])=>new RegExp(`^\\d+\\.\\d+\\.\\d+-${pre}\\.\\d+$`).test(v));
preEntries.sort((a,b)=>new Date(a[1]) - new Date(b[1]));
let latestPre = preEntries.length? preEntries[preEntries.length-1][0] : "";
let latestStable = exec(`npm view ${pkg} version 2>/dev/null`) || "";
let next;
if(latestPre){
  const lp=parse(latestPre);
  if(lp.n<9){ next=toStr({M:lp.M,m:lp.m,p:lp.p},pre,lp.n+1); }
  else { next=toStr({M:lp.M,m:lp.m,p:lp.p+1},pre,0); }
}else{
  const curr=parse(current);
  const stable=parse(latestStable)||curr;
  let base = cmpBase(stable,curr) >= 0 ? stable : curr;
  base = bumpBase(base,bump);
  next = toStr(base,pre,0);
}
console.log(next);
')
    export PRERELEASE_VERSION
    npm version "$PRERELEASE_VERSION" --no-git-tag-version --allow-same-version
    cd ../..

    # Commit version changes
    if [[ $DRY_RUN -eq 1 ]]; then
        print_status "DRY RUN: would git add/commit dev bump to v$PRERELEASE_VERSION and tag widgets-v$PRERELEASE_VERSION"
    else
        git add packages/widgets/package.json
        git commit -m "chore(widgets): $PRERELEASE_ID release v$PRERELEASE_VERSION" || print_status "No version changes to commit (dev)."
    fi

    # Create tag (remove existing if present, then create new)
    if git tag -l | grep -q "^widgets-v$PRERELEASE_VERSION$"; then
        print_warning "Tag widgets-v$PRERELEASE_VERSION already exists, removing it..."
        git tag -d "widgets-v$PRERELEASE_VERSION"
    fi
    if [[ $DRY_RUN -eq 1 ]]; then
        print_status "DRY RUN: would create tag widgets-v$PRERELEASE_VERSION"
    else
        git tag "widgets-v$PRERELEASE_VERSION"
    fi

    # Temporarily rewrite package for publishing
    print_status "Preparing package for publishing as @avail-project/nexus-widgets..."
    cd packages/widgets

    # Backup original package.json
    cp package.json package.json.backup

    # Resolve latest published core version for the same prerelease tag by time (not semver)
    export PRERELEASE_ID
    CORE_PUBLISHED_VERSION=$(node -e '
const cp=require("child_process");
function exec(cmd){try{return cp.execSync(cmd,{stdio:["pipe","pipe","ignore"]}).toString().trim();}catch(e){return "";}}
const pre=process.env.PRERELEASE_ID||"dev";
let times={};
try{ times=JSON.parse(exec("npm view @avail-project/nexus-core time --json")||"{}"); }catch(_){ times={}; }
let entries=Object.entries(times).filter(([v])=>new RegExp(`^\\d+\\.\\d+\\.\\d+-${pre}\\.\\d+$`).test(v));
entries.sort((a,b)=>new Date(a[1]) - new Date(b[1]));
let latest=entries.length? entries[entries.length-1][0] : "";
process.stdout.write(latest);
')
    export CORE_PUBLISHED_VERSION
    if [[ -z "$CORE_PUBLISHED_VERSION" ]]; then
        print_error "@avail-project/nexus-core@$PRERELEASE_ID is not published. Please release core $PRERELEASE_ID first (./scripts/release-core.sh dev patch $PRERELEASE_ID)."
        exit 1
    fi

    # Rewrite package.json: name -> @avail-project/nexus-widgets, deps: @nexus/core -> @avail-project/nexus-core@<dev-version>, remove @nexus/commons
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.name='@avail-project/nexus-widgets';p.dependencies=p.dependencies||{};if(p.dependencies['@nexus/core']){delete p.dependencies['@nexus/core'];p.dependencies['@avail-project/nexus-core']=process.env.CORE_PUBLISHED_VERSION;}if(p.dependencies['@nexus/commons']){delete p.dependencies['@nexus/commons'];}fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"

    # Bundle internal commons into dist (imports already aliased by Rollup)
    print_status "Bundling internal @nexus/commons into widgets dist..."
    mkdir -p dist/commons
    cp -R ../commons/dist/* dist/commons/

    # Publish to npm with prerelease tag (or pack in dry-run)
    if [[ $DRY_RUN -eq 1 ]]; then
        print_status "DRY RUN: npm pack (skipping publish) for @avail-project/nexus-widgets@$PRERELEASE_VERSION"
        npm pack >/dev/null 2>&1 || true
    else
        print_status "Publishing @avail-project/nexus-widgets@$PRERELEASE_VERSION to npm ($PRERELEASE_ID tag)..."
        npm publish --access public --tag $PRERELEASE_ID
        # Add incremental tag (e.g., alpha-1, beta-2) matching pre-release number
        INCREMENTAL_TAG=$(node -e "const v=process.env.PRERELEASE_VERSION||'';const m=v.match(/$PRERELEASE_ID\\.(\\d+)/);console.log(m ? ('$PRERELEASE_ID-' + m[1]) : '$PRERELEASE_ID')")
        if [ -n "$INCREMENTAL_TAG" ] && [ "$INCREMENTAL_TAG" != "$PRERELEASE_ID" ]; then
          print_status "Adding dist-tag $INCREMENTAL_TAG for @avail-project/nexus-widgets@$PRERELEASE_VERSION..."
          npm dist-tag add @avail-project/nexus-widgets@$PRERELEASE_VERSION $INCREMENTAL_TAG || true
        fi
    fi

    # Restore original package.json
    mv package.json.backup package.json
    cd ../..

    # Push changes and tags
    if [[ $DRY_RUN -eq 1 ]]; then
        print_status "DRY RUN: skipping git push of branch and tag widgets-v$PRERELEASE_VERSION"
    else
        print_status "Pushing changes to git..."
        git push origin $(git branch --show-current)
        git push origin "widgets-v$PRERELEASE_VERSION"
    fi

    print_header "✅ Development release completed!"
    print_status "🚀 @avail-project/nexus-widgets@$PRERELEASE_VERSION published successfully!"
    print_status "📦 Install with: npm install @avail-project/nexus-widgets@$PRERELEASE_ID"
    print_status "🎨 Includes React components for cross-chain transactions"
fi

print_header "🎉 @avail-project/nexus-widgets release process completed successfully!"

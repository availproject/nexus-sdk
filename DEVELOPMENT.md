# Development Guide

This guide explains how to manage and maintain both production and development versions of the Avail Nexus SDK.

## Overview

The SDK uses a dual-channel distribution approach:

- **Production SDK** (`latest` tag): Stable, thoroughly tested releases
- **Development SDK** (`dev` tag): Latest features and experimental changes

## Branch Strategy

```
main (production)
├── develop (development)
├── feature/new-feature
└── hotfix/critical-fix
```

### Branches

- **`main`**: Production-ready code. All production releases are made from this branch.
- **`develop`**: Integration branch for new features. Development releases are made from here.
- **`feature/*`**: Feature branches created from `develop`
- **`hotfix/*`**: Critical fixes that need to go directly to production

## Release Process

### Development Release

For testing new features and getting early feedback:

```bash
# Method 1: Using npm scripts
npm run release:dev

# Method 2: Using the release script
./scripts/release.sh dev

# Method 3: Manual steps
npm run build:dev
npm version prerelease --preid=dev
npm publish --tag dev
```

**Installation**: `npm install avail-nexus-sdk@dev`

### Production Release

For stable releases to production:

```bash
# Method 1: Using npm scripts
npm run release:prod

# Method 2: Using the release script
./scripts/release.sh prod

# Method 3: Manual steps
npm run build:prod
npm version patch
npm publish --tag latest
```

**Installation**: `npm install avail-nexus-sdk`

## Automated CI/CD

The GitHub Actions workflow automatically:

1. **Tests** all code on every push and PR
2. **Publishes development versions** when pushing to `develop` branch
3. **Publishes production versions** when pushing to `main` branch
4. **Creates GitHub releases** when pushing version tags

### Setting up CI/CD

1. Add `NPM_TOKEN` to GitHub repository secrets:

   - Go to your repository settings
   - Navigate to Secrets and variables > Actions
   - Add a new secret named `NPM_TOKEN` with your NPM auth token

2. The workflow will automatically trigger on:
   - Push to `main` → Production release
   - Push to `develop` → Development release
   - Pull requests → Tests only

## Version Management

### Version Numbers

- **Production**: `1.0.0`, `1.0.1`, `1.1.0`, etc.
- **Development**: `1.0.0-dev.1`, `1.0.0-dev.2`, etc.

### Version Commands

```bash
# Development versions (prerelease)
npm run version:dev

# Production versions (patch/minor/major)
npm run version:prod
npm version minor  # For new features
npm version major  # For breaking changes
```

## Environment Configuration

The SDK includes environment-specific configurations:

```typescript
import { getEnvironmentConfig, PRODUCTION_CONFIG, DEVELOPMENT_CONFIG } from 'avail-nexus-sdk';

// Get current environment config
const config = getEnvironmentConfig();

// Use specific environment
const devConfig = DEVELOPMENT_CONFIG;
const prodConfig = PRODUCTION_CONFIG;
```

## Testing Different Versions

### In Your Project

```json
{
  "dependencies": {
    "avail-nexus-sdk": "^1.0.0"
  },
  "devDependencies": {
    "avail-nexus-sdk-dev": "npm:avail-nexus-sdk@dev"
  }
}
```

Then import:

```typescript
// Production version
import { formatBalance } from 'avail-nexus-sdk';

// Development version
import { formatBalance } from 'avail-nexus-sdk-dev';
```

## Best Practices

### For Development

1. **Feature Development**:

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/my-new-feature
   # Make changes
   git commit -m "feat: add new feature"
   git push origin feature/my-new-feature
   # Create PR to develop
   ```

2. **Testing Changes**:

   ```bash
   npm run release:dev
   # Test in your application with: npm install avail-nexus-sdk@dev
   ```

3. **Integration**:
   ```bash
   # After PR is merged to develop
   git checkout develop
   git pull origin develop
   # Automatic dev release will be triggered
   ```

### For Production

1. **Release Preparation**:

   ```bash
   git checkout main
   git merge develop
   # Run full test suite
   npm test
   npm run lint
   npm run typecheck
   ```

2. **Release**:

   ```bash
   ./scripts/release.sh prod
   git push origin main --tags
   ```

3. **Hotfixes**:
   ```bash
   git checkout main
   git checkout -b hotfix/critical-issue
   # Fix the issue
   git commit -m "fix: critical issue"
   git checkout main
   git merge hotfix/critical-issue
   ./scripts/release.sh prod
   ```

## Troubleshooting

### Common Issues

1. **Build Failures**:

   ```bash
   npm run clean  # if you have this script
   rm -rf dist node_modules
   npm install
   npm run build
   ```

2. **Version Conflicts**:

   ```bash
   npm version --no-git-tag-version patch
   ```

3. **NPM Publish Errors**:
   ```bash
   npm whoami  # Check if logged in
   npm login   # If not logged in
   ```

### Rollback

If you need to rollback a release:

```bash
# Unpublish recent version (within 72 hours)
npm unpublish avail-nexus-sdk@1.0.1

# Or deprecate a version
npm deprecate avail-nexus-sdk@1.0.1 "This version has critical bugs"
```

## Monitoring

### Check Published Versions

```bash
# List all versions
npm view avail-nexus-sdk versions --json

# Check latest versions
npm view avail-nexus-sdk dist-tags

# Download stats
npm view avail-nexus-sdk
```

### Usage Analytics

Monitor how users are adopting different versions to understand usage patterns and plan deprecation strategies.

# Release Scripts

This directory contains release scripts for the Nexus SDK monorepo packages.

## Available Scripts

### Individual Package Releases

#### Core Package (`@nexus/core`)
```bash
# Development release (default)
./scripts/release-core.sh dev [patch|minor|major]
pnpm run release:core:dev

# Production release
./scripts/release-core.sh prod [patch|minor|major]
pnpm run release:core:prod
```

#### Widgets Package (`@nexus/widgets`)
```bash
# Development release (default)  
./scripts/release-widgets.sh dev [patch|minor|major]
pnpm run release:widgets:dev

# Production release
./scripts/release-widgets.sh prod [patch|minor|major]
pnpm run release:widgets:prod
```

### Complete Release (Both Packages)

```bash
# Development release of both packages
./scripts/release-all.sh dev [patch|minor|major]
pnpm run release:dev

# Production release of both packages
./scripts/release-all.sh prod [patch|minor|major]
pnpm run release:prod
```

## Release Types

### Development Releases (`dev`)
- Publishes packages with `-dev.timestamp` suffix
- Tagged with `dev` on npm
- Can be installed with `npm install @nexus/core@dev`
- Useful for testing and pre-release versions
- No branch restrictions

### Production Releases (`prod`)
- Publishes clean version numbers (e.g., `1.2.3`)
- Tagged with `latest` on npm (default install)
- Checks for main branch (with override option)
- Creates git tags and pushes to remote
- Requires confirmation prompt

## Version Bump Types

- **patch**: Bug fixes (1.0.0 → 1.0.1)
- **minor**: New features (1.0.0 → 1.1.0)  
- **major**: Breaking changes (1.0.0 → 2.0.0)

## Examples

```bash
# Quick dev release with patch version bump
pnpm run release:dev

# Production release with minor version bump
pnpm run release:prod prod minor

# Release only core package for production
pnpm run release:core:prod prod major

# Release only widgets for development testing
pnpm run release:widgets:dev dev patch
```

## Prerequisites

- Clean git working directory (no uncommitted changes)
- All dependencies installed (`pnpm install`)
- Valid npm authentication for publishing

## What the Scripts Do

1. **Validation**: Check git status, dependencies, and prerequisites
2. **Type Checking**: Run `pnpm run typecheck` to ensure code quality
3. **Building**: Clean and build all necessary packages
4. **Version Bump**: Update package.json versions appropriately
5. **Git Operations**: Commit version changes, create tags
6. **Publishing**: Publish to npm with correct tags and access
7. **Cleanup**: Push changes and tags to remote repository

## Dependency Order

The widgets package depends on the core package, so:
- For production releases, core must be published before widgets
- The unified script (`release-all.sh`) handles this dependency order automatically
- Individual scripts can be run independently for development releases

## Output

All scripts provide colored, detailed output showing:
- Current operation status
- Build results and warnings
- Publication confirmation
- Installation instructions
- Links to published packages

## Error Handling

Scripts will exit with error codes if:
- Git repository has uncommitted changes
- Type checking fails
- Build process fails
- Publication fails
- Required dependencies are missing
# Release Scripts

This directory contains release scripts for the Nexus SDK monorepo packages.

## Available Scripts

### Individual Package Releases

#### Core Package (`@avail-project/nexus-core`)

```bash
# Development release (default)
./scripts/release-core.sh dev [patch|minor|major]
pnpm run release:core:dev

# Production release
./scripts/release-core.sh prod [patch|minor|major]
pnpm run release:core:prod
```

#### Widgets Package (`@avail-project/nexus-widgets`)

```bash
# Development release (default)
./scripts/release-widgets.sh dev [patch|minor|major]
pnpm run release:widgets:dev

# Production release
./scripts/release-widgets.sh prod [patch|minor|major]
pnpm run release:widgets:prod
```

### Local Tarballs (No Publish)

```bash
# Build and create .tgz files for local installs
./scripts/local-pack.sh

# In another project
pnpm add /absolute/path/to/dist-tarballs/avail-project-nexus-core-*.tgz \
         /absolute/path/to/dist-tarballs/avail-project-nexus-widgets-*.tgz
```

## Release Types

### Development Releases (`dev`)

- Creates SemVer prereleases with your chosen tag (e.g., `beta`, `alpha`, `dev`).
- Prerelease numbering policy: increments 0→9, then rolls to the next patch.
  - Example: `0.0.2-beta.0 → 0.0.2-beta.1 … → 0.0.2-beta.9 → 0.0.3-beta.0`.
- Widgets depends on the most recently published Core prerelease for the same tag by publish timestamp (not by semver magnitude).
- No branch restrictions.

### Production Releases (`prod`)

- Publishes clean version numbers (e.g., `1.2.3`).
- Tagged with `latest` on npm (default install).
- Checks for `main` branch (can be overridden with `--yes`).
- Creates git tags and pushes to remote.
- Interactive confirmation unless `--yes` is passed.

## Version Bump Types

- **patch**: Bug fixes (1.0.0 → 1.0.1)
- **minor**: New features (1.0.0 → 1.1.0)
- **major**: Breaking changes (1.0.0 → 2.0.0)

## Examples

```bash
# Core – interactive dev prerelease (choose tag: beta/alpha/dev)
./scripts/release-core.sh

# Core – non-interactive dev prerelease (beta), dry-run
./scripts/release-core.sh dev patch beta --yes --dry-run

# Core – non-interactive dev prerelease (beta), publish
./scripts/release-core.sh dev patch beta --yes

# Core – production release (patch) from current branch
./scripts/release-core.sh prod patch --yes

# Widgets – interactive dev prerelease (requires matching core prerelease on npm)
./scripts/release-widgets.sh

# Widgets – non-interactive dev prerelease (beta), resolves latest core beta by timestamp, dry-run
./scripts/release-widgets.sh dev patch beta --yes --dry-run

# Widgets – production release (patch)
./scripts/release-widgets.sh prod patch --yes
```

## Prerequisites

- Clean git working directory (no uncommitted changes)
- All dependencies installed (`pnpm install`)
- Valid npm authentication for publishing

## What the Scripts Do

1. **Validation**: Check git status, dependencies, and prerequisites
2. **Type Checking**: Run `pnpm run typecheck` to ensure code quality
3. **Building**: Clean and build all necessary packages
4. **Version Bump**: Interactive wizard chooses dev/prod and tag; dev follows 0–9 rollover policy; prod bumps patch/minor/major
5. **Git Operations**: Commit version changes, create tags
6. **Publishing**: Publish to npm with correct tags and access
7. **Cleanup**: Push changes and tags to remote repository

## Dependency Order

The widgets package depends on the core package, so:

- For production releases, core must be published before widgets.
- For dev prereleases, the widgets script resolves the most recently published core prerelease for the same tag by npm publish time.

## Output

All scripts provide colored, detailed output showing:

- Current operation status
- Build results and warnings
- Publication confirmation
- Installation instructions
- Links to published packages

## Error Handling

Scripts will exit with error codes if:

- Git repository has uncommitted changes.
- Type checking fails.
- Build process fails.
- Publication fails.
- Required dependencies are missing.

## Flags

- `--yes` or `--ci`: skip interactive prompts (useful in CI; also bypasses the main-branch prompt on prod).
- `--dry-run` or `-n`: simulate publish (runs `npm pack` instead of `npm publish`; skips git push/tag).

## Internal Commons

- `@nexus/commons` is internal and kept out of published dependencies.
- Both scripts bundle `commons` into `dist/commons` so consumers never install it directly.

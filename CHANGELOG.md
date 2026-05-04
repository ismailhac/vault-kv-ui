# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - 2026-05-04

### Added
- Dynamic version display — `/api/version` endpoint returns runtime version from package.json
- Auth guards on sensitive admin endpoints (`/api/admin/logs`, `/api/auth/logout`)

### Fixed
- Version now reflects actual published package version (was hardcoded to v1.0.0)

### Changed
- Updated all documentation to remove internal references and reflect current implementation
- OIDC login flow documented in CLAUDE.md to clarify native API approach (no vault CLI dependency)
- Namespace configuration now via UI Setup Wizard (previously required code editing)

## [1.0.4] - 2026-05-02

### Added
- Global npm package distribution via `npm install -g vault-kv-ui`
- Automatic browser opening on startup with platform-specific commands
- CLI entry point at `bin/vault-kv-ui.mjs`
- GitHub Actions release workflow with npm publishing

### Fixed
- Vault namespace normalization (strip trailing slashes)
- Static frontend serving in production mode

## [1.0.0] - 2026-04

### Added
- Initial public release
- Full-featured Vault KV v2 secret browser UI
- Multi-namespace support with per-namespace tokens
- OIDC authentication flow
- Comprehensive audit logging with restore capability
- Bulk operation modals (feature flags, key rename, key removal, etc.)
- Admin dashboard with logging and editing toggles
- Dark theme with French UI

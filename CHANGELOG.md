# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [1.4.0] — 2026-05-11
### Features
- i18n-english-first: Full internationalisation with vue-i18n v9 — English as default locale on first load, French as a fully supported locale, EN/FR language switcher in the header, locale persisted in localStorage; all UI strings extracted from 20+ Vue components into en.json and fr.json

## [1.3.0] — 2026-05-11
### Features
- nested-json-values: Display JSON object/array secret values as collapsible accordions with inline leaf editing, key renaming, nested diffs, and type-aware smart controls

## [1.2.0] - 2026-05-07

### Added
- kv-version-history: Surface KV v2 version timeline in SecretPanel — collapsible history panel lists all versions newest-first with inline color-coded diff accordion and one-click restore; inline double-click row editing writes a single Vault version per save

## [1.1.3] - 2026-05-07

### Fixed
- Postinstall banner now visible during `npm install -g` — writes directly to `/dev/tty` to bypass npm 10's stdio piping of lifecycle scripts (falls back to stderr in non-TTY environments)

## [1.1.2] - 2026-05-07

### Fixed
- Postinstall banner now visible during `npm install -g` — switched from stdout to stderr so npm 7+ does not suppress the output
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-05-07

### Added
- `--version` / `-v` flag — prints the installed version and exits
- Postinstall welcome banner — displayed after `npm install -g vault-admin` with the version, run command, and docs URL

## [1.1.0] - 2026-05-07

### Added
- Global Search — inline search input in the browser nav bar (always visible, works in read-only mode); press Enter to open SearchModal and find secrets by path substring or key name; click a result to open it directly in SecretPanel; prod paths excluded by default with a toggle to include them

## [1.0.6] - 2026-05-07
### Fixed
- SPA catch-all now serves `index.html` correctly under Express 5 — `res.sendFile` with `{ root }` option instead of an absolute path, which caused `NotFoundError: Not Found` for requests falling through `express.static` (e.g. browser navigation on reload)

## [1.0.5] - 2026-05-06

### Fixed
- SPA catch-all now serves `index.html` correctly under Express 5 — `res.sendFile` with `{ root }` option instead of an absolute path, which caused `NotFoundError: Not Found` for requests falling through `express.static` (e.g. browser navigation on reload)

## [1.0.4] - 2026-05-06

### Fixed
- Old Node.js now shows a clear error instead of a cryptic syntax crash: bin script checks `process.versions.node` before loading any server code and exits with a human-readable message if Node < 18
- Removed `node:` prefix from all built-in imports in the bin and server — the `node:` scheme was only added in Node 14.18 and caused silent resolution failures on older versions

## [1.0.3] - 2026-05-06

### Fixed
- Node.js < 14.8 compatibility: replaced top-level `await import()` with `.then()` chaining — top-level await caused `SyntaxError: Unexpected reserved word` on older Node.js versions

## [1.0.2] - 2026-05-06

### Fixed
- Windows compatibility: `ERR_UNSUPPORTED_ESM_URL_SCHEME` on startup — replaced bare path in dynamic `import()` with `pathToFileURL()` so Windows drive letters (`C:\...`) are handled correctly by the ESM loader

## [1.0.1] - 2026-05-04

### Added
- Global npm package distribution via `npm install -g vault-admin`
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

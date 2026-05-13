# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [1.5.3] — 2026-05-13

### Features
- mini-update-popup: The update badge on the landing page (under Connect/Setup) now opens a compact inline popup instead of the full UpdateModal — shows the version badge, an X close button, and `npm install -g vault-admin@latest` with a one-click copy icon

## [1.5.2] — 2026-05-13

### Fixed
- update-check-stale-cache: `semverGt` helper replaces `!==` in `hasUpdate` — prevents a downgraded cached `latestVersion` from showing as an update; `checkForUpdate` now stores `currentVersion` in the localStorage cache and invalidates it when the running version changes, fixing "v1.5.0 available" shown on a v1.5.1 install after upgrade

## [1.5.1] — 2026-05-13

### Fixed
- **UpdateModal** — tab icons replaced with `$` / `PS>` prompt chars; Windows tab now shows 3 numbered steps (open Node prompt, run command, relaunch); `@latest` appended to the npm install command; `cursor-pointer` on tab buttons, copy button, Close button, and npm link; command reactive via `computed`
- **en.json / fr.json** — replaced `updateModal.windowsHint` key with `windowsStep1`, `windowsStep2`, `windowsStep3` in both locales
- **App.vue / BrowserView.vue** — `cursor-pointer` added to the update badge button in the footer and landing page
- **server/index.mjs** — startup banner now shows `npm install -g vault-admin@latest` (was missing `@latest`)

## [1.5.0] — 2026-05-13

### Features
- **Global search enhancements** — search by value (in addition to path/key); path scope combobox restricts search to a subtree; results show matched key names with masked values (`••••••`) and per-key eye toggle + show/hide all; amber term highlighting; click any result to navigate the browser to the secret's parent folder and open it; result count + secrets scanned + elapsed time in footer; search history (last 8 queries) in both the modal and the inline nav bar
- **Background service install** — `vault-admin --install-service` / `--uninstall-service` registers a silent background service that starts at login with no terminal required: systemd user service + `.desktop` app-launcher entry on Linux; launchd user agent on macOS; Task Scheduler job + Desktop/Start Menu shortcuts on Windows
- **Update notifier** — npm registry check at startup prints an amber banner in the terminal when a new version is available; the UI footer shows a version badge that opens an UpdateModal with the exact update command for macOS/Linux and Windows; check result cached 1 h in localStorage
- **CLI flags** — `--help` / `-h` prints full usage; `--version` / `-v` already existed; all flags documented in README

### Fixed
- Scope bug in value/key search: BFF was always searching from the mount root, ignoring the `path` query parameter — now correctly restricts to the requested subtree
- Nested secret values (JSON strings or objects) now display the correct leaf value and dot-path key in search results, mirroring SecretPanel's existing `parseJsonValue` logic
- Hardcoded `v1.0.0` on the landing page (not-yet-connected screen) replaced with a reactive `vault.appVersion` binding

## [1.4.9] — 2026-05-13
### Features
- background-service-install: Platform-specific background service management — systemd (Linux), launchd (macOS), Task Scheduler (Windows) — with `--install-service` / `--uninstall-service` CLI flags, `--help` / `-h` usage text, and `VAULT_ADMIN_SERVICE` env guard to suppress browser auto-open when running as a service
- search-enhancement: Enhanced global search with value mode, path scope combobox, search history, result highlight, masked values with eye toggle, and flattened nested secret data in BFF
- update-notifier: npm update check with terminal banner on startup, footer/landing badge, and UpdateModal with tabbed install instructions (macOS/Linux + Windows)

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
1.5.4

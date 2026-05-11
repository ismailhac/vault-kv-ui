# Vault Admin

[![npm version](https://img.shields.io/npm/v/vault-admin.svg?style=flat-square)](https://www.npmjs.com/package/vault-admin)
[![Node.js](https://img.shields.io/node/v/vault-admin.svg?style=flat-square)](https://nodejs.org)
[![License MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

<p align="center">
  <img src="app/public/favicon.svg" alt="Vault Admin" width="80" height="80" />
  &nbsp;&nbsp;&nbsp;
  <img src="https://cdn.simpleicons.org/vault/FFEC6E" alt="HashiCorp Vault" width="80" height="80" />
</p>

> 🔐 Professional web console for **HashiCorp Vault KV v2** secret management. Browse, edit, audit, and restore secrets with a modern, intuitive interface.

**Designed for**: DevOps engineers, platform teams, and Vault administrators who need a reliable local UI for daily secret management.

---

## 🚀 Quick Start

```bash
# Install globally (requires Node.js ≥ 20)
npm install -g vault-admin

# Launch from anywhere
vault-admin
```

The UI opens automatically at `http://localhost:3001`.  
Config and audit logs persist in `~/.vault-admin/`.

### Environment Setup

```bash
# Pre-configure your Vault address
VAULT_ADDR=https://vault.company.com vault-admin

# Or provide a token to skip OIDC login
VAULT_ADDR=https://vault.company.com \
VAULT_TOKEN=hvs.xxxxxx \
vault-admin

# Use a different port
BFF_PORT=4000 vault-admin
```

---

## ✨ Features

### 🔍 Secret Browser
- **Navigate** KV folders with breadcrumb trail and history
- **View** secrets in clean key/value table with inline key deletion
- **Edit** secrets with full before/after diff preview (copy-paste JSON or form mode)
- **Create** secrets with intelligent namespace-based presets
- **Delete** individual secrets or entire folder trees with selective checkboxes
- **Download** any path or mount as a single JSON file
- **Search** and filter by path, toggle display of empty secrets

### ⚙️ Bulk Operations
All bulk actions **exclude production paths** by default (configurable).

| Operation | Use Case |
|---|---|
| **Feature Flag** | Apply a flag to many secrets at once |
| **Find & Replace** | Update a key's value across multiple paths |
| **Adjust Values** | Modify a key path-by-path with per-secret overrides |
| **Rename Keys** | Fix misnamed keys in bulk |
| **Remove Keys** | Delete a key from matching secrets |
| **Batch Edit** | Edit multiple secret JSONs with unified diff preview |

### 🔐 Multi-Namespace & Authentication
- **Switch namespaces** at runtime; each maintains its own token
- **OIDC login** — complete browser-based Vault OIDC flow (no CLI required)
- **Token resolution** — in-memory store → env vars → `~/.env` file
- **Admin mode** — read-only toggle, logging controls, user-friendly audit trail

### 📊 Admin Dashboard
- **Stats** — total/daily writes, logins, failures (namespace-scoped)
- **Audit log** — complete write/delete/login history with before/after diffs
- **Restore** — one-click rollback of any write or deletion
- **Settings** — disable editing globally, toggle event logging
- **Persistence** — auto-save on namespace switch; manual save; local JSON export
- **Vault export** — write audit session as readable secret in Vault

### 🌐 User Interface
- **Dark theme** optimized for extended use
- **Responsive design** — works on desktop and tablet
- **Keyboard shortcuts** — arrow keys for breadcrumbs, Ctrl/Cmd+S to save
- **Accessible** — WCAG 2.1 compliant, screen reader support

---

## 📋 Requirements

- **Node.js** ≥ 20 (LTS or latest)
- **HashiCorp Vault** 1.13+ with KV v2 and OIDC auth enabled

---

## 📦 Installation

### Global (Recommended)

```bash
npm install -g vault-admin
vault-admin
```

### Local Development

```bash
git clone https://github.com/ismailhac/vault-kv-ui.git
cd vault-kv-ui
npm install && npm install --prefix app
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VAULT_ADDR` | *(none)* | Your Vault server URL (e.g., `https://vault.company.com`) |
| `VAULT_TOKEN` | *(none)* | Pre-set token to skip OIDC login |
| `VAULT_NAMESPACE` | *(none)* | Default namespace on startup |
| `BFF_PORT` | `3001` | Backend server port |
| `OIDC_CALLBACK_PORT` | `8250` | Local OIDC callback server port |
| `LOGS_FILE` | `~/.vault-admin/audit-logs.json` | Audit log persistence path |

### Adding Namespaces

Launch the app and use the **Setup Wizard** to add Vault namespaces via the UI. They're stored in `~/.vault-admin/config.json`.

Or pre-configure in your shell:
```bash
export VAULT_ADDR=https://vault.company.com
export VAULT_NAMESPACE=org/team/my-namespace
vault-admin
```

---

## 🏗️ Architecture

```
┌─────────────────────┐
│   Browser UI        │  Vue 3 + TypeScript + Pinia
│  (localhost:5173)   │
└──────────┬──────────┘
           │ /api/* →
┌──────────▼──────────┐
│  BFF Server         │  Express.js (ESM)
│  (localhost:3001)   │  • Token management
└──────────┬──────────┘  • Vault proxying
           │ ←HTTP→      • Audit logging
┌──────────▼──────────┐  • OIDC orchestration
│  HashiCorp Vault    │
│  (KV v2 + OIDC)     │
└─────────────────────┘
```

- **Frontend** — Single-page Vue app with centralized Pinia state
- **Backend** — Single Express file handling all Vault proxying, auth, and logging
- **Persistence** — `~/.vault-admin/config.json` (settings), `~/.vault-admin/audit-logs.json` (logs)

---

## 🛠️ Development

```bash
npm run dev          # Start BFF + Vite dev server (recommended)
npm run bff          # BFF only (port 3001)
npm run ui           # Vite dev server only (port 5173)
npm run build        # Type-check + production build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines and contribution process.

---

## 📝 Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release notes and version history.

---

## 🔒 Security

Vault KV UI is a **local development tool** designed for single-user workstations in trusted environments.

- **Localhost-only** — BFF binds to `127.0.0.1` by default
- **No per-user auth** — whoever runs the CLI has full access
- **Audit logging** — all operations logged to persistent JSON
- **Token management** — tokens cached in-memory and `~/.vault-admin/`

For security disclosures, email **imil.dev01@gmail.com** instead of opening a public issue.

See [SECURITY.md](./SECURITY.md) for detailed security considerations.

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for:
- Development setup
- Code style guidelines
- Release process
- Bug reporting

---

## 📄 License

MIT © [Ismail](https://github.com/ismailhac)

---

## 💡 Use Cases

- **Local secret inspection** — quickly view and search secrets without Vault CLI
- **Testing & development** — safely edit/restore test environment secrets
- **Onboarding** — familiar UI for new team members to understand secret structure
- **Bulk operations** — rename keys, apply flags, or adjust values across namespaces
- **Audit trail** — full before/after history with restore capability
- **Configuration rotation** — update database passwords, API keys, certificates in bulk

---

**Questions?** Open an issue on [GitHub](https://github.com/ismailhac/vault-kv-ui/issues).

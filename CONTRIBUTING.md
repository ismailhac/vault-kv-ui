# Contributing

Thank you for your interest in contributing to Vault KV UI.

## Development setup

```bash
git clone https://github.com/ismailhac/vault-kv-ui.git
cd vault-kv-ui
npm install
npm install --prefix app
npm run dev
```

The app runs at **http://localhost:5173**. The BFF runs on port 3001.

## Architecture in brief

```
Browser → Vite dev server (5173) → /api/* proxy → BFF (3001) → Vault API
```

- **BFF** — `server/index.mjs` — a single Express 5 file. All Vault proxying, OIDC login orchestration, admin state, and audit log logic live here.
- **Frontend** — `app/src/` — Vue 3 SPA. All shared state is in `stores/vault.ts` (Pinia). Views are `BrowserView` and `AdminView`. Everything else is a component.
- **No build step for the BFF** — it runs directly with Node.js (`type: "module"` in package.json).

## Configuring namespaces

Launch the app and use the **Setup Wizard** to add Vault namespaces via the UI. Namespaces are stored in `~/.vault-kv-ui/config.json` and persist across sessions.

For development: pre-set namespaces in your shell:
```bash
export VAULT_ADDR=https://vault.example.com
export VAULT_NAMESPACE=org/team/my-namespace
```

## Adding a bulk-action modal

1. Create `app/src/components/MyActionModal.vue` — follow the pattern of `KeyUpdateModal.vue`:
   - `onMounted` fetches all paths via `GET /api/kv/dump`
   - Filter by `includeProd` toggle using `pathIsProd()`
   - Preview changes before writing — show `ConfirmDiffModal` per path
   - Call `vault.writeSecret(path, data)` which bumps `lastWriteAt` and triggers admin refresh
2. Import and register it in `BrowserView.vue` alongside the other modals
3. Add a toolbar button in the `v-if="vault.editingEnabled"` actions block

## Adding a BFF route

All routes are in `server/index.mjs`. The pattern for a Vault-proxying route:

```js
app.post('/api/kv/my-action', async (req, res) => {
  if (!adminSettings.editingEnabled)
    return res.status(403).json({ error: 'Édition désactivée' })
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })

  const { path, mount = 'secret' } = req.body
  try {
    const result = await vaultFetch(`${mount}/data/${path}`, token, namespace, 'POST', { data })
    pushLog({ type: 'write', namespace, path, mount, before, after: data, success: true })
    res.status(result.status).json(result.body)
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})
```

## Code style

- Vue components use `<script setup lang="ts">` with no Options API
- Keep all shared state in `stores/vault.ts`; component-local state stays in the component
- No comments unless the *why* is non-obvious
- No new abstractions unless the same pattern appears three or more times
- Every write to Vault must go through the existing `pushLog()` mechanism so the audit trail stays complete
- Every destructive action needs a confirmation step (use `ConfirmDiffModal` or `DeleteConfirmModal`)

## Submitting changes

1. Fork the repository and create a branch from `main`
2. Make your changes and verify the build passes: `npm run build --prefix app`
3. Open a pull request with a clear description of what changed and why

## Releasing a new version

1. Update the version in `package.json`:
   ```bash
   npm version patch  # or minor/major
   ```

2. Create a git tag matching the version:
   ```bash
   git tag v$(node -p "require('./package.json').version")
   git push origin main --tags
   ```

3. The GitHub Actions workflow (`release.yml`) will automatically:
   - Build the frontend
   - Publish to npm
   - Create a GitHub release with changelog

The version tag **must match** the `package.json` version exactly (e.g., tag `v1.0.5` for version `1.0.5`).

## Reporting bugs

Please open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behaviour
- Browser and Node.js version

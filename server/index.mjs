import express from 'express'
import cors from 'cors'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'
import { get as httpsGet } from 'https'
import { randomUUID } from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.BFF_PORT || 3001

app.use(cors({ origin: /^http:\/\/localhost:\d+$/ }))
app.use(express.json())

// --- App config (persisted to ~/.vault-kv-ui/config.json) ---
const CONFIG_FILE = process.env.CONFIG_FILE || join(homedir(), '.vault-kv-ui', 'config.json')

const appConfig = {
  vaultAddr: process.env.VAULT_ADDR || '',
  namespaces: [],
  mount: 'secret',
}

function loadAppConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    if (raw.vaultAddr && !process.env.VAULT_ADDR) appConfig.vaultAddr = raw.vaultAddr
    if (Array.isArray(raw.namespaces)) appConfig.namespaces = raw.namespaces.map(n => ({ ...n, namespace: normalizeNs(n.namespace) }))
    if (raw.mount) appConfig.mount = raw.mount
    console.log(`[BFF] Config loaded ← ${CONFIG_FILE}`)
  } catch (e) {
    console.error('[BFF] Failed to load config:', e.message)
  }
}

function saveAppConfig() {
  try {
    const dir = CONFIG_FILE.substring(0, CONFIG_FILE.lastIndexOf('/'))
    if (dir) mkdirSync(dir, { recursive: true })
    writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf8')
  } catch (e) {
    console.error('[BFF] Failed to save config:', e.message)
  }
}

function getVaultAddr() {
  return process.env.VAULT_ADDR || appConfig.vaultAddr || 'https://vault.hashicorp.com'
}

// Vault namespaces must never end with a slash — vault CLI and some API calls reject them
function normalizeNs(ns) {
  return typeof ns === 'string' ? ns.replace(/\/+$/, '') : ns
}

loadAppConfig()

// Per-namespace token store (in-memory, lives until BFF restarts)
const tokenStore = new Map()

// --- Persistence ---
const LOGS_FILE = process.env.LOGS_FILE || join(homedir(), '.vault-kv-ui', 'audit-logs.json')
let lastSavedAt = null

function saveLogs() {
  try {
    const dir = LOGS_FILE.substring(0, LOGS_FILE.lastIndexOf('/'))
    if (dir) mkdirSync(dir, { recursive: true })
    writeFileSync(LOGS_FILE, JSON.stringify({ savedAt: new Date().toISOString(), logs: adminLogs }, null, 2), 'utf8')
    lastSavedAt = new Date().toISOString()
    console.log(`[BFF] Audit log saved → ${LOGS_FILE} (${adminLogs.length} entries)`)
  } catch (e) {
    console.error('[BFF] Failed to save audit log:', e.message)
  }
}

function loadLogs() {
  try {
    if (!existsSync(LOGS_FILE)) return
    const raw = JSON.parse(readFileSync(LOGS_FILE, 'utf8'))
    const entries = Array.isArray(raw) ? raw : (raw?.logs ?? [])
    adminLogs.push(...entries.slice(0, MAX_LOG_ENTRIES))
    lastSavedAt = raw?.savedAt ?? null
    logIdCounter = adminLogs.length
    console.log(`[BFF] Audit log loaded ← ${LOGS_FILE} (${adminLogs.length} entries)`)
  } catch (e) {
    console.error('[BFF] Failed to load audit log:', e.message)
  }
}

// --- Admin state ---
const MAX_LOG_ENTRIES = 1000
const adminLogs = []
let logIdCounter = 0
const adminSettings = { loggingEnabled: true, editingEnabled: true }
// Tracks namespaces whose first env/file token use has already been logged (prevents duplicates on every /status poll)
const loggedEnvSessions = new Set()

function pushLog(entry) {
  if (!adminSettings.loggingEnabled) return
  adminLogs.unshift({ id: `${Date.now()}-${++logIdCounter}`, ts: new Date().toISOString(), ...entry })
  if (adminLogs.length > MAX_LOG_ENTRIES) adminLogs.length = MAX_LOG_ENTRIES
}

// Load persisted logs on startup
loadLogs()

// Save on clean shutdown
process.on('SIGTERM', () => { saveLogs(); process.exit(0) })
process.on('SIGINT',  () => { saveLogs(); process.exit(0) })

function namespaceToEnvKey(ns) {
  return 'VAULT_TOKEN_' + ns.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
}

function resolveToken(namespace) {
  const ns = normalizeNs(namespace)
  // 1. In-memory store (set by /api/auth/login)
  if (ns && tokenStore.has(ns)) return tokenStore.get(ns)

  // 2. Namespace-specific env var
  if (ns) {
    const key = namespaceToEnvKey(ns)
    if (process.env[key]) return process.env[key]
  }

  // 3. Global env var
  if (process.env.VAULT_TOKEN) return process.env.VAULT_TOKEN

  // 4. ~/.env file (written by vault-admin CLI)
  const envFile = join(homedir(), '.env')
  if (existsSync(envFile)) {
    const lines = readFileSync(envFile, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^VAULT_TOKEN=(.+)$/)
      if (m) return m[1].trim()
    }
  }
  return null
}

function getNamespace(req) {
  return req.query.namespace ?? req.body?.namespace ?? process.env.VAULT_NAMESPACE ?? ''
}

async function vaultFetch(path, token, namespace, method = 'GET', body = null) {
  const url = `${getVaultAddr()}/v1/${path}`
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['X-Vault-Token'] = token
  if (namespace) headers['X-Vault-Namespace'] = namespace
  const options = { method, headers }
  if (body) options.body = JSON.stringify(body)
  const res = await fetch(url, options)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json }
}

// Pending OIDC login sessions: namespace → { process, authUrl, token, error, done }
const pendingLogins = new Map()

// --- Routes ---

// GET /api/status  → token info for a given namespace
app.get('/api/status', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  try {
    const result = await vaultFetch('auth/token/lookup-self', token, namespace)
    if (result.status !== 200) return res.status(result.status).json(result.body)
    const data = result.body.data
    // Log first env/file token use per namespace (OIDC logins are already logged via poll-login)
    const fromOidc = namespace && tokenStore.has(namespace)
    if (!fromOidc && !loggedEnvSessions.has(namespace)) {
      loggedEnvSessions.add(namespace)
      pushLog({ type: 'login_ok', namespace, display_name: data.display_name, success: true })
    }
    const creationTtl = data.creation_ttl || (data.expire_time && data.creation_time
      ? Math.round((new Date(data.expire_time).getTime() / 1000) - data.creation_time)
      : null)
    res.json({ display_name: data.display_name, expire_time: data.expire_time, ttl: data.ttl, policies: data.policies, accessor: data.accessor, creation_time: data.creation_time ?? null, creation_ttl: creationTtl, renewable: data.renewable ?? false, entity_id: data.entity_id ?? '' })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// POST /api/token/renew
app.post('/api/token/renew', async (req, res) => {
  const namespace = req.body?.namespace ?? ''
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  try {
    const result = await vaultFetch('auth/token/renew-self', token, namespace, 'PUT', {})
    if (result.status === 400) return res.status(400).json({ error: result.body.errors?.[0] ?? 'Token non renouvelable' })
    if (result.status !== 200) return res.status(result.status).json(result.body)
    const lookup = await vaultFetch('auth/token/lookup-self', token, namespace)
    if (lookup.status !== 200) return res.status(lookup.status).json(lookup.body)
    const data = lookup.body.data
    const creationTtl = data.creation_ttl || (data.expire_time && data.creation_time
      ? Math.round((new Date(data.expire_time).getTime() / 1000) - data.creation_time)
      : null)
    res.json({ display_name: data.display_name, expire_time: data.expire_time, ttl: data.ttl, policies: data.policies, accessor: data.accessor, creation_time: data.creation_time ?? null, creation_ttl: creationTtl, renewable: data.renewable ?? false, entity_id: data.entity_id ?? '' })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// GET /api/kv/list?path=&mount=&namespace=
app.get('/api/kv/list', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path, mount = 'secret' } = req.query
  if (path === undefined) return res.status(400).json({ error: 'path is required' })
  try {
    const vaultPath = path ? `${mount}/metadata/${path}?list=true` : `${mount}/metadata/?list=true`
    const result = await vaultFetch(vaultPath, token, namespace)
    if (result.status === 404) return res.json({ keys: [] })
    if (result.status !== 200) return res.status(result.status).json(result.body)
    res.json({ keys: result.body.data?.keys ?? [] })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// GET /api/kv/read?path=&mount=&namespace=
app.get('/api/kv/read', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path, mount = 'secret' } = req.query
  if (!path) return res.status(400).json({ error: 'path is required' })
  try {
    const result = await vaultFetch(`${mount}/data/${path}`, token, namespace)
    if (result.status !== 200) return res.status(result.status).json(result.body)
    res.json({ data: result.body.data?.data ?? {}, metadata: result.body.data?.metadata ?? {} })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// GET /api/kv/versions?path=&mount=&namespace=
app.get('/api/kv/versions', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path, mount = 'secret' } = req.query
  if (!path) return res.status(400).json({ error: 'path is required' })
  try {
    const result = await vaultFetch(`${mount}/metadata/${path}`, token, namespace)
    if (result.status !== 200) return res.status(result.status).json(result.body)
    const currentVersion = result.body.data?.current_version ?? 0
    const versionsMap = result.body.data?.versions ?? {}
    const versions = Object.entries(versionsMap)
      .map(([vNum, meta]) => ({
        version: parseInt(vNum, 10),
        created_time: meta.created_time ?? null,
        deletion_time: (meta.deletion_time && meta.deletion_time !== '0001-01-01T00:00:00Z') ? meta.deletion_time : null,
        destroyed: meta.destroyed ?? false,
        created_by: meta.created_by ?? null,
      }))
      .sort((a, b) => b.version - a.version)
    res.json({ current_version: currentVersion, versions })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// GET /api/kv/read-version?path=&version=&mount=&namespace=
app.get('/api/kv/read-version', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path, version, mount = 'secret' } = req.query
  if (!path) return res.status(400).json({ error: 'path is required' })
  const versionNum = parseInt(version, 10)
  if (!version || isNaN(versionNum) || versionNum < 1) return res.status(400).json({ error: 'version must be a positive integer' })
  try {
    const result = await vaultFetch(`${mount}/data/${path}?version=${versionNum}`, token, namespace)
    if (result.status !== 200) return res.status(result.status).json(result.body)
    res.json({ data: result.body.data?.data ?? {}, metadata: result.body.data?.metadata ?? {} })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// POST /api/kv/write  body: { path, mount, data, namespace }
app.post('/api/kv/write', async (req, res) => {
  if (!adminSettings.editingEnabled)
    return res.status(403).json({ error: 'Édition désactivée par l\'administrateur' })
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path, mount = 'secret', data } = req.body
  if (!path || !data) return res.status(400).json({ error: 'path and data are required' })

  // Pre-fetch existing secret to capture before-state for the audit log
  let before = {}
  try {
    const existing = await vaultFetch(`${mount}/data/${path}`, token, namespace)
    if (existing.status === 200) before = existing.body.data?.data ?? {}
  } catch {}

  try {
    const result = await vaultFetch(`${mount}/data/${path}`, token, namespace, 'POST', { data })
    const success = result.status >= 200 && result.status < 300
    pushLog({ type: 'write', namespace, path, mount, before, after: data, keysCount: Object.keys(data || {}).length, success, error: success ? undefined : result.body?.errors?.[0] })
    res.status(result.status).json(result.body)
  } catch (e) {
    pushLog({ type: 'write', namespace, path, mount, before, after: data, keysCount: 0, success: false, error: e.message })
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// POST /api/kv/delete  body: { path, mount, namespace }
app.post('/api/kv/delete', async (req, res) => {
  if (!adminSettings.editingEnabled)
    return res.status(403).json({ error: 'Édition désactivée par l\'administrateur' })
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path, mount = 'secret' } = req.body
  if (!path) return res.status(400).json({ error: 'path is required' })

  let before = {}
  try {
    const existing = await vaultFetch(`${mount}/data/${path}`, token, namespace)
    if (existing.status === 200) before = existing.body.data?.data ?? {}
  } catch {}

  try {
    const result = await vaultFetch(`${mount}/metadata/${path}`, token, namespace, 'DELETE')
    const success = result.status === 204 || result.status === 200
    pushLog({ type: 'delete', namespace, path, mount, before, after: {}, success, error: success ? undefined : (result.body?.errors?.[0] ?? `HTTP ${result.status}`) })
    if (success) return res.status(200).json({ ok: true })
    return res.status(result.status).json(result.body)
  } catch (e) {
    pushLog({ type: 'delete', namespace, path, mount, before, after: {}, success: false, error: e.message })
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// POST /api/kv/delete-folder  body: { path, mount, namespace }
// Recursively lists all secrets under path, reads their data, deletes each, logs one aggregate entry
app.post('/api/kv/delete-folder', async (req, res) => {
  if (!adminSettings.editingEnabled)
    return res.status(403).json({ error: 'Édition désactivée par l\'administrateur' })
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path, mount = 'secret' } = req.body
  if (!path) return res.status(400).json({ error: 'path is required' })

  async function listAll(cur) {
    const paths = []
    const vp = `${mount}/metadata/${cur}?list=true`
    let r
    try { r = await vaultFetch(vp, token, namespace) } catch { return paths }
    if (r.status !== 200) return paths
    for (const key of (r.body.data?.keys ?? [])) {
      const full = `${cur}/${key}`.replace(/\/+/g, '/')
      if (key.endsWith('/')) paths.push(...await listAll(full.replace(/\/$/, '')))
      else paths.push(full)
    }
    return paths
  }

  try {
    const allPaths = await listAll(path)
    const beforeMap = {}
    await Promise.all(allPaths.map(async (p) => {
      try {
        const r = await vaultFetch(`${mount}/data/${p}`, token, namespace)
        if (r.status === 200) beforeMap[p] = r.body.data?.data ?? {}
      } catch {}
    }))

    const errors = []
    for (const p of allPaths) {
      try {
        const r = await vaultFetch(`${mount}/metadata/${p}`, token, namespace, 'DELETE')
        if (r.status !== 204 && r.status !== 200) errors.push(`${p}: ${r.body?.errors?.[0] ?? r.status}`)
      } catch (e) { errors.push(`${p}: ${e.message}`) }
    }

    const success = errors.length === 0
    pushLog({ type: 'delete_folder', namespace, path, mount, before: beforeMap, after: {}, deletedCount: allPaths.length, deletedPaths: allPaths, success, error: errors.length ? errors.join('; ') : undefined })
    res.status(200).json({ ok: true, deleted: allPaths.length, errors: errors.length ? errors : undefined })
  } catch (e) {
    pushLog({ type: 'delete_folder', namespace, path, mount, before: {}, after: {}, deletedCount: 0, deletedPaths: [], success: false, error: e.message })
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// GET /api/kv/dump?path=&mount=&namespace=  → recursive dump
app.get('/api/kv/dump', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { path = '', mount = 'secret' } = req.query

  async function dumpPath(currentPath) {
    const result = {}
    const vaultListPath = currentPath
      ? `${mount}/metadata/${currentPath}?list=true`
      : `${mount}/metadata/?list=true`
    let listResult
    try { listResult = await vaultFetch(vaultListPath, token, namespace) } catch { return result }
    if (listResult.status !== 200) return result
    const keys = listResult.body.data?.keys ?? []
    for (const key of keys) {
      const fullKey = currentPath
        ? `${currentPath}/${key.replace(/\/$/, '')}`
        : key.replace(/\/$/, '')
      if (key.endsWith('/')) {
        Object.assign(result, await dumpPath(fullKey))
      } else {
        try {
          const r = await vaultFetch(`${mount}/data/${fullKey}`, token, namespace)
          if (r.status === 200) result[fullKey] = r.body.data?.data ?? {}
        } catch (_) {}
      }
    }
    return result
  }

  try {
    res.json(await dumpPath(path))
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// POST /api/kv/compare  body: { source_path, target_path, mount, namespace }
// Read-only diff — does not write anything.
// Returns { added, missing, changed, unchanged, target_data } where each bucket
// is an array of { key, source_value?, target_value? } and target_data is the
// full Record<string,string> of the target path (for ConfirmDiffModal before-state).
app.post('/api/kv/compare', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const { source_path, target_path, mount = 'secret' } = req.body
  if (!source_path || !target_path) return res.status(400).json({ error: 'source_path and target_path are required' })
  try {
    const [srcResult, tgtResult] = await Promise.all([
      vaultFetch(`${mount}/data/${source_path}`, token, namespace),
      vaultFetch(`${mount}/data/${target_path}`, token, namespace),
    ])
    if (srcResult.status === 404) return res.status(404).json({ error: 'Source path not found' })
    if (srcResult.status === 403) return res.status(403).json({ error: 'Access denied to source path' })
    if (srcResult.status !== 200) return res.status(502).json({ error: `Vault returned ${srcResult.status} for source path` })

    const sourceData = flattenSecretData(srcResult.body.data?.data ?? {})
    // 404 on target is OK — means all source keys are "added"
    const targetData = flattenSecretData((tgtResult.status === 200) ? (tgtResult.body.data?.data ?? {}) : {})
    if (tgtResult.status !== 200 && tgtResult.status !== 404) {
      return res.status(502).json({ error: `Vault returned ${tgtResult.status} for target path` })
    }

    const allKeys = new Set([...Object.keys(sourceData), ...Object.keys(targetData)])
    const added = []
    const missing = []
    const changed = []
    const unchanged = []

    for (const key of [...allKeys].sort()) {
      const inSource = Object.prototype.hasOwnProperty.call(sourceData, key)
      const inTarget = Object.prototype.hasOwnProperty.call(targetData, key)
      if (inSource && !inTarget) {
        added.push({ key, source_value: sourceData[key] })
      } else if (!inSource && inTarget) {
        missing.push({ key, target_value: targetData[key] })
      } else if (sourceData[key] !== targetData[key]) {
        changed.push({ key, source_value: sourceData[key], target_value: targetData[key] })
      } else {
        unchanged.push({ key, source_value: sourceData[key], target_value: targetData[key] })
      }
    }

    res.json({ source_path, target_path, added, missing, changed, unchanged, target_data: targetData })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// Mirrors SecretPanel's parseJsonValue: detects nested objects AND JSON strings
function flattenSecretData(obj, prefix = '') {
  const result = {}
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(result, flattenSecretData(v, fullKey))
    } else if (typeof v === 'string') {
      const trimmed = v.trim()
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed)
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.assign(result, flattenSecretData(parsed, fullKey))
            continue
          }
        } catch {}
      }
      result[fullKey] = v
    } else {
      result[fullKey] = String(v ?? '')
    }
  }
  return result
}

// GET /api/kv/search?q=&by=path|key|value&mount=&namespace=&limit=
app.get('/api/kv/search', async (req, res) => {
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })

  const { q = '', by = 'path', mount = 'secret', limit = '100', path: scopePath = '' } = req.query
  if (!q.trim()) return res.status(400).json({ error: 'q is required' })

  const maxResults = Math.min(parseInt(limit) || 100, 500)
  const query = q.toLowerCase()
  const start = Date.now()
  const results = []
  let scannedCount = 0

  async function searchPath(currentPath) {
    if (results.length >= maxResults) return
    const vaultListPath = currentPath
      ? `${mount}/metadata/${currentPath}?list=true`
      : `${mount}/metadata/?list=true`
    let listResult
    try { listResult = await vaultFetch(vaultListPath, token, namespace) } catch { return }
    if (listResult.status !== 200) return
    const keys = listResult.body.data?.keys ?? []
    for (const key of keys) {
      if (results.length >= maxResults) return
      const fullPath = currentPath
        ? `${currentPath}/${key.replace(/\/$/, '')}`
        : key.replace(/\/$/, '')
      if (key.endsWith('/')) {
        await searchPath(fullPath)
      } else {
        scannedCount++
        if (by === 'path') {
          if (fullPath.toLowerCase().includes(query)) {
            results.push({ path: fullPath, matchedIn: 'path', matchedKeys: [] })
          }
        } else {
          try {
            const r = await vaultFetch(`${mount}/data/${fullPath}`, token, namespace)
            if (r.status !== 200) continue
            const flat = flattenSecretData(r.body.data?.data ?? {})
            const matchedKeys = []
            const matchedValues = {}
            for (const [k, v] of Object.entries(flat)) {
              if (by === 'key' && k.toLowerCase().includes(query)) {
                matchedKeys.push(k)
                matchedValues[k] = v
              }
              if (by === 'value' && v.toLowerCase().includes(query)) {
                matchedKeys.push(k)
                matchedValues[k] = v
              }
            }
            if (matchedKeys.length > 0) {
              results.push({ path: fullPath, matchedIn: by, matchedKeys, matchedValues })
            }
          } catch (_) {}
        }
      }
    }
  }

  try {
    await searchPath(scopePath.replace(/\/$/, ''))
    res.json({ results, scannedCount, searchTimeMs: Date.now() - start })
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// POST /api/auth/start-login  body: { namespace }
// Native OIDC flow: calls Vault API for auth_url, starts a local HTTP callback server on :8250,
// and exchanges the code for a token automatically — no vault CLI required.
app.post('/api/auth/start-login', async (req, res) => {
  const { namespace: rawNs } = req.body
  if (!rawNs) return res.status(400).json({ error: 'namespace requis' })
  const namespace = normalizeNs(rawNs)

  // Close any existing pending session for this namespace (releases :8250)
  const existing = pendingLogins.get(namespace)
  if (existing && !existing.done) {
    try { existing.server?.close() } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  pendingLogins.delete(namespace)

  const CALLBACK_PORT = parseInt(process.env.OIDC_CALLBACK_PORT || '8250')
  const redirectUri = `http://localhost:${CALLBACK_PORT}/oidc/callback`
  const clientNonce = randomUUID()

  // Step 1 — ask Vault for the OIDC authorization URL
  let authUrl
  try {
    const r = await vaultFetch('auth/oidc/oidc/auth_url', null, namespace, 'PUT', {
      redirect_uri: redirectUri,
      client_nonce: clientNonce,
    })
    if (r.status !== 200) {
      const msg = r.body?.errors?.join(', ') || r.body?.error || `HTTP ${r.status}`
      return res.status(502).json({ error: `Vault OIDC: ${msg}` })
    }
    authUrl = r.body?.data?.auth_url
    if (!authUrl) return res.status(502).json({ error: 'Vault n\'a pas retourné d\'URL OIDC' })
  } catch (e) {
    return res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }

  const state = { server: null, authUrl, token: null, error: null, done: false, logged: false }
  pendingLogins.set(namespace, state)

  // Step 2 — start local callback server; OIDC provider will redirect here after auth
  const server = createServer(async (cbReq, cbRes) => {
    const url = new URL(cbReq.url, `http://localhost:${CALLBACK_PORT}`)
    if (url.pathname !== '/oidc/callback') { cbRes.writeHead(404); cbRes.end(); return }

    const code  = url.searchParams.get('code')
    const cbState = url.searchParams.get('state')
    const oidcError = url.searchParams.get('error')

    if (oidcError) {
      state.error = `OIDC: ${oidcError} — ${url.searchParams.get('error_description') || ''}`
      state.done  = true
      cbRes.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
      cbRes.end(`<html><body style="font-family:monospace;padding:2rem;background:#111;color:#f87171"><h2>⚠ Erreur d'authentification</h2><p>${state.error}</p><p>Fermez cet onglet.</p></body></html>`)
      server.close()
      return
    }

    if (!code || !cbState) { cbRes.writeHead(400); cbRes.end('Missing code or state'); return }

    // Step 3 — exchange the code for a Vault token
    try {
      const r = await vaultFetch(
        `auth/oidc/oidc/callback?state=${encodeURIComponent(cbState)}&code=${encodeURIComponent(code)}&client_nonce=${encodeURIComponent(clientNonce)}`,
        null, namespace
      )
      if (r.status === 200 && r.body?.auth?.client_token) {
        state.token = r.body.auth.client_token
        state.done  = true
        tokenStore.set(namespace, state.token)
        cbRes.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        cbRes.end('<html><body style="font-family:monospace;padding:2rem;background:#111;color:#4ade80"><h2>✓ Authentifié</h2><p>Token obtenu. Vous pouvez fermer cet onglet.</p></body></html>')
      } else {
        state.error = r.body?.errors?.join(', ') || `Vault callback HTTP ${r.status}`
        state.done  = true
        cbRes.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        cbRes.end(`<html><body style="font-family:monospace;padding:2rem"><h2>⚠ Erreur</h2><p>${state.error}</p></body></html>`)
      }
    } catch (e) {
      state.error = e.message
      state.done  = true
      cbRes.writeHead(500); cbRes.end('Internal error: ' + e.message)
    }

    server.close()
    setTimeout(() => { if (pendingLogins.get(namespace) === state) pendingLogins.delete(namespace) }, 600000)
  })

  state.server = server
  server.on('error', err => {
    state.error = `Impossible de démarrer le serveur callback (:${CALLBACK_PORT}): ${err.message}`
    state.done  = true
    if (pendingLogins.get(namespace) === state) pendingLogins.delete(namespace)
  })
  server.listen(CALLBACK_PORT, 'localhost')

  res.json({ authUrl })
})

// GET /api/auth/poll-login?namespace=
// Returns { status: 'pending' | 'done' | 'error' | 'idle', tokenStatus?, error? }
app.get('/api/auth/poll-login', async (req, res) => {
  const namespace = normalizeNs(req.query.namespace)
  const state = pendingLogins.get(namespace)
  if (!state) return res.json({ status: 'idle' })
  if (!state.done) return res.json({ status: 'pending' })

  if (state.error) {
    if (!state.logged) { state.logged = true; pushLog({ type: 'login_fail', namespace, error: state.error, success: false }) }
    return res.json({ status: 'error', error: state.error })
  }

  try {
    const result = await vaultFetch('auth/token/lookup-self', state.token, namespace)
    if (result.status !== 200) {
      if (!state.logged) { state.logged = true; pushLog({ type: 'login_fail', namespace, error: 'Token invalide après login', success: false }) }
      return res.json({ status: 'error', error: 'Token invalide après login' })
    }
    const data = result.body.data
    if (!state.logged) {
      state.logged = true
      loggedEnvSessions.delete(namespace) // allow re-logging if they later use env token again
      pushLog({ type: 'login_ok', namespace, display_name: data.display_name, success: true })
    }
    res.json({
      status: 'done',
      tokenStatus: { display_name: data.display_name, expire_time: data.expire_time, ttl: data.ttl, policies: data.policies },
    })
  } catch (e) {
    res.json({ status: 'error', error: e.message })
  }
})

// POST /api/auth/set-token  body: { token, namespace }
// Stores a Vault token manually — fallback when OIDC is unavailable or misconfigured.
app.post('/api/auth/set-token', async (req, res) => {
  const { token, namespace: rawNs } = req.body
  if (!token) return res.status(400).json({ error: 'token requis' })
  const namespace = normalizeNs(rawNs ?? '')
  tokenStore.set(namespace, token)
  try {
    const result = await vaultFetch('auth/token/lookup-self', token, namespace)
    if (result.status !== 200) {
      tokenStore.delete(namespace)
      return res.status(401).json({ error: 'Token invalide ou expiré' })
    }
    const data = result.body?.data ?? {}
    loggedEnvSessions.delete(namespace)
    pushLog({ type: 'login_ok', namespace, display_name: data.display_name, success: true })
    res.json({
      ok: true,
      tokenStatus: { display_name: data.display_name, expire_time: data.expire_time, ttl: data.ttl, policies: data.policies },
    })
  } catch (e) {
    tokenStore.delete(namespace)
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// --- Admin routes ---

// Effective Vault addr without the generic fallback — used for config display
// so the frontend can detect "not yet configured" vs "has a real URL".
function effectiveVaultAddr() {
  return process.env.VAULT_ADDR || appConfig.vaultAddr || ''
}

// GET /api/config  → current app configuration
app.get('/api/config', (req, res) => {
  const addr = effectiveVaultAddr()
  res.json({
    vaultAddr: addr,
    namespaces: appConfig.namespaces,
    mount: appConfig.mount,
    configured: !!addr,
  })
})

// POST /api/config  body: { vaultAddr?, namespaces?, mount? }
app.post('/api/config', (req, res) => {
  const { vaultAddr, namespaces, mount } = req.body
  if (vaultAddr !== undefined) appConfig.vaultAddr = vaultAddr
  if (Array.isArray(namespaces)) appConfig.namespaces = namespaces.map(n => ({ ...n, namespace: normalizeNs(n.namespace) }))
  if (mount !== undefined) appConfig.mount = mount
  saveAppConfig()
  const addr = effectiveVaultAddr()
  res.json({
    ok: true,
    vaultAddr: addr,
    namespaces: appConfig.namespaces,
    mount: appConfig.mount,
    configured: !!addr,
  })
})

app.get('/api/version', (req, res) => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    res.json({ version: pkg.version })
  } catch {
    res.json({ version: 'unknown' })
  }
})

function semverGt(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false
  }
  return false
}

function fetchNpmLatest() {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      'https://registry.npmjs.org/vault-admin/latest',
      { headers: { Accept: 'application/json' }, rejectUnauthorized: false, timeout: 6000 },
      (r) => {
        let body = ''
        r.on('data', chunk => { body += chunk })
        r.on('end', () => {
          try { resolve(JSON.parse(body).version ?? null) } catch { reject(new Error('parse')) }
        })
      }
    )
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    req.on('error', reject)
  })
}

let _updateCache = null
let _updateCachedAt = 0
const UPDATE_CACHE_TTL = 3600_000

async function resolveUpdateCheck(current) {
  const now = Date.now()
  if (_updateCache && now - _updateCachedAt < UPDATE_CACHE_TTL) {
    return { current, ..._updateCache }
  }
  const latest = await fetchNpmLatest()
  const hasUpdate = current !== 'unknown' && !!latest && semverGt(latest, current)
  _updateCache = { latest, hasUpdate }
  _updateCachedAt = now
  return { current, latest, hasUpdate }
}

app.get('/api/version/check', async (req, res) => {
  let current = 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    current = pkg.version ?? 'unknown'
  } catch {}
  try {
    res.json(await resolveUpdateCheck(current))
  } catch {
    res.json({ current, latest: null, hasUpdate: false })
  }
})

app.post('/api/auth/logout', (req, res) => {
  const token = resolveToken(getNamespace(req))
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  // Clear all tokens from in-memory store
  tokenStore.clear()
  // Clear all config
  appConfig.vaultAddr = ''
  appConfig.namespaces = []
  appConfig.mount = 'secret'
  saveAppConfig()
  res.json({ ok: true })
})

app.get('/api/admin/settings', (req, res) => {
  res.json({ ...adminSettings })
})

app.post('/api/admin/settings', (req, res) => {
  const { loggingEnabled, editingEnabled } = req.body
  if (typeof loggingEnabled === 'boolean') adminSettings.loggingEnabled = loggingEnabled
  if (typeof editingEnabled === 'boolean') adminSettings.editingEnabled = editingEnabled
  res.json({ ...adminSettings })
})

app.get('/api/admin/logs', (req, res) => {
  const token = resolveToken(getNamespace(req))
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000)
  res.json(adminLogs.slice(0, limit))
})

app.delete('/api/admin/logs/:id', (req, res) => {
  const idx = adminLogs.findIndex(l => l.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Log not found' })
  adminLogs.splice(idx, 1)
  res.json({ ok: true })
})

app.get('/api/admin/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  res.json({
    totalWrites: adminLogs.filter(l => l.type === 'write').length,
    writesToday: adminLogs.filter(l => l.type === 'write' && l.ts.startsWith(today)).length,
    totalLogins: adminLogs.filter(l => l.type === 'login_ok').length,
    totalLoginFails: adminLogs.filter(l => l.type === 'login_fail').length,
    logsCount: adminLogs.length,
    editingEnabled: adminSettings.editingEnabled,
    loggingEnabled: adminSettings.loggingEnabled,
  })
})

// POST /api/admin/save-logs  → persist current log to file immediately
app.post('/api/admin/save-logs', (req, res) => {
  saveLogs()
  res.json({ savedAt: lastSavedAt, count: adminLogs.length, file: LOGS_FILE })
})

// GET /api/admin/save-status  → last save metadata
app.get('/api/admin/save-status', (req, res) => {
  res.json({ lastSavedAt, count: adminLogs.length, file: LOGS_FILE })
})

// POST /api/admin/export-vault  body: { path, mount, namespace }
// Writes a snapshot of current logs as a Vault KV secret — one readable key per entry
app.post('/api/admin/export-vault', async (req, res) => {
  const { path, mount = 'secret' } = req.body
  if (!path) return res.status(400).json({ error: 'path requis' })
  const namespace = getNamespace(req)
  const token = resolveToken(namespace)
  if (!token) return res.status(401).json({ error: 'No Vault token found' })
  try {
    const MAX_EXPORT = 200
    const toExport = adminLogs.slice(0, MAX_EXPORT)

    // Metadata keys
    const data = {
      exported_at: new Date().toISOString(),
      session_entries: String(adminLogs.length),
      exported_entries: String(toExport.length),
    }

    // One summary key per log entry + diff/rollback keys for writes
    toExport.forEach((entry, i) => {
      const idx = String(i + 1).padStart(3, '0')
      const nsShort = entry.namespace ? (entry.namespace.split('/').pop() ?? entry.namespace) : '—'
      const date = entry.ts.slice(0, 16).replace('T', ' ')

      let value = `${date} [${nsShort}]`
      if (entry.type === 'write') {
        const before = entry.before ?? {}
        const after  = entry.after  ?? {}
        const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
        let added = 0, removed = 0, modified = 0
        const diffLines = []
        for (const k of allKeys) {
          if (!(k in before)) { added++;    diffLines.push(`+ ${k}: "${after[k]}"`) }
          else if (!(k in after)) { removed++; diffLines.push(`- ${k}: "${before[k]}"`) }
          else if (before[k] !== after[k]) { modified++; diffLines.push(`~ ${k}: "${before[k]}" → "${after[k]}"`) }
        }
        const parts = []
        if (added)    parts.push(`+${added}`)
        if (modified) parts.push(`~${modified}`)
        if (removed)  parts.push(`-${removed}`)
        const summary = parts.length ? ` (${parts.join(' ')})` : ''
        value += ` ${entry.path}${summary} — ${entry.success ? '✓' : `✗ ${entry.error ?? ''}`}`
        data[`${idx}_write`] = value
        if (diffLines.length) {
          data[`${idx}_write_diff`] = `${entry.path}\n${diffLines.join('\n')}`
        }
        if (Object.keys(before).length) {
          data[`${idx}_write_rollback`] = JSON.stringify(before)
        }
      } else if (entry.type === 'delete') {
        const before = entry.before ?? {}
        const removedKeys = Object.keys(before)
        const summary = removedKeys.length ? ` (-${removedKeys.length})` : ''
        value += ` ${entry.path}${summary} — ${entry.success ? 'supprimé ✓' : `✗ ${entry.error ?? ''}`}`
        data[`${idx}_delete`] = value
        if (removedKeys.length) {
          const diffLines = removedKeys.sort().map(k => `- ${k}: "${before[k]}"`)
          data[`${idx}_delete_diff`] = `${entry.path}\n${diffLines.join('\n')}`
          data[`${idx}_delete_rollback`] = JSON.stringify(before)
        }
      } else if (entry.type === 'delete_folder') {
        const count = entry.deletedCount ?? 0
        value += ` ${entry.path}/ — ${count} secret(s) supprimé(s) ${entry.success ? '✓' : `✗ ${entry.error ?? ''}`}`
        data[`${idx}_delete_folder`] = value
        if (entry.deletedPaths?.length) {
          data[`${idx}_delete_folder_paths`] = entry.deletedPaths.join('\n')
        }
        if (entry.before && Object.keys(entry.before).length) {
          data[`${idx}_delete_folder_data`] = JSON.stringify(entry.before)
        }
      } else {
        if (entry.type === 'login_ok') {
          value += ` ${entry.display_name ?? '?'} — connexion réussie`
        } else if (entry.type === 'login_fail') {
          value += ` ÉCHEC: ${entry.error ?? '?'}`
        }
        data[`${idx}_${entry.type}`] = value
      }
    })

    const result = await vaultFetch(`${mount}/data/${path}`, token, namespace, 'POST', { data })
    res.status(result.status).json(result.body)
  } catch (e) {
    res.status(502).json({ error: `Vault injoignable: ${e.message}` })
  }
})

// --- Static frontend serving (production mode) ---
const distDir = join(__dirname, '..', 'app', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res) => {
    res.sendFile('index.html', { root: distDir })
  })
} else {
  console.warn('[BFF] app/dist/ not found — frontend will not be served')
  console.warn('[BFF] Run: npm run build --prefix app')
}

// Catch-all error handler — ensures the BFF always returns JSON, never an empty body
app.use((err, req, res, _next) => {
  console.error('[BFF] Unhandled error:', err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

app.listen(PORT, async () => {
  console.log(`[BFF] Vault Admin running on http://localhost:${PORT}`)
  let current = 'unknown'
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    current = pkg.version ?? 'unknown'
  } catch {}
  try {
    const { latest, hasUpdate } = await resolveUpdateCheck(current)
    if (hasUpdate) {
      console.log()
      console.log('\x1b[33m  ┌─────────────────────────────────────────────┐\x1b[0m')
      console.log(`\x1b[33m  │  ↑ Update available: v${current} → v${latest}\x1b[0m`)
      console.log('\x1b[33m  │  npm install -g vault-admin@latest\x1b[0m')
      console.log('\x1b[33m  └─────────────────────────────────────────────┘\x1b[0m')
      console.log()
    }
  } catch {}
})

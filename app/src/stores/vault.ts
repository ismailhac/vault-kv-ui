import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface TokenStatus {
  display_name: string
  expire_time: string | null
  ttl: number
  policies: string[]
}

export interface KvEntry {
  key: string
  isFolder: boolean
}

export interface NamespaceOption {
  id: string
  label: string
  namespace: string
}

export interface VersionMeta {
  version: number
  created_time: string | null
  deletion_time: string | null
  destroyed: boolean
  created_by: string | null
}

export const useVaultStore = defineStore('vault', () => {
  // --- App config (loaded from BFF) ---
  const namespaces = ref<NamespaceOption[]>([])
  const vaultAddr = ref('')
  const appVersion = ref('')
  const isConfigured = computed(() => !!vaultAddr.value)
  const showSetupStep = ref(false)

  // --- Namespace ---
  const currentNamespace = ref('')
  const showLoginModal = ref(false)

  // --- Token ---
  const tokenStatus = ref<TokenStatus | null>(null)
  const tokenError = ref<string | null>(null)
  const tokenLoading = ref(false)

  // --- Navigation ---
  const currentMount = ref('secret')
  const currentPath = ref('')
  const pathHistory = ref<string[]>([])

  // --- Entries ---
  const entries = ref<KvEntry[]>([])
  const listLoading = ref(false)
  const listError = ref<string | null>(null)

  // --- Selected secret ---
  const selectedSecret = ref<{ path: string; data: Record<string, string>; metadata: Record<string, unknown> } | null>(null)
  const secretLoading = ref(false)
  const secretError = ref<string | null>(null)

  // --- Search ---
  const searchResults = ref<{ path: string; matchedIn: string; matchedKeys: string[] }[]>([])
  const searchLoading = ref(false)
  const searchError = ref<string | null>(null)
  let searchRequestSeq = 0

  // --- Version history ---
  const versionList = ref<VersionMeta[]>([])
  const versionCurrentVersion = ref(0)
  const versionLoading = ref(false)
  const versionError = ref<string | null>(null)
  let fetchVersionsSeq = 0

  // --- Admin settings ---
  const editingEnabled = ref(true)
  const loggingEnabled = ref(true)

  async function loadAdminSettings() {
    try {
      const res = await fetch('/api/admin/settings')
      if (res.ok) {
        const s = await res.json()
        editingEnabled.value = s.editingEnabled ?? true
        loggingEnabled.value = s.loggingEnabled ?? true
      }
    } catch {}
  }

  // --- Init ---
  const initStatus = ref<'loading' | 'success' | 'error'>('loading')
  const initError = ref<string | null>(null)
  const isInitialized = ref(false)
  let readSecretRequestSeq = 0

  // --- Computed ---
  const isAuthenticated = computed(() => tokenStatus.value !== null)
  const currentNamespaceLabel = computed(
    () => namespaces.value.find(n => n.namespace === currentNamespace.value)?.label ?? currentNamespace.value
  )
  const ttlLabel = computed(() => {
    if (!tokenStatus.value) return ''
    const t = tokenStatus.value.ttl
    if (t <= 0) return 'expiré'
    const h = Math.floor(t / 3600)
    const m = Math.floor((t % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  })
  const breadcrumbs = computed(() => {
    if (!currentPath.value) return []
    return currentPath.value.split('/').filter(Boolean)
  })

  // --- Actions ---

  async function loadAppConfig() {
    try {
      const res = await fetch('/api/config')
      if (!res.ok) return
      const c = await res.json()
      vaultAddr.value = c.vaultAddr ?? ''
      if (Array.isArray(c.namespaces)) namespaces.value = c.namespaces
      if (c.mount) currentMount.value = c.mount
      try {
        const saved = localStorage.getItem('vault-namespace')
        const match = namespaces.value.find(n => n.namespace === saved)
        currentNamespace.value = match ? match.namespace : (namespaces.value[0]?.namespace ?? '')
      } catch {
        currentNamespace.value = namespaces.value[0]?.namespace ?? ''
      }
    } catch {}
    // Load app version
    try {
      const vres = await fetch('/api/version')
      if (vres.ok) {
        const v = await vres.json()
        appVersion.value = v.version ?? ''
      }
    } catch {}
  }

  async function saveAppConfig(cfg: { vaultAddr?: string; namespaces?: NamespaceOption[]; mount?: string }) {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    if (!res.ok) { const err = await res.json(); throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`) }
    const c = await res.json()
    vaultAddr.value = c.vaultAddr ?? ''
    if (Array.isArray(c.namespaces)) namespaces.value = c.namespaces
    if (c.mount) currentMount.value = c.mount
    return c
  }

  async function loadTokenStatus() {
    tokenLoading.value = true
    tokenError.value = null
    try {
      const params = new URLSearchParams({ namespace: currentNamespace.value })
      const res = await fetch(`/api/status?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        tokenError.value = (err as { error?: string }).error ?? `HTTP ${res.status}`
        tokenStatus.value = null
      } else {
        tokenStatus.value = await res.json()
      }
    } catch (e: unknown) {
      tokenError.value = e instanceof Error ? e.message : 'Network error'
    } finally {
      tokenLoading.value = false
    }
  }

  async function startLogin(namespace?: string): Promise<{ authUrl: string }> {
    const ns = namespace ?? currentNamespace.value
    const res = await fetch('/api/auth/start-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ namespace: ns }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
    return json as { authUrl: string }
  }

  async function pollLogin(namespace?: string): Promise<{ status: string; tokenStatus?: TokenStatus; error?: string }> {
    const ns = namespace ?? currentNamespace.value
    const params = new URLSearchParams({ namespace: ns })
    const res = await fetch(`/api/auth/poll-login?${params}`)
    return res.json()
  }

  async function setToken(token: string, namespace?: string): Promise<void> {
    const ns = namespace ?? currentNamespace.value
    const res = await fetch('/api/auth/set-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, namespace: ns }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
    const data = json as { tokenStatus?: TokenStatus }
    if (data.tokenStatus) {
      currentNamespace.value = ns
      try { localStorage.setItem('vault-namespace', ns) } catch {}
      tokenStatus.value = data.tokenStatus
      tokenError.value = null
    }
  }

  async function switchNamespace(namespace: string) {
    // Persist audit log before leaving the current namespace session
    try { await fetch('/api/admin/save-logs', { method: 'POST' }) } catch {}
    currentNamespace.value = namespace
    try { localStorage.setItem('vault-namespace', namespace) } catch (_) {}
    // Reset navigation
    currentPath.value = ''
    pathHistory.value = []
    entries.value = []
    selectedSecret.value = null
    secretError.value = null
    tokenStatus.value = null
    // Check token for the new namespace
    await loadTokenStatus()
    if (tokenError.value) {
      tokenError.value = null
      showLoginModal.value = true
    } else {
      await listPath('')
    }
  }

  async function listPath(path: string = currentPath.value) {
    listLoading.value = true
    listError.value = null
    entries.value = []
    selectedSecret.value = null
    secretError.value = null
    try {
      const params = new URLSearchParams({ path, mount: currentMount.value, namespace: currentNamespace.value })
      const res = await fetch(`/api/kv/list?${params}`)
      if (!res.ok) {
        const err = await res.json()
        listError.value = err.error ?? `HTTP ${res.status}`
      } else {
        const json = await res.json()
        entries.value = (json.keys as string[]).map((k: string) => ({
          key: k,
          isFolder: k.endsWith('/'),
        }))
      }
    } catch (e: unknown) {
      listError.value = e instanceof Error ? e.message : 'Network error'
    } finally {
      listLoading.value = false
    }
  }

  function navigateTo(segment: string) {
    pathHistory.value.push(currentPath.value)
    currentPath.value = currentPath.value
      ? `${currentPath.value}/${segment.replace(/\/$/, '')}`
      : segment.replace(/\/$/, '')
    listPath(currentPath.value)
  }

  function navigateBack() {
    if (pathHistory.value.length === 0) return
    currentPath.value = pathHistory.value.pop() ?? ''
    listPath(currentPath.value)
  }

  function navigateToBreadcrumb(index: number) {
    const parts = currentPath.value.split('/').filter(Boolean)
    currentPath.value = parts.slice(0, index + 1).join('/')
    pathHistory.value = []
    listPath(currentPath.value)
  }

  async function readSecret(path: string) {
    const requestId = ++readSecretRequestSeq
    secretLoading.value = true
    secretError.value = null
    selectedSecret.value = null
    try {
      const params = new URLSearchParams({ path, mount: currentMount.value, namespace: currentNamespace.value })
      const res = await fetch(`/api/kv/read?${params}`)
      if (requestId !== readSecretRequestSeq) return
      if (!res.ok) {
        const err = await res.json()
        secretError.value = err.error ?? `HTTP ${res.status}`
      } else {
        const json = await res.json()
        selectedSecret.value = { path, data: json.data, metadata: json.metadata }
      }
    } catch (e: unknown) {
      if (requestId !== readSecretRequestSeq) return
      secretError.value = e instanceof Error ? e.message : 'Network error'
    } finally {
      if (requestId === readSecretRequestSeq) {
        secretLoading.value = false
      }
    }
  }

  // Bumped after every successful write — lets AdminView auto-refresh without polling
  const lastWriteAt = ref(0)

  async function deleteSecret(path: string) {
    const res = await fetch('/api/kv/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mount: currentMount.value, namespace: currentNamespace.value }),
    })
    if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? `HTTP ${res.status}`) }
    lastWriteAt.value = Date.now()
    return res.json()
  }

  async function deleteFolder(path: string) {
    const res = await fetch('/api/kv/delete-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mount: currentMount.value, namespace: currentNamespace.value }),
    })
    if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? `HTTP ${res.status}`) }
    lastWriteAt.value = Date.now()
    return res.json()
  }

  async function writeSecret(path: string, data: Record<string, string>) {
    const res = await fetch('/api/kv/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, mount: currentMount.value, data, namespace: currentNamespace.value }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? `HTTP ${res.status}`)
    }
    lastWriteAt.value = Date.now()
    return res.json()
  }

  async function fetchVersions(path: string) {
    const requestId = ++fetchVersionsSeq
    versionLoading.value = true
    versionError.value = null
    versionList.value = []
    versionCurrentVersion.value = 0
    try {
      const params = new URLSearchParams({ path, mount: currentMount.value, namespace: currentNamespace.value })
      const res = await fetch(`/api/kv/versions?${params}`)
      if (requestId !== fetchVersionsSeq) return
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        versionError.value = (err as { error?: string }).error ?? `HTTP ${res.status}`
      } else {
        const json = await res.json()
        versionList.value = json.versions ?? []
        versionCurrentVersion.value = json.current_version ?? 0
      }
    } catch (e: unknown) {
      if (requestId !== fetchVersionsSeq) return
      versionError.value = e instanceof Error ? e.message : 'Network error'
    } finally {
      if (requestId === fetchVersionsSeq) versionLoading.value = false
    }
  }

  async function readSecretVersion(path: string, version: number): Promise<Record<string, string>> {
    const params = new URLSearchParams({ path, version: String(version), mount: currentMount.value, namespace: currentNamespace.value })
    const res = await fetch(`/api/kv/read-version?${params}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    const json = await res.json()
    return json.data ?? {}
  }

  async function initializeApp() {
    initStatus.value = 'loading'
    initError.value = null
    isInitialized.value = false
    showLoginModal.value = false

    try {
      await loadAppConfig()

      if (!isConfigured.value) {
        // No Vault URL configured yet — show landing page with setup button
        isInitialized.value = true
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 1500))
      await loadTokenStatus()

      if (!tokenStatus.value || tokenStatus.value.ttl <= 0) {
        tokenError.value = null
        isInitialized.value = true
        return
      }

      initStatus.value = 'success'
      await loadAdminSettings()
      await new Promise((resolve) => setTimeout(resolve, 2000))
      isInitialized.value = true
      await listPath('')
    } catch (e: unknown) {
      initStatus.value = 'error'
      initError.value = e instanceof Error ? e.message : 'Erreur d\'authentification'
    }
  }

  async function retryInitialization() {
    await initializeApp()
  }

  async function searchSecrets(query: string, by: 'path' | 'key' = 'path') {
    const requestId = ++searchRequestSeq
    searchLoading.value = true
    searchError.value = null
    searchResults.value = []
    try {
      const params = new URLSearchParams({
        q: query,
        by,
        mount: currentMount.value,
        namespace: currentNamespace.value,
      })
      const res = await fetch(`/api/kv/search?${params}`)
      if (requestId !== searchRequestSeq) return
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        searchError.value = (err as { error?: string }).error ?? `HTTP ${res.status}`
      } else {
        const json = await res.json()
        searchResults.value = json.results ?? []
      }
    } catch (e: unknown) {
      if (requestId !== searchRequestSeq) return
      searchError.value = e instanceof Error ? e.message : 'Network error'
    } finally {
      if (requestId === searchRequestSeq) searchLoading.value = false
    }
  }

  function goHome() {
    readSecretRequestSeq += 1
    currentPath.value = ''
    pathHistory.value = []
    listError.value = null
    selectedSecret.value = null
    secretError.value = null
    secretLoading.value = false
    listPath('')
  }

  async function logout() {
    try {
      // Clear token and config on BFF
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {}
    // Clear local state
    tokenStatus.value = null
    tokenError.value = null
    vaultAddr.value = ''
    namespaces.value = []
    currentNamespace.value = ''
    currentPath.value = ''
    pathHistory.value = []
    entries.value = []
    selectedSecret.value = null
    listError.value = null
    secretError.value = null
    showLoginModal.value = false
    showSetupStep.value = false
    try { localStorage.removeItem('vault-namespace') } catch {}
  }

  return {
    // config
    namespaces, vaultAddr, appVersion, isConfigured, showSetupStep,
    loadAppConfig, saveAppConfig,
    // namespace
    currentNamespace, showLoginModal, currentNamespaceLabel,
    // token
    tokenStatus, tokenError, tokenLoading,
    // navigation
    currentMount, currentPath, pathHistory,
    // entries
    entries, listLoading, listError,
    // secret
    selectedSecret, secretLoading, secretError,
    // init
    initStatus, initError, isInitialized,
    // computed
    isAuthenticated, ttlLabel, breadcrumbs,
    // admin
    editingEnabled, loggingEnabled, loadAdminSettings, lastWriteAt,
    // actions
    loadTokenStatus, startLogin, pollLogin, setToken, switchNamespace,
    listPath, navigateTo, navigateBack, navigateToBreadcrumb,
    readSecret, writeSecret, deleteSecret, deleteFolder,
    initializeApp, retryInitialization, goHome, logout,
    // search
    searchResults, searchLoading, searchError, searchSecrets,
    // version history
    versionList, versionCurrentVersion, versionLoading, versionError,
    fetchVersions, readSecretVersion,
  }
})

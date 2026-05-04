<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useVaultStore } from '../stores/vault'

const vault = useVaultStore()
const router = useRouter()

// Redirect unauthenticated users away from the admin page
watch(() => vault.isAuthenticated, (auth) => { if (!auth) router.replace('/') }, { immediate: true })

type LogEntry = {
  id: string
  ts: string
  type: 'write' | 'login_ok' | 'login_fail' | 'delete' | 'delete_folder'
  namespace: string
  path?: string
  mount?: string
  display_name?: string
  keysCount?: number
  before?: Record<string, string> | Record<string, Record<string, string>>
  after?: Record<string, string>
  deletedPaths?: string[]
  deletedCount?: number
  success: boolean
  error?: string
}

type Stats = {
  totalWrites: number
  writesToday: number
  totalLogins: number
  totalLoginFails: number
  logsCount: number
  editingEnabled: boolean
  loggingEnabled: boolean
}

const logs = ref<LogEntry[]>([])
const stats = ref<Stats | null>(null)
const loading = ref(true)
const refreshing = ref(false)
const loggingOut = ref(false)
const activeTab = ref<'all' | 'writes' | 'logins'>('all')
const settingsSaving = ref(false)

const localSettings = ref({ loggingEnabled: true, editingEnabled: true })

// Configuration editing
const showConfigEdit = ref(false)
const editOrg = ref('')
const editMount = ref('secret')
const editNamespaces = ref<Array<{ label: string; namespace: string }>>([])
const configSaving = ref(false)
const configError = ref<string | null>(null)

// Confirmation dialog
const showConfirmDialog = ref(false)
const confirmAction = ref<{ type: 'delete' | 'logout'; namespace: string; label: string } | null>(null)
const confirmLoading = ref(false)

type Feedback = { key: string; message: string; ok: boolean }
const feedback = ref<Feedback | null>(null)
let feedbackTimer: ReturnType<typeof setTimeout> | null = null

function showFeedback(key: string, enabled: boolean) {
  if (feedbackTimer) clearTimeout(feedbackTimer)
  const labels: Record<string, [string, string]> = {
    editingEnabled: ['Édition activée', 'Mode lecture seule activé — toutes les écritures sont bloquées'],
    loggingEnabled: ['Journalisation activée', 'Journalisation désactivée'],
  }
  const [onMsg, offMsg] = labels[key] ?? ['Activé', 'Désactivé']
  feedback.value = { key, message: enabled ? onMsg : offMsg, ok: enabled }
  feedbackTimer = setTimeout(() => { feedback.value = null }, 2500)
}

const selectedLog = ref<LogEntry | null>(null)
const restoring = ref(false)
const restoreError = ref<string | null>(null)
const restoreSuccess = ref(false)

async function restoreEntry(entry: LogEntry) {
  restoring.value = true
  restoreError.value = null
  restoreSuccess.value = false
  try {
    if (entry.type === 'delete_folder') {
      const beforeMap = entry.before as Record<string, Record<string, string>>
      for (const [p, data] of Object.entries(beforeMap)) {
        const res = await fetch('/api/kv/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p, mount: entry.mount ?? 'secret', data, namespace: entry.namespace }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      }
    } else {
      const before = flatBefore(entry)
      if (!Object.keys(before).length) throw new Error('Aucun état précédent disponible')
      const res = await fetch('/api/kv/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: entry.path, mount: entry.mount ?? 'secret', data: before, namespace: entry.namespace }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    }
    restoreSuccess.value = true
    setTimeout(() => { restoreSuccess.value = false; selectedLog.value = null; fetchAll(true) }, 1500)
  } catch (e: unknown) {
    restoreError.value = e instanceof Error ? e.message : 'Erreur lors de la restauration'
  }
  restoring.value = false
}

async function deleteLogEntry(id: string) {
  await fetch(`/api/admin/logs/${id}`, { method: 'DELETE' })
  logs.value = logs.value.filter(l => l.id !== id)
  if (selectedLog.value?.id === id) selectedLog.value = null
}

function downloadLogsLocally() {
  const ns = vault.currentNamespace
  const nsLabel = vault.currentNamespaceLabel
  const payload = {
    exported_at: new Date().toISOString(),
    namespace: ns,
    entries: nsScopedLogs.value,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const d = new Date()
  const slug = `${String(d.getDate()).padStart(2,'0')}${String(d.getMonth()+1).padStart(2,'0')}${d.getFullYear()}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`
  a.download = `audit-${nsLabel}-${slug}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function isFlatBefore(entry: LogEntry): boolean {
  return entry.type === 'write' || entry.type === 'delete'
}

function flatBefore(entry: LogEntry): Record<string, string> {
  if (!isFlatBefore(entry)) return {}
  return (entry.before ?? {}) as Record<string, string>
}

function diffKeys(entry: LogEntry): string[] {
  if (!isFlatBefore(entry)) return []
  return [...new Set([...Object.keys(flatBefore(entry)), ...Object.keys(entry.after ?? {})])].sort()
}

function diffStatus(entry: LogEntry, key: string): 'added' | 'removed' | 'modified' | 'unchanged' {
  const before = flatBefore(entry)
  const inBefore = key in before
  const inAfter = entry.after ? key in entry.after : false
  if (!inBefore && inAfter) return 'added'
  if (inBefore && !inAfter) return 'removed'
  if (inBefore && inAfter && before[key] !== entry.after![key]) return 'modified'
  return 'unchanged'
}

function diffRowClass(status: string): string {
  if (status === 'added') return 'bg-green-950 text-green-300'
  if (status === 'removed') return 'bg-red-950 text-red-300 line-through-values'
  if (status === 'modified') return 'bg-yellow-950 text-yellow-200'
  return 'text-gray-500'
}

function diffSummary(entry: LogEntry): { added: number; removed: number; modified: number } {
  const keys = diffKeys(entry)
  return keys.reduce((acc, k) => {
    const s = diffStatus(entry, k)
    if (s !== 'unchanged') acc[s]++
    return acc
  }, { added: 0, removed: 0, modified: 0 })
}

// --- Persistence state ---
type SaveStatus = { lastSavedAt: string | null; count: number; file: string }
const saveStatus = ref<SaveStatus | null>(null)
const saving = ref(false)
type ExportPreset = { pathPrefix: string; mount: string }
function loadExportPreset(): ExportPreset | null {
  try {
    const raw = JSON.parse(localStorage.getItem('vault-export-preset') ?? 'null')
    if (!raw) return null
    // Migrate old format { path, mount } → { pathPrefix, mount }
    if (raw.pathPrefix === undefined && raw.path) {
      const parts = (raw.path as string).split('/')
      raw.pathPrefix = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    }
    return raw as ExportPreset
  } catch { return null }
}
function saveExportPreset(p: ExportPreset) {
  try { localStorage.setItem('vault-export-preset', JSON.stringify(p)) } catch {}
}
function sessionSlug(): string {
  const d = new Date()
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `sessions-${dd}${mm}${yyyy}-${hh}${min}`
}
function buildExportPath(prefix: string): string {
  return prefix ? `${prefix}/${sessionSlug()}` : sessionSlug()
}

const exportPreset = loadExportPreset()
const vaultExportPath = ref(buildExportPath(exportPreset?.pathPrefix ?? ''))
const vaultExportMount = ref(exportPreset?.mount ?? 'secret')
const exportPresetActive = ref(!!exportPreset?.pathPrefix)
const exporting = ref(false)
const exportResult = ref<{ ok: boolean; message: string } | null>(null)

async function saveNow() {
  saving.value = true
  try {
    const res = await fetch('/api/admin/save-logs', { method: 'POST' })
    if (res.ok) saveStatus.value = await res.json()
  } catch {}
  saving.value = false
}

async function exportToVault() {
  if (!vaultExportPath.value.trim()) return
  exporting.value = true
  exportResult.value = null
  try {
    const res = await fetch('/api/admin/export-vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: vaultExportPath.value.trim(),
        mount: vaultExportMount.value,
        namespace: vault.currentNamespace,
      }),
    })
    if (res.ok) {
      const nsLabel = vault.namespaces.find(n => n.namespace === vault.currentNamespace)?.label ?? vault.currentNamespace
      exportResult.value = { ok: true, message: `Exporté vers [${nsLabel}] ${vaultExportMount.value}/${vaultExportPath.value.trim()}` }
      const fullPath = vaultExportPath.value.trim()
      const parts = fullPath.split('/')
      const pathPrefix = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
      saveExportPreset({ pathPrefix, mount: vaultExportMount.value })
      exportPresetActive.value = true
    } else {
      const err = await res.json().catch(() => ({}))
      const detail = err?.errors?.length ? err.errors.join(' — ') : (err.error ?? `HTTP ${res.status}`)
      exportResult.value = { ok: false, message: detail }
    }
  } catch (e: unknown) {
    exportResult.value = { ok: false, message: e instanceof Error ? e.message : 'Erreur réseau' }
  }
  exporting.value = false
  if (exportResult.value?.ok) setTimeout(() => { exportResult.value = null }, 4000)
}

function formatSavedAt(ts: string | null): string {
  if (!ts) return 'Jamais'
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const nsScopedLogs = computed(() => logs.value.filter(l => l.namespace === vault.currentNamespace))

const isWriteType = (t: string) => t === 'write' || t === 'delete' || t === 'delete_folder'

const filteredLogs = computed(() => {
  const byNs = nsScopedLogs.value
  if (activeTab.value === 'writes') return byNs.filter(l => isWriteType(l.type))
  if (activeTab.value === 'logins') return byNs.filter(l => l.type === 'login_ok' || l.type === 'login_fail')
  return byNs
})

const nsStats = computed(() => {
  const today = new Date().toDateString()
  const l = nsScopedLogs.value
  return {
    totalWrites: l.filter(e => isWriteType(e.type)).length,
    writesToday: l.filter(e => isWriteType(e.type) && new Date(e.ts).toDateString() === today).length,
    totalLogins: l.filter(e => e.type === 'login_ok').length,
    totalLoginFails: l.filter(e => e.type === 'login_fail').length,
    logsCount: l.length,
  }
})

async function fetchAll(silent = false) {
  if (!silent) loading.value = true
  else refreshing.value = true
  try {
    const [logsRes, statsRes, saveRes] = await Promise.all([
      fetch('/api/admin/logs'),
      fetch('/api/admin/stats'),
      fetch('/api/admin/save-status'),
    ])
    if (logsRes.ok) logs.value = await logsRes.json()
    if (statsRes.ok) {
      const s: Stats = await statsRes.json()
      stats.value = s
      localSettings.value = { loggingEnabled: s.loggingEnabled, editingEnabled: s.editingEnabled }
    }
    if (saveRes.ok) saveStatus.value = await saveRes.json()
  } catch {}
  loading.value = false
  refreshing.value = false
}

async function saveSetting(key: 'loggingEnabled' | 'editingEnabled', value: boolean) {
  const prev = localSettings.value[key]
  localSettings.value[key] = value
  settingsSaving.value = true
  try {
    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    })
    if (res.ok) {
      if (key === 'editingEnabled') vault.editingEnabled = value
      if (key === 'loggingEnabled') vault.loggingEnabled = value
      if (stats.value) (stats.value as Record<string, unknown>)[key] = value
      showFeedback(key, value)
    } else {
      localSettings.value[key] = prev
    }
  } catch {
    localSettings.value[key] = prev
  }
  settingsSaving.value = false
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function nsLabel(ns: string): string {
  return ns ? (ns.split('/').pop() ?? ns) : '—'
}

function logTypeLabel(type: string): string {
  if (type === 'write') return 'Écriture'
  if (type === 'login_ok') return 'Connexion'
  if (type === 'login_fail') return 'Échec login'
  if (type === 'delete') return 'Suppression'
  if (type === 'delete_folder') return 'Suppression dossier'
  return type
}

function logTypeBadge(type: string): string {
  if (type === 'write') return 'bg-blue-900/60 text-blue-300 border-blue-800'
  if (type === 'login_ok') return 'bg-green-900/60 text-green-300 border-green-800'
  if (type === 'login_fail') return 'bg-red-900/60 text-red-300 border-red-800'
  if (type === 'delete' || type === 'delete_folder') return 'bg-red-900/60 text-red-300 border-red-800'
  return 'bg-gray-800 text-gray-400 border-gray-700'
}

async function handleLogout() {
  loggingOut.value = true
  await new Promise(resolve => setTimeout(resolve, 1500))
  await vault.logout()
  await router.push('/')
}

function openConfigEdit() {
  const org = vault.vaultAddr.match(/^https?:\/\/vault\.factory\.(.+?)\.cloud\/?$/)?.[1] ?? ''
  editOrg.value = org
  editMount.value = vault.currentMount || 'secret'
  editNamespaces.value = vault.namespaces.length > 0
    ? vault.namespaces.map(n => ({ label: n.label, namespace: n.namespace }))
    : []
  configError.value = null
  showConfigEdit.value = true
}

function addNamespaceRow() {
  editNamespaces.value.push({ label: '', namespace: '' })
}

function removeNamespaceRow(i: number) {
  const ns = editNamespaces.value[i]
  confirmAction.value = { type: 'delete', namespace: ns.namespace, label: ns.label }
  showConfirmDialog.value = true
}

function logoutNamespace(ns: string) {
  confirmAction.value = { type: 'logout', namespace: ns, label: vault.namespaces.find(n => n.namespace === ns)?.label || ns }
  showConfirmDialog.value = true
}

async function executeConfirmAction() {
  if (!confirmAction.value) return
  confirmLoading.value = true
  try {
    const { type, namespace } = confirmAction.value

    if (type === 'delete') {
      // Delete from list
      editNamespaces.value = editNamespaces.value.filter(n => n.namespace !== namespace)

      // If deleting the connected namespace, switch to another
      if (namespace === vault.currentNamespace) {
        const remaining = editNamespaces.value[0]
        if (remaining) {
          vault.currentNamespace = remaining.namespace
          try { localStorage.setItem('vault-namespace', remaining.namespace) } catch {}
          await vault.loadTokenStatus()
        } else {
          // No remaining namespaces, logout
          await vault.logout()
          showConfigEdit.value = false
        }
      }
    } else {
      // Logout: just delete token, keep namespace
      vault.tokenStatus = null
      vault.tokenError = null

      // Switch to another namespace if available
      const remaining = vault.namespaces.find(n => n.namespace !== namespace)
      if (remaining) {
        vault.currentNamespace = remaining.namespace
        try { localStorage.setItem('vault-namespace', remaining.namespace) } catch {}
        await vault.loadTokenStatus()
      } else {
        // No other namespaces, go to login
        vault.showLoginModal = true
        showConfigEdit.value = false
      }
    }

    showConfirmDialog.value = false
  } catch (e) {
    configError.value = e instanceof Error ? e.message : 'Erreur'
  } finally {
    confirmLoading.value = false
  }
}

async function saveConfig() {
  configError.value = null
  configSaving.value = true
  try {
    if (!editOrg.value.trim()) {
      throw new Error('Le nom de l\'organisation est requis')
    }
    const nsList = editNamespaces.value
      .filter(n => n.label.trim() || n.namespace.trim())
      .map(n => ({
        id: n.label.trim().toLowerCase().replace(/\s+/g, '-') || n.namespace.trim().replace(/\//g, '-'),
        label: n.label.trim() || n.namespace.trim(),
        namespace: n.namespace.trim(),
      }))
    if (nsList.length === 0) {
      throw new Error('Au moins un namespace est requis')
    }
    const vaultAddr = `https://vault.factory.${editOrg.value.trim()}.cloud`
    await vault.saveAppConfig({
      vaultAddr,
      namespaces: nsList,
      mount: editMount.value.trim() || 'secret',
    })
    showConfigEdit.value = false
  } catch (e: unknown) {
    configError.value = e instanceof Error ? e.message : 'Erreur de sauvegarde'
  } finally {
    configSaving.value = false
  }
}

onMounted(() => fetchAll())

watch(() => vault.lastWriteAt, (val) => { if (val > 0) fetchAll(true) })

const pollTimer = setInterval(() => fetchAll(true), 30_000)
onUnmounted(() => clearInterval(pollTimer))
</script>

<template>
  <div class="space-y-6">

    <!-- Page header -->
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-white font-semibold text-sm">Dashboard Admin</h1>
      <div class="flex gap-2">
        <button
          class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition cursor-pointer"
          :disabled="refreshing"
          @click="fetchAll(true)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" :class="['w-3.5 h-3.5', refreshing && 'animate-spin']">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Actualiser
        </button>
        <button
          class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-900 hover:bg-blue-800 text-blue-200 rounded transition cursor-pointer"
          @click="openConfigEdit"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 9.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0z" />
          </svg>
          Modifier config
        </button>
        <button
          class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-red-900 hover:bg-red-800 text-red-200 rounded transition cursor-pointer disabled:opacity-50 disabled:hover:bg-red-900"
          :disabled="loggingOut"
          @click="handleLogout"
        >
          <svg v-if="loggingOut" class="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3-3 3-3m0 0-3-3m3 3H9" />
          </svg>
          {{ loggingOut ? 'Déconnexion…' : 'Déconnexion' }}
        </button>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <div v-for="i in 5" :key="i" class="h-20 bg-gray-800 rounded-lg animate-pulse" />
    </div>

    <template v-else>
      <!-- Stats cards -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div class="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div class="text-gray-500 text-xs mb-1">Écritures (total)</div>
          <div class="text-white text-2xl font-bold font-mono">{{ nsStats.totalWrites }}</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div class="text-gray-500 text-xs mb-1">Écritures (auj.)</div>
          <div class="text-blue-400 text-2xl font-bold font-mono">{{ nsStats.writesToday }}</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div class="text-gray-500 text-xs mb-1">Connexions réussies</div>
          <div class="text-green-400 text-2xl font-bold font-mono">{{ nsStats.totalLogins }}</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div class="text-gray-500 text-xs mb-1">Échecs de login</div>
          <div class="text-red-400 text-2xl font-bold font-mono">{{ nsStats.totalLoginFails }}</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
          <div class="text-gray-500 text-xs mb-1">Entrées de log</div>
          <div class="text-gray-300 text-2xl font-bold font-mono">{{ nsStats.logsCount }}</div>
        </div>
      </div>

      <!-- Settings panel -->
      <div class="bg-gray-900 border border-gray-800 rounded-lg px-5 py-4">
        <h2 class="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">Paramètres</h2>
        <!-- Feedback toast -->
        <transition name="fade">
          <div
            v-if="feedback"
            class="mb-4 px-3 py-2 rounded text-xs font-medium"
            :class="feedback.ok ? 'bg-green-900/60 border border-green-700 text-green-300' : 'bg-red-900/60 border border-red-700 text-red-300'"
          >
            {{ feedback.ok ? '✓' : '⚠' }} {{ feedback.message }}
          </div>
        </transition>

        <div class="flex flex-wrap gap-6">

          <!-- Logging toggle -->
          <label class="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              role="switch"
              :aria-checked="localSettings.loggingEnabled"
              :disabled="settingsSaving"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50"
              :class="localSettings.loggingEnabled ? 'bg-green-600' : 'bg-gray-600'"
              @click="saveSetting('loggingEnabled', !localSettings.loggingEnabled)"
            >
              <span
                class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                :class="localSettings.loggingEnabled ? 'translate-x-4' : 'translate-x-1'"
              />
            </button>
            <div>
              <div class="text-sm text-gray-200 group-hover:text-white transition">Journalisation</div>
              <div class="text-xs text-gray-600">Enregistre les écritures et connexions</div>
            </div>
          </label>

          <!-- Editing toggle -->
          <label class="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              role="switch"
              :aria-checked="localSettings.editingEnabled"
              :disabled="settingsSaving"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50"
              :class="localSettings.editingEnabled ? 'bg-green-600' : 'bg-red-700'"
              @click="saveSetting('editingEnabled', !localSettings.editingEnabled)"
            >
              <span
                class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"
                :class="localSettings.editingEnabled ? 'translate-x-4' : 'translate-x-1'"
              />
            </button>
            <div>
              <div class="text-sm text-gray-200 group-hover:text-white transition">Édition activée</div>
              <div class="text-xs text-gray-600">Désactiver = mode lecture seule sur toute l'UI</div>
            </div>
          </label>

        </div>
        <div v-if="!localSettings.editingEnabled" class="mt-4 px-3 py-2 bg-red-950 border border-red-800 rounded text-red-300 text-xs">
          ⚠ Mode lecture seule actif — toutes les actions d'écriture sont bloquées
        </div>
      </div>

      <!-- Persistence panel -->
      <div class="bg-gray-900 border border-gray-800 rounded-lg px-5 py-4 space-y-4">
        <h2 class="text-gray-400 text-xs font-semibold uppercase tracking-wider">Persistance des logs</h2>

        <!-- File save row -->
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div class="text-xs">
            <div class="text-gray-400">
              Fichier :
              <span class="text-gray-300 font-mono ml-1">{{ saveStatus?.file ?? '…' }}</span>
            </div>
            <div class="text-gray-600 mt-0.5">
              Dernière sauvegarde : <span :class="saveStatus?.lastSavedAt ? 'text-green-500' : 'text-gray-500'">{{ formatSavedAt(saveStatus?.lastSavedAt ?? null) }}</span>
              <span v-if="saveStatus?.count != null" class="ml-2 text-gray-700">· {{ saveStatus.count }} entrée(s)</span>
            </div>
            <div class="text-gray-700 mt-0.5 text-xs">Sauvegarde automatique au changement de namespace et à l'arrêt du BFF.</div>
          </div>
          <button
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition shrink-0"
            :class="saving ? 'bg-gray-700 text-gray-400' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'"
            :disabled="saving"
            @click="saveNow"
          >
            <svg v-if="saving" class="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            {{ saving ? 'Sauvegarde…' : 'Sauvegarder maintenant' }}
          </button>
        </div>

        <!-- Local JSON download -->
        <div class="border-t border-gray-800 pt-4 flex items-center justify-between">
          <div>
            <div class="text-gray-400 text-xs">Exporter localement (JSON)</div>
            <div class="text-gray-700 text-xs mt-0.5">{{ nsScopedLogs.length }} entrée(s) · namespace actif</div>
          </div>
          <button
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition shrink-0"
            @click="downloadLogsLocally"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-blue-400">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Télécharger JSON
          </button>
        </div>

        <!-- Vault export row -->
        <div class="border-t border-gray-800 pt-4">
          <div class="flex items-center justify-between mb-3">
            <div class="text-gray-400 text-xs">Exporter la session vers Vault KV</div>
            <span class="text-purple-400 text-xs font-mono">{{ vault.currentNamespaceLabel }}</span>
          </div>

          <!-- mount + path + button -->
          <div class="flex gap-2 flex-wrap items-center">
            <select
              v-model="vaultExportMount"
              class="px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-300 text-xs rounded focus:outline-none focus:border-gray-500 w-24 shrink-0"
            >
              <option value="secret">secret</option>
              <option value="kv">kv</option>
            </select>
            <span class="text-gray-600 text-xs shrink-0">/</span>
            <div class="flex-1 min-w-40 relative">
              <input
                v-model="vaultExportPath"
                placeholder="admin/audit/session-2025-04"
                class="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 text-green-300 font-mono text-xs rounded focus:outline-none focus:border-green-700 placeholder-gray-700"
                :class="exportPresetActive ? 'pr-24' : ''"
                @input="exportPresetActive = false"
                @keydown.enter="exportToVault"
              />
              <span
                v-if="exportPresetActive"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-600 pointer-events-none select-none"
              >répertoire mémorisé</span>
            </div>
            <button
              class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition shrink-0"
              :class="exporting || !vaultExportPath.trim() ? 'bg-gray-800 text-gray-600 cursor-not-allowed' : 'bg-green-800 hover:bg-green-700 text-green-100'"
              :disabled="exporting || !vaultExportPath.trim()"
              @click="exportToVault"
            >
              <svg v-if="exporting" class="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
              </svg>
              {{ exporting ? 'Export…' : 'Exporter' }}
            </button>
          </div>
          <transition name="fade">
            <div
              v-if="exportResult"
              class="mt-2 text-xs px-2 py-1.5 rounded"
              :class="exportResult.ok ? 'bg-green-950 border border-green-800 text-green-300' : 'bg-red-950 border border-red-800 text-red-300'"
            >
              {{ exportResult.ok ? '✓' : '⚠' }} {{ exportResult.message }}
            </div>
          </transition>
        </div>
      </div>

      <!-- Logs section -->
      <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <!-- Tabs + count -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div class="flex gap-1">
            <button
              v-for="tab in ([{ id: 'all', label: 'Tout' }, { id: 'writes', label: 'Écritures' }, { id: 'logins', label: 'Connexions' }] as const)"
              :key="tab.id"
              type="button"
              class="px-3 py-1 text-xs rounded transition"
              :class="activeTab === tab.id ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'"
              @click="activeTab = tab.id"
            >{{ tab.label }}</button>
          </div>
          <span class="text-gray-600 text-xs">{{ filteredLogs.length }} entrée(s)</span>
        </div>

        <!-- Table -->
        <div v-if="filteredLogs.length === 0" class="px-4 py-8 text-center text-gray-600 text-sm">
          Aucune entrée pour le moment
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-xs font-mono">
            <thead>
              <tr class="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                <th class="text-left px-4 py-2 w-36">Heure</th>
                <th class="text-left px-3 py-2 w-28">Type</th>
                <th class="text-left px-3 py-2 w-32">Namespace</th>
                <th class="text-left px-3 py-2">Détails</th>
                <th class="text-left px-3 py-2 w-16">Statut</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in filteredLogs"
                :key="entry.id"
                class="group border-b border-gray-800 last:border-0 hover:bg-gray-800/50 cursor-pointer"
                @click="selectedLog = entry; restoreError = null; restoreSuccess = false"
              >
                <td class="px-4 py-2 text-gray-500 whitespace-nowrap">{{ formatTs(entry.ts) }}</td>
                <td class="px-3 py-2">
                  <span class="px-1.5 py-0.5 rounded border text-xs" :class="logTypeBadge(entry.type)">
                    {{ logTypeLabel(entry.type) }}
                  </span>
                </td>
                <td class="px-3 py-2 text-gray-400 whitespace-nowrap">{{ nsLabel(entry.namespace) }}</td>
                <td class="px-3 py-2 text-gray-300">
                  <template v-if="entry.type === 'write'">
                    <span class="text-green-400">{{ entry.path }}</span>
                    <template v-if="entry.before || entry.after">
                      <span v-if="diffSummary(entry).added" class="ml-2 px-1 py-0.5 rounded bg-green-950 text-green-400 text-xs">+{{ diffSummary(entry).added }}</span>
                      <span v-if="diffSummary(entry).modified" class="ml-1 px-1 py-0.5 rounded bg-yellow-950 text-yellow-300 text-xs">~{{ diffSummary(entry).modified }}</span>
                      <span v-if="diffSummary(entry).removed" class="ml-1 px-1 py-0.5 rounded bg-red-950 text-red-400 text-xs">-{{ diffSummary(entry).removed }}</span>
                    </template>
                    <span v-else class="text-gray-600 ml-1">({{ entry.keysCount }} clé(s))</span>
                  </template>
                  <template v-else-if="entry.type === 'login_ok'">
                    <span class="text-gray-300">{{ entry.display_name || '—' }}</span>
                  </template>
                  <template v-else-if="entry.type === 'login_fail'">
                    <span class="text-red-400">{{ entry.error }}</span>
                  </template>
                  <template v-else-if="entry.type === 'delete'">
                    <span class="text-red-400">{{ entry.path }}</span>
                    <span v-if="diffSummary(entry).removed" class="ml-2 px-1 py-0.5 rounded bg-red-950 text-red-400 text-xs">-{{ diffSummary(entry).removed }}</span>
                  </template>
                  <template v-else-if="entry.type === 'delete_folder'">
                    <span class="text-red-400">{{ entry.path }}/</span>
                    <span class="ml-2 px-1 py-0.5 rounded bg-red-950 text-red-400 text-xs">-{{ entry.deletedCount ?? 0 }} secrets</span>
                  </template>
                </td>
                <td class="px-3 py-2">
                  <div class="flex items-center gap-2">
                    <span :class="entry.success ? 'text-green-500' : 'text-red-500'">
                      {{ entry.success ? '✓' : '✗' }}
                    </span>
                    <button
                      class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                      title="Supprimer cette entrée du journal"
                      @click.stop="deleteLogEntry(entry.id)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>
  </div>

  <!-- Log detail modal -->
  <div
    v-if="selectedLog"
    class="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
    @click.self="selectedLog = null"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700">
        <div class="flex items-center gap-3">
          <span class="px-1.5 py-0.5 rounded border text-xs" :class="logTypeBadge(selectedLog.type)">
            {{ logTypeLabel(selectedLog.type) }}
          </span>
          <span class="text-gray-400 text-xs">{{ formatTs(selectedLog.ts) }}</span>
          <span class="text-gray-600 text-xs">{{ nsLabel(selectedLog.namespace) }}</span>
        </div>
        <button class="text-gray-500 hover:text-gray-300 text-sm" @click="selectedLog = null">✕</button>
      </div>

      <div class="overflow-auto flex-1 px-5 py-4 space-y-4">

        <!-- Write / delete detail -->
        <template v-if="selectedLog.type === 'write' || selectedLog.type === 'delete'">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-mono text-sm" :class="selectedLog.type === 'delete' ? 'text-red-400' : 'text-green-400'">{{ selectedLog.path }}</span>
            <span class="text-gray-600 text-xs">mount: {{ selectedLog.mount }}</span>
            <span v-if="!selectedLog.success" class="px-2 py-0.5 bg-red-900/50 border border-red-700 text-red-300 text-xs rounded">
              ✗ Échec — {{ selectedLog.error }}
            </span>
          </div>

          <!-- Diff summary chips -->
          <div class="flex gap-2 flex-wrap">
            <template v-if="diffSummary(selectedLog).added">
              <span class="px-2 py-0.5 rounded bg-green-950 border border-green-800 text-green-400 text-xs">
                +{{ diffSummary(selectedLog).added }} ajouté(s)
              </span>
            </template>
            <template v-if="diffSummary(selectedLog).modified">
              <span class="px-2 py-0.5 rounded bg-yellow-950 border border-yellow-800 text-yellow-300 text-xs">
                ~{{ diffSummary(selectedLog).modified }} modifié(s)
              </span>
            </template>
            <template v-if="diffSummary(selectedLog).removed">
              <span class="px-2 py-0.5 rounded bg-red-950 border border-red-800 text-red-400 text-xs">
                -{{ diffSummary(selectedLog).removed }} supprimé(s)
              </span>
            </template>
            <template v-if="!diffSummary(selectedLog).added && !diffSummary(selectedLog).modified && !diffSummary(selectedLog).removed">
              <span class="text-gray-600 text-xs">Aucune différence détectée</span>
            </template>
          </div>

          <!-- Diff table -->
          <div v-if="diffKeys(selectedLog).length" class="border border-gray-700 rounded overflow-hidden">
            <table class="w-full text-xs font-mono">
              <thead>
                <tr class="bg-gray-800 border-b border-gray-700 text-gray-500 uppercase tracking-wider">
                  <th class="text-left px-4 py-2 w-1/3">Clé</th>
                  <th class="text-left px-3 py-2 w-1/3">Avant</th>
                  <th class="text-left px-3 py-2 w-1/3">Après</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="key in diffKeys(selectedLog)"
                  :key="key"
                  class="border-b border-gray-800 last:border-0"
                  :class="diffRowClass(diffStatus(selectedLog, key))"
                >
                  <td class="px-4 py-2 font-medium">{{ key }}</td>
                  <td class="px-3 py-2 opacity-75 break-all" :class="{ 'line-through': diffStatus(selectedLog, key) === 'removed' }">
                    {{ (flatBefore(selectedLog) as Record<string,string>)[key] ?? '' }}
                  </td>
                  <td class="px-3 py-2 break-all">
                    {{ selectedLog.after?.[key] ?? '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="text-gray-600 text-xs">
            Aucun détail disponible — entrée antérieure à la v2 du log.
          </div>
        </template>

        <!-- Delete folder detail -->
        <template v-else-if="selectedLog.type === 'delete_folder'">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-red-400 font-mono text-sm">{{ selectedLog.path }}/</span>
            <span class="text-gray-600 text-xs">mount: {{ selectedLog.mount }}</span>
            <span class="px-2 py-0.5 rounded bg-red-950 border border-red-800 text-red-400 text-xs">
              -{{ selectedLog.deletedCount ?? 0 }} secret(s)
            </span>
            <span v-if="!selectedLog.success" class="px-2 py-0.5 bg-red-900/50 border border-red-700 text-red-300 text-xs rounded">
              ✗ Échec — {{ selectedLog.error }}
            </span>
          </div>
          <div v-if="selectedLog.deletedPaths?.length" class="border border-gray-700 rounded overflow-hidden">
            <div class="bg-gray-800 border-b border-gray-700 px-4 py-2 text-gray-500 text-xs uppercase tracking-wider">Chemins supprimés</div>
            <div
              v-for="p in selectedLog.deletedPaths"
              :key="p"
              class="px-4 py-1.5 border-b border-gray-800 last:border-0 text-xs font-mono text-red-300/80 bg-red-950/20"
            >- {{ p }}</div>
          </div>
          <div v-else class="text-gray-600 text-xs">Aucun chemin supprimé enregistré.</div>
        </template>

        <!-- Login detail -->
        <template v-else>
          <div class="space-y-2 text-sm">
            <div class="flex gap-3">
              <span class="text-gray-600 w-32 shrink-0">Namespace</span>
              <span class="text-gray-300 font-mono text-xs break-all">{{ selectedLog.namespace || '—' }}</span>
            </div>
            <div v-if="selectedLog.display_name" class="flex gap-3">
              <span class="text-gray-600 w-32 shrink-0">Utilisateur</span>
              <span class="text-gray-300">{{ selectedLog.display_name }}</span>
            </div>
            <div v-if="selectedLog.error" class="flex gap-3">
              <span class="text-gray-600 w-32 shrink-0">Erreur</span>
              <span class="text-red-400 text-xs font-mono break-all">{{ selectedLog.error }}</span>
            </div>
            <div class="flex gap-3">
              <span class="text-gray-600 w-32 shrink-0">Statut</span>
              <span :class="selectedLog.success ? 'text-green-400' : 'text-red-400'">
                {{ selectedLog.success ? 'Succès' : 'Échec' }}
              </span>
            </div>
          </div>
        </template>

      </div>

      <!-- Modal footer: restore + delete log -->
      <div class="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-800 shrink-0">
        <div class="flex items-center gap-2">
          <!-- Restore button: only for write/delete/delete_folder with a before state -->
          <button
            v-if="(selectedLog.type === 'write' || selectedLog.type === 'delete') && Object.keys(flatBefore(selectedLog)).length > 0"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition"
            :class="restoring ? 'bg-gray-700 text-gray-400' : restoreSuccess ? 'bg-green-900 text-green-300' : 'bg-amber-900/60 hover:bg-amber-800/80 text-amber-300 border border-amber-800'"
            :disabled="restoring"
            :title="selectedLog.type === 'write' ? 'Écraser avec l\'état précédent (rollback)' : 'Restaurer le secret supprimé'"
            @click="restoreEntry(selectedLog)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
            </svg>
            {{ restoreSuccess ? '✓ Restauré' : restoring ? 'Restauration…' : selectedLog.type === 'write' ? 'Rollback' : 'Restaurer' }}
          </button>
          <button
            v-else-if="selectedLog.type === 'delete_folder' && Object.keys(selectedLog.before ?? {}).length > 0"
            class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition"
            :class="restoring ? 'bg-gray-700 text-gray-400' : restoreSuccess ? 'bg-green-900 text-green-300' : 'bg-amber-900/60 hover:bg-amber-800/80 text-amber-300 border border-amber-800'"
            :disabled="restoring"
            title="Restaurer tous les secrets supprimés"
            @click="restoreEntry(selectedLog)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
            </svg>
            {{ restoreSuccess ? '✓ Restauré' : restoring ? 'Restauration…' : `Restaurer (${selectedLog.deletedCount} secrets)` }}
          </button>
          <span v-if="restoreError" class="text-red-400 text-xs">⚠ {{ restoreError }}</span>
        </div>
        <button
          class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-red-950/40 transition border border-gray-800 hover:border-red-900"
          title="Supprimer cette entrée du journal"
          @click="deleteLogEntry(selectedLog.id)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
          Supprimer log
        </button>
      </div>

    </div>
  </div>

  <!-- Configuration edit modal -->
  <div
    v-if="showConfigEdit"
    class="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
    @click.self="showConfigEdit = false"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg shadow-2xl">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700">
        <h2 class="text-white font-semibold text-sm">⚙ Modifier la configuration</h2>
        <button class="text-gray-500 hover:text-gray-300 text-lg" @click="showConfigEdit = false">✕</button>
      </div>

      <!-- Body -->
      <div class="px-5 py-4 space-y-4">

        <!-- Error banner -->
        <div v-if="configError" class="bg-red-950 border border-red-800 rounded px-3 py-2 text-red-300 text-xs">
          ⚠ {{ configError }}
        </div>

        <!-- Organization -->
        <div class="space-y-1.5">
          <label class="block text-gray-400 text-xs font-semibold">Organisation</label>
          <div class="flex gap-2">
            <span class="px-3 py-1.5 bg-gray-950 border border-gray-700 text-gray-600 text-xs rounded">
              https://vault.factory.
            </span>
            <input
              v-model="editOrg"
              type="text"
              placeholder="ex: adeo"
              class="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 text-green-300 text-xs rounded focus:outline-none focus:border-green-600"
            />
            <span class="px-3 py-1.5 bg-gray-950 border border-gray-700 text-gray-600 text-xs rounded">
              .cloud
            </span>
          </div>
        </div>

        <!-- Mount -->
        <div class="space-y-1.5">
          <label class="block text-gray-400 text-xs font-semibold">KV Mount</label>
          <input
            v-model="editMount"
            type="text"
            placeholder="secret"
            class="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 text-gray-300 text-xs rounded focus:outline-none focus:border-green-600"
          />
        </div>

        <!-- Namespaces -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="text-gray-400 text-xs font-semibold">Namespaces <span class="text-red-400">*</span></label>
            <button
              type="button"
              class="text-green-400 hover:text-green-300 text-xs font-semibold"
              @click="addNamespaceRow"
            >+ Ajouter</button>
          </div>
          <div class="space-y-1.5 max-h-48 overflow-y-auto">
            <div v-for="(ns, i) in editNamespaces" :key="i" class="flex gap-2 items-center">
              <input
                v-model="ns.label"
                type="text"
                placeholder="Label"
                :disabled="ns.namespace === vault.currentNamespace"
                class="flex-1 px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-300 text-xs rounded focus:outline-none focus:border-green-600 disabled:text-gray-500 disabled:cursor-not-allowed"
              />
              <input
                v-model="ns.namespace"
                type="text"
                placeholder="adeo/cdp/..."
                :disabled="ns.namespace === vault.currentNamespace"
                class="flex-1 px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-300 text-xs rounded focus:outline-none focus:border-green-600 disabled:text-gray-500 disabled:cursor-not-allowed font-mono"
              />
              <!-- Logout button (for connected namespace) -->
              <button
                v-if="ns.namespace === vault.currentNamespace"
                type="button"
                class="text-gray-600 hover:text-orange-400 p-1 transition shrink-0 cursor-pointer"
                title="Déconnecter ce namespace (token supprimé)"
                @click="logoutNamespace(ns.namespace)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3-3 3-3m0 0-3-3m3 3H9" />
                </svg>
              </button>

              <!-- Delete button -->
              <button
                type="button"
                class="text-gray-600 hover:text-red-400 p-1 transition shrink-0 cursor-pointer"
                :title="ns.namespace === vault.currentNamespace ? 'Supprimer (namespace connecté)' : 'Supprimer'"
                @click="removeNamespaceRow(editNamespaces.indexOf(ns))"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>

              <!-- Connected checkmark or not connected indicator -->
              <div
                v-if="ns.namespace === vault.currentNamespace"
                class="text-green-400 p-1 shrink-0 flex items-center justify-center"
                title="✓ Connecté"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" class="w-4 h-4">
                  <path fill-rule="evenodd" d="M19.915 11.086a.75.75 0 00-1.06-1.061l-6.387 6.387L7.06 10.061a.75.75 0 00-1.06 1.061l5.03 5.03a.75.75 0 001.06 0l7.06-7.06z" clip-rule="evenodd" />
                </svg>
              </div>
              <div
                v-else
                class="text-gray-600 p-1 shrink-0 flex items-center justify-center"
                title="Non connecté"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <div v-if="editNamespaces.length === 0" class="text-gray-600 text-xs py-2 text-center">
              Aucun namespace configuré
            </div>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="flex items-center gap-2 px-5 py-3 border-t border-gray-700">
        <button
          class="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs transition cursor-pointer"
          @click="showConfigEdit = false"
        >
          Annuler
        </button>
        <button
          class="flex-1 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-semibold transition cursor-pointer"
          :disabled="configSaving"
          @click="saveConfig"
        >
          {{ configSaving ? 'Sauvegarde…' : 'Sauvegarder' }}
        </button>
      </div>

    </div>
  </div>

  <!-- Confirmation dialog -->
  <div
    v-if="showConfirmDialog && confirmAction"
    class="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
    @click.self="showConfirmDialog = false"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-sm shadow-2xl">

      <!-- Header -->
      <div class="px-5 py-4 border-b border-gray-700">
        <h3 class="text-white font-semibold text-sm">
          {{ confirmAction.type === 'delete' ? '⚠ Supprimer le namespace' : '🚪 Déconnecter' }}
        </h3>
      </div>

      <!-- Body -->
      <div class="px-5 py-4 space-y-3">
        <p class="text-gray-400 text-sm">
          <template v-if="confirmAction.type === 'delete'">
            Êtes-vous sûr de vouloir <span class="font-semibold text-red-400">supprimer</span> le namespace <span class="font-mono text-gray-300">{{ confirmAction.label || confirmAction.namespace }}</span> ?
            <span class="block text-xs text-gray-500 mt-2">Le namespace sera retiré de la configuration et le token sera supprimé.</span>
            <span v-if="confirmAction.namespace === vault.currentNamespace" class="block text-xs text-orange-400 mt-2">⚠ C'est le namespace actuellement connecté. Vous serez basculé vers un autre namespace.</span>
          </template>
          <template v-else>
            Êtes-vous sûr de vouloir <span class="font-semibold text-orange-400">déconnecter</span> le namespace <span class="font-mono text-gray-300">{{ confirmAction.label || confirmAction.namespace }}</span> ?
            <span class="block text-xs text-gray-500 mt-2">Seul le token sera supprimé. Le namespace reste configuré.</span>
          </template>
        </p>
      </div>

      <!-- Footer -->
      <div class="flex items-center gap-2 px-5 py-3 border-t border-gray-700">
        <button
          class="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs transition cursor-pointer"
          :disabled="confirmLoading"
          @click="showConfirmDialog = false"
        >
          Annuler
        </button>
        <button
          class="flex-1 px-3 py-1.5 rounded text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          :class="confirmAction.type === 'delete'
            ? 'bg-red-700 hover:bg-red-600 text-white'
            : 'bg-orange-700 hover:bg-orange-600 text-white'"
          :disabled="confirmLoading"
          @click="executeConfirmAction"
        >
          {{ confirmLoading ? 'Traitement…' : (confirmAction.type === 'delete' ? 'Supprimer' : 'Déconnecter') }}
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

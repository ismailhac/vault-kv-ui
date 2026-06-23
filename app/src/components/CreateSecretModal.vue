<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'
import NestedJsonField from './NestedJsonField.vue'

const { t } = useI18n()
const emit = defineEmits<{
  close: []
  'open-compare': [{ source: string; target: string }]
}>()
const vault = useVaultStore()

// ── Prod filter ──
const PROD_NAMES = new Set(['prod', 'production', 'prd'])
function pathIsProd(path: string): boolean {
  return path.split('/').slice(1).some(s => PROD_NAMES.has(s.toLowerCase()))
}

// ── Available paths (dump-based, same as CompareModal) ──
const availablePaths = ref<string[]>([])
const loadingPaths = ref(true)
const pathsError = ref<string | null>(null)
const includePathProd = ref(false)

const filteredAvailablePaths = computed(() =>
  includePathProd.value ? availablePaths.value : availablePaths.value.filter(p => !pathIsProd(p))
)

async function loadAvailablePaths() {
  loadingPaths.value = true
  pathsError.value = null
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      pathsError.value = (err as { error?: string }).error ?? `HTTP ${res.status}`
      availablePaths.value = []
      return
    }
    const payload = await res.json()
    const rawMap =
      payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
        ? payload.data
        : payload
    availablePaths.value = rawMap && typeof rawMap === 'object'
      ? Object.keys(rawMap as Record<string, unknown>).sort()
      : []
  } catch (e: unknown) {
    pathsError.value = e instanceof Error ? e.message : t('createSecretModal.loadPathsError')
    availablePaths.value = []
  } finally {
    loadingPaths.value = false
  }
}

onMounted(loadAvailablePaths)

// ── Nested value detection (same as SecretPanel) ──
function parseJsonValue(val: unknown): { isNested: boolean; parsed: unknown } {
  if (val !== null && typeof val === 'object') return { isNested: true, parsed: val }
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        const p = JSON.parse(trimmed)
        if (typeof p === 'object' && p !== null) return { isNested: true, parsed: p }
      } catch {}
    }
  }
  return { isNested: false, parsed: val }
}

// ── Form state ──
type Mode = 'form' | 'json'
type FormRow = { key: string; value: string; valueMode: 'scalar' | 'json'; jsonError: string | null }
const mode = ref<Mode>('form')
type PathMode = 'select' | 'new'
const pathMode = ref<PathMode>('select')
const selectedExistingPath = ref(vault.currentPath && !vault.currentPath.endsWith('/') ? vault.currentPath : '')
const newBase = ref(vault.currentPath || '/')
const newPath = ref('')
const jsonInput = ref('{\n  "KEY": "value"\n}')
const formRows = ref<FormRow[]>([{ key: '', value: '', valueMode: 'scalar', jsonError: null }])
const jsonError = ref<string | null>(null)
const pathError = ref<string | null>(null)
const showConfirm = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const showHowTo = ref(false)

// ── Path source preview ──
const pathExpanded = ref(false)
const pathPreviewData = ref<Record<string, string> | null>(null)
const pathPreviewLoading = ref(false)
const pathRevealAll = ref(false)
const pathCopiedKey = ref<string | null>(null)

watch(selectedExistingPath, () => {
  pathExpanded.value = false
  pathPreviewData.value = null
  pathRevealAll.value = false
})

async function togglePathExpand() {
  if (!selectedExistingPath.value) return
  if (pathExpanded.value) { pathExpanded.value = false; return }
  if (!pathPreviewData.value) {
    pathPreviewLoading.value = true
    try {
      const params = new URLSearchParams({ path: selectedExistingPath.value, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/read?${params}`)
      const json = await res.json()
      pathPreviewData.value = res.ok ? (json.data ?? {}) : {}
    } catch { pathPreviewData.value = {} }
    finally { pathPreviewLoading.value = false }
  }
  pathExpanded.value = true
}

async function copyPathKey(key: string, value: string) {
  await navigator.clipboard.writeText(value)
  pathCopiedKey.value = key
  setTimeout(() => { if (pathCopiedKey.value === key) pathCopiedKey.value = null }, 2000)
}

const fullPath = computed(() => {
  if (pathMode.value === 'select') return selectedExistingPath.value
  const leaf = newPath.value.trim().replace(/^\/+|\/+$/g, '')
  if (!leaf) return ''
  return newBase.value === '/' ? leaf : `${newBase.value}/${leaf}`
})

const parsedData = computed((): Record<string, string> | null => {
  if (mode.value === 'json') {
    try {
      const parsed = JSON.parse(jsonInput.value)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) return null
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
    } catch { return null }
  }
  const rows = formRows.value.filter(r => r.key.trim())
  if (rows.length === 0) return null
  return Object.fromEntries(rows.map(r => [r.key.trim(), r.value]))
})

function validateJsonRow(row: FormRow) {
  if (row.valueMode !== 'json') { row.jsonError = null; return }
  try { JSON.parse(row.value || '{}'); row.jsonError = null }
  catch { row.jsonError = t('createSecretModal.invalidJson') }
}

function toggleRowMode(row: FormRow) {
  row.valueMode = row.valueMode === 'scalar' ? 'json' : 'scalar'
  if (row.valueMode === 'json' && !row.value.trim()) row.value = '{}'
  validateJsonRow(row)
}

function switchMode(m: Mode) {
  if (m === mode.value) return
  jsonError.value = null
  if (m === 'json') {
    const rows = formRows.value.filter(r => r.key.trim())
    if (rows.length === 0) { jsonInput.value = '{\n  "KEY": "value"\n}'; mode.value = m; return }
    const obj: Record<string, unknown> = {}
    for (const r of rows) {
      if (r.valueMode === 'json') {
        try { obj[r.key.trim()] = JSON.parse(r.value) }
        catch { obj[r.key.trim()] = r.value }
      } else {
        obj[r.key.trim()] = r.value
      }
    }
    jsonInput.value = JSON.stringify(obj, null, 2)
  } else {
    try {
      const parsed = JSON.parse(jsonInput.value)
      if (typeof parsed === 'object' && !Array.isArray(parsed) && parsed !== null && Object.keys(parsed).length > 0) {
        formRows.value = Object.entries(parsed).map(([key, value]) => {
          if (typeof value === 'object' && value !== null) {
            return { key, value: JSON.stringify(value, null, 2), valueMode: 'json' as const, jsonError: null }
          }
          return { key, value: String(value), valueMode: 'scalar' as const, jsonError: null }
        })
      } else {
        formRows.value = [{ key: '', value: '', valueMode: 'scalar', jsonError: null }]
      }
    } catch {
      formRows.value = [{ key: '', value: '', valueMode: 'scalar', jsonError: null }]
    }
  }
  mode.value = m
}

function addRow() { formRows.value.push({ key: '', value: '', valueMode: 'scalar', jsonError: null }) }
function removeRow(i: number) {
  if (formRows.value.length > 1) formRows.value.splice(i, 1)
  else formRows.value[0] = { key: '', value: '', valueMode: 'scalar', jsonError: null }
}

// ── Propagation: sibling list ──
const propOpen = ref(false)
const includeProd = ref(false)
const siblings = ref<string[]>([])
const siblingsLoading = ref(false)
const siblingsError = ref<string | null>(null)
const selectedSiblings = ref<Set<string>>(new Set())
const customPropPaths = ref<string[]>([])
const customPropInput = ref('')

async function loadSiblings() {
  siblingsLoading.value = true
  siblingsError.value = null
  try {
    const parts = fullPath.value.split('/').filter(Boolean)
    let discovered: string[] = []

    if (parts.length >= 3) {
      // Project-level: list parts[0] to get BU folders, reconstruct sibling paths
      const projectRoot = parts[0]
      const currentBu = parts[1]
      const restPath = parts.slice(2).join('/')
      const params = new URLSearchParams({ path: projectRoot, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/list?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const buFolders = (json.keys as string[]).filter((k: string) => k.endsWith('/')).map((k: string) => k.replace(/\/$/, ''))
      discovered = buFolders.filter(bu => bu !== currentBu).map(bu => `${projectRoot}/${bu}/${restPath}`)
    } else {
      // Fallback: siblings at parent level
      const parentPath = parts.slice(0, -1).join('/')
      const params = new URLSearchParams({ path: parentPath, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/list?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const keys: string[] = (json.keys ?? []).filter((k: string) => !k.endsWith('/'))
      const prefix = parts.slice(0, -1).length > 0 ? `${parts.slice(0, -1).join('/')}/` : ''
      discovered = keys.map(k => `${prefix}${k}`).filter(p => p !== fullPath.value)
    }

    const customs = customPropPaths.value.filter(p => !discovered.includes(p) && p !== fullPath.value)
    const all = [...discovered, ...customs]
    siblings.value = all
    selectedSiblings.value = new Set(all.filter(p => !pathIsProd(p)))
  } catch (e: unknown) {
    siblingsError.value = e instanceof Error ? e.message : t('createSecretModal.propagateLoadError')
    siblings.value = []
  } finally {
    siblingsLoading.value = false
  }
}

function addCustomPropPath() {
  const p = customPropInput.value.trim().replace(/^\/+|\/+$/g, '')
  if (!p || customPropPaths.value.includes(p) || siblings.value.includes(p) || p === fullPath.value) return
  customPropPaths.value.push(p)
  siblings.value = [...siblings.value, p]
  if (!pathIsProd(p)) selectedSiblings.value = new Set([...selectedSiblings.value, p])
  customPropInput.value = ''
}

function togglePropOpen() {
  propOpen.value = !propOpen.value
  if (propOpen.value && siblings.value.length === 0 && fullPath.value) loadSiblings()
}

const filteredSiblings = computed(() =>
  includeProd.value ? siblings.value : siblings.value.filter(p => !pathIsProd(p))
)

const activePropCount = computed(() =>
  [...selectedSiblings.value].filter(p => filteredSiblings.value.includes(p)).length
)

function toggleSibling(path: string) {
  const next = new Set(selectedSiblings.value)
  next.has(path) ? next.delete(path) : next.add(path)
  selectedSiblings.value = next
}
function selectAllSiblings() { selectedSiblings.value = new Set(filteredSiblings.value) }
function deselectAllSiblings() { selectedSiblings.value = new Set() }

// ── Propagation: conflict scan + write ──
type SiblingStatus = {
  path: string
  conflictKeys: string[]
  data: Record<string, string> | null
  writeResult: 'pending' | 'ok' | 'error'
  error?: string
}
type PropView = 'scanning' | 'diff' | 'results'

const propView = ref<PropView | null>(null)
const siblingStatuses = ref<SiblingStatus[]>([])
const cleanSiblings = computed(() => siblingStatuses.value.filter(s => s.conflictKeys.length === 0))
const conflictSiblings = computed(() => siblingStatuses.value.filter(s => s.conflictKeys.length > 0))
const selectedClean = ref<Set<string>>(new Set())
const propagatedKeys = computed(() => Object.entries(parsedData.value ?? {}))

async function fetchSecretData(path: string): Promise<Record<string, string> | null> {
  try {
    const params = new URLSearchParams({ path, mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/read?${params}`)
    if (!res.ok) return null
    const json = await res.json()
    return (json.data ?? null) as Record<string, string> | null
  } catch { return null }
}

async function runConflictScan() {
  const targets = [...selectedSiblings.value].filter(p => filteredSiblings.value.includes(p))
  if (targets.length === 0) { emit('close'); return }
  siblingStatuses.value = targets.map(p => ({ path: p, conflictKeys: [], data: null, writeResult: 'pending' }))
  propView.value = 'scanning'
  const newKeys = Object.keys(parsedData.value ?? {})
  await Promise.all(
    siblingStatuses.value.map(async (s) => {
      const data = await fetchSecretData(s.path)
      s.data = data
      s.conflictKeys = data ? newKeys.filter(k => k in data) : []
    })
  )
  propView.value = 'diff'
  selectedClean.value = new Set(cleanSiblings.value.map(s => s.path))
}

function toggleClean(path: string) {
  const next = new Set(selectedClean.value)
  next.has(path) ? next.delete(path) : next.add(path)
  selectedClean.value = next
}

async function applyPropagation() {
  const newData = parsedData.value ?? {}
  propView.value = 'results'
  await Promise.all(
    cleanSiblings.value
      .filter(s => selectedClean.value.has(s.path))
      .map(async (s) => {
        try {
          const merged = { ...(s.data ?? {}), ...newData }
          await vault.writeSecret(s.path, merged as Record<string, string>)
          s.writeResult = 'ok'
        } catch (e: unknown) {
          s.writeResult = 'error'
          s.error = e instanceof Error ? e.message : 'Error'
        }
      })
  )
}

function openCompare(sibling: SiblingStatus) {
  emit('open-compare', { source: fullPath.value, target: sibling.path })
}

// ── Primary write ──
function requestPreview() {
  pathError.value = null
  jsonError.value = null
  saveError.value = null
  if (!fullPath.value) { pathError.value = t('createSecretModal.pathRequired'); return }
  if (mode.value === 'json') {
    try {
      const parsed = JSON.parse(jsonInput.value)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('createSecretModal.jsonMustBeObject'))
    } catch (e: unknown) {
      jsonError.value = e instanceof Error ? e.message : t('createSecretModal.jsonMustBeObject')
      return
    }
  } else {
    if (!formRows.value.some(r => r.key.trim())) { jsonError.value = t('createSecretModal.addAtLeastOneKey'); return }
    if (formRows.value.some(r => r.key.trim() && r.valueMode === 'json' && r.jsonError)) {
      jsonError.value = t('createSecretModal.invalidJsonInRow'); return
    }
  }
  showConfirm.value = true
}

async function confirmCreate() {
  showConfirm.value = false
  if (!parsedData.value) return
  saving.value = true
  saveError.value = null
  try {
    await vault.writeSecret(fullPath.value, parsedData.value)
    const hasPropagation = propOpen.value && activePropCount.value > 0
    await vault.listPath(vault.currentPath)
    if (hasPropagation) {
      saving.value = false
      await runConflictScan()
    } else {
      emit('close')
    }
  } catch (e: unknown) {
    saveError.value = e instanceof Error ? e.message : t('createSecretModal.createError')
    saving.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="!propView ? emit('close') : undefined"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl light:bg-white light:border-gray-200">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 light:border-gray-200">
        <div class="flex items-center gap-2">
          <span class="text-white font-semibold text-sm light:text-black">{{ t('createSecretModal.title') }}</span>
          <button
            v-if="!propView && !loadingPaths"
            type="button"
            class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold transition"
            :class="showHowTo ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-300 border border-gray-600 hover:border-gray-400 light:text-gray-400 light:hover:text-gray-600 light:border-gray-300'"
            :title="t('createSecretModal.howToTitle')"
            @click="showHowTo = !showHowTo"
          >i</button>
        </div>
        <button
          v-if="!propView || propView === 'results'"
          class="text-gray-500 hover:text-gray-300 light:hover:text-gray-700"
          @click="emit('close')"
        >✕</button>
      </div>

      <div class="overflow-auto flex-1 px-5 py-4 space-y-4">

        <!-- ── SCANNING ── -->
        <div v-if="propView === 'scanning'" class="flex flex-col items-center py-10 gap-3">
          <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span class="text-gray-400 text-sm">{{ t('createSecretModal.propagateScanTitle') }}</span>
        </div>

        <!-- ── DIFF VIEW ── -->
        <div v-else-if="propView === 'diff'" class="space-y-4">
          <!-- Propagated keys table -->
          <div>
            <div class="text-xs text-gray-400 mb-2 light:text-gray-600">{{ t('createSecretModal.propagateDiffTitle') }}</div>
            <div class="border border-gray-700 rounded overflow-hidden light:border-gray-200">
              <table class="w-full text-xs font-mono table-fixed">
                <thead>
                  <tr class="text-gray-500 text-left border-b border-gray-700 uppercase light:border-gray-200 light:text-gray-400">
                    <th class="px-3 py-1.5 w-[45%]">{{ t('createSecretModal.keyColumn') }}</th>
                    <th class="px-3 py-1.5">{{ t('createSecretModal.valueColumn') }}</th>
                    <th class="px-3 py-1.5 w-4 text-right">+</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="[key, value] in propagatedKeys"
                    :key="key"
                    class="border-b border-gray-800 last:border-0 bg-green-950 text-green-300 light:bg-green-50 light:text-green-800 light:border-gray-200"
                  >
                    <td class="px-3 py-1.5 font-semibold truncate">{{ key }}</td>
                    <td class="px-3 py-1.5 break-all opacity-90">{{ value }}</td>
                    <td class="px-3 py-1.5 text-right opacity-50">+</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Clean siblings -->
          <div v-if="cleanSiblings.length > 0">
            <div class="text-xs text-gray-400 mb-2 light:text-gray-600">{{ t('createSecretModal.propagateToClean', { n: cleanSiblings.length }) }}</div>
            <div class="space-y-1">
              <div
                v-for="s in cleanSiblings"
                :key="s.path"
                class="flex items-center gap-2 cursor-pointer px-3 py-1.5 rounded border border-gray-700 hover:border-gray-600 transition light:border-gray-300 light:hover:border-gray-400"
                @click="toggleClean(s.path)"
              >
                <span
                  class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs"
                  :class="selectedClean.has(s.path) ? 'bg-green-600 border-green-500' : 'border-gray-600 bg-gray-800 light:bg-white light:border-gray-300'"
                ><span v-if="selectedClean.has(s.path)">✓</span></span>
                <span class="text-xs font-mono text-gray-300 light:text-gray-700">{{ s.path }}</span>
              </div>
            </div>
          </div>

          <!-- Conflict siblings -->
          <div v-if="conflictSiblings.length > 0" class="space-y-1">
            <div class="text-xs text-amber-400 mb-2 light:text-amber-600">{{ t('createSecretModal.propagateConflictTitle') }}</div>
            <div
              v-for="s in conflictSiblings"
              :key="s.path"
              class="flex items-center justify-between gap-2 px-3 py-2 rounded border border-amber-800/50 bg-amber-950/30 light:border-amber-300 light:bg-amber-50"
            >
              <div class="min-w-0">
                <div class="text-xs font-mono text-amber-300 truncate light:text-amber-700">{{ s.path }}</div>
                <div class="text-[11px] text-amber-500/70 mt-0.5 light:text-amber-600">{{ t('createSecretModal.propagateConflictKeys', { keys: s.conflictKeys.join(', ') }) }}</div>
              </div>
              <button
                type="button"
                class="shrink-0 text-xs px-2 py-1 bg-amber-900/50 hover:bg-amber-800/70 text-amber-300 border border-amber-700 rounded transition"
                @click="openCompare(s)"
              >{{ t('createSecretModal.propagateReplaceAction') }}</button>
            </div>
          </div>

          <div v-if="cleanSiblings.length === 0 && conflictSiblings.length === 0" class="text-gray-500 text-sm text-center py-4 light:text-gray-400">
            {{ t('createSecretModal.propagateNoSiblings') }}
          </div>
        </div>

        <!-- ── RESULTS VIEW ── -->
        <div v-else-if="propView === 'results'" class="space-y-2">
          <div class="text-xs text-gray-400 mb-3 light:text-gray-600">{{ t('createSecretModal.propagateResultsTitle') }}</div>
          <div
            v-for="s in siblingStatuses.filter(s => selectedClean.has(s.path))"
            :key="s.path"
            class="flex items-center justify-between px-3 py-2 rounded border text-xs font-mono"
            :class="s.writeResult === 'ok'
              ? 'border-green-800 bg-green-950/30 light:border-green-300 light:bg-green-50'
              : s.writeResult === 'error'
              ? 'border-red-800 bg-red-950/30 light:border-red-300 light:bg-red-50'
              : 'border-gray-700 bg-gray-800/20'"
          >
            <span :class="s.writeResult === 'ok' ? 'text-green-300 light:text-green-700' : s.writeResult === 'error' ? 'text-red-300 light:text-red-700' : 'text-gray-400'">
              {{ s.path }}
            </span>
            <span v-if="s.writeResult === 'ok'" class="text-green-400 shrink-0 light:text-green-600">✓ {{ t('createSecretModal.propagateSuccess') }}</span>
            <span v-else-if="s.writeResult === 'error'" class="text-red-400 shrink-0 light:text-red-600" :title="s.error">✕ {{ t('createSecretModal.propagateError') }}</span>
            <span v-else class="text-gray-600 shrink-0">…</span>
          </div>
        </div>

        <!-- ── FORM VIEW ── -->
        <template v-else>

          <!-- Loading state: spinner + how-to -->
          <div v-if="loadingPaths" class="flex flex-col items-center py-8 gap-6">
            <div class="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin"></div>
            <div class="w-full space-y-3 text-xs text-gray-500 light:text-gray-500">
              <div class="border border-gray-700 rounded-lg px-4 py-3 space-y-2.5 light:border-gray-200">
                <p class="text-gray-400 font-medium light:text-gray-600">{{ t('createSecretModal.howToTitle') }}</p>
                <div class="flex items-start gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">1</span>
                  <span class="light:text-gray-500">{{ t('createSecretModal.howToStep1') }}</span>
                </div>
                <div class="flex items-start gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">2</span>
                  <span class="light:text-gray-500">{{ t('createSecretModal.howToStep2') }}</span>
                </div>
                <div class="flex items-start gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">3</span>
                  <span class="light:text-gray-500">{{ t('createSecretModal.howToStep3') }}</span>
                </div>
                <div class="flex items-start gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">4</span>
                  <span class="light:text-gray-500">{{ t('createSecretModal.howToStep4') }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Path selector (shown once paths are loaded) -->
          <template v-else>

          <!-- How-to card (toggled via ℹ icon) -->
          <div v-if="showHowTo" class="border border-blue-800/50 bg-blue-950/20 rounded-lg px-4 py-3 space-y-2.5 text-xs text-gray-400 light:border-blue-200 light:bg-blue-50 light:text-gray-500">
            <div class="flex items-center justify-between">
              <p class="text-blue-300 font-medium light:text-blue-700">{{ t('createSecretModal.howToTitle') }}</p>
              <button type="button" class="text-gray-600 hover:text-gray-400 light:text-gray-400 light:hover:text-gray-600" @click="showHowTo = false">✕</button>
            </div>
            <div class="flex items-start gap-2">
              <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">1</span>
              <span>{{ t('createSecretModal.howToStep1') }}</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">2</span>
              <span>{{ t('createSecretModal.howToStep2') }}</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">3</span>
              <span>{{ t('createSecretModal.howToStep3') }}</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">4</span>
              <span>{{ t('createSecretModal.howToStep4') }}</span>
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="text-gray-400 text-xs light:text-gray-600">{{ t('createSecretModal.pathLabel') }}</label>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="px-2 py-0.5 rounded-full border text-xs font-medium transition cursor-pointer"
                  :class="includePathProd ? 'bg-red-900/60 text-red-300 border-red-700 hover:bg-red-900' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200 light:bg-gray-100 light:border-gray-300 light:text-gray-600 light:hover:bg-gray-200'"
                  @click="includePathProd = !includePathProd"
                >{{ includePathProd ? t('createSecretModal.propagateIncludeProd') : t('createSecretModal.propagateExcludeProd') }}</button>
                <span v-if="!loadingPaths && availablePaths.length" class="text-gray-600 text-xs light:text-gray-500">{{ filteredAvailablePaths.length }}/{{ availablePaths.length }}</span>
              </div>
            </div>

            <div v-if="pathsError" class="text-amber-400 text-xs px-2 py-1.5 bg-amber-950/40 border border-amber-800/50 rounded light:bg-amber-50 light:border-amber-300 light:text-amber-700">
              ⚠ {{ pathsError }}
            </div>

            <!-- Select from existing -->
            <div v-if="pathMode === 'select'" class="space-y-1.5">
              <div class="flex gap-2">
                <select
                  v-model="selectedExistingPath"
                  :disabled="loadingPaths"
                  class="flex-1 px-3 py-2 bg-gray-950 border text-green-300 font-mono rounded text-xs focus:outline-none focus:border-green-600 disabled:opacity-50 light:bg-white light:text-green-700"
                  :class="pathError ? 'border-red-600' : 'border-gray-700 light:border-gray-300'"
                  @change="pathError = null"
                >
                  <option value="" disabled>{{ loadingPaths ? t('createSecretModal.loadingPaths') : t('createSecretModal.selectPath') }}</option>
                  <option v-for="path in filteredAvailablePaths" :key="path" :value="path">{{ path }}</option>
                </select>
                <button
                  type="button"
                  class="px-2.5 py-2 text-sm bg-gray-800 border border-gray-700 text-gray-400 rounded hover:bg-gray-700 transition light:bg-gray-100 light:border-gray-300 light:text-gray-600 light:hover:bg-gray-200"
                  :disabled="loadingPaths"
                  :title="t('createSecretModal.refreshPaths')"
                  @click="loadAvailablePaths"
                >🔄</button>
                <button
                  v-if="selectedExistingPath"
                  type="button"
                  class="px-2.5 py-2 text-sm bg-gray-800 border border-gray-700 text-gray-400 rounded hover:bg-gray-700 hover:text-gray-200 transition light:bg-gray-100 light:border-gray-300 light:text-gray-600 light:hover:bg-gray-200"
                  :disabled="pathPreviewLoading"
                  :title="t('createSecretModal.pathPreviewToggle')"
                  @click="togglePathExpand"
                >
                  <svg v-if="pathPreviewLoading" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 animate-spin"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                  <svg v-else-if="pathExpanded" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                </button>
              </div>

              <!-- Path preview panel -->
              <div v-if="pathExpanded && pathPreviewData" class="border border-gray-700 rounded overflow-hidden light:border-gray-200">
                <div class="flex items-center justify-between px-3 py-1.5 bg-gray-800/60 border-b border-gray-700 light:bg-gray-50 light:border-gray-200">
                  <span class="text-xs text-gray-500 font-mono light:text-gray-500">{{ Object.keys(pathPreviewData).length }} {{ t('createSecretModal.pathPreviewKeys') }}</span>
                  <button
                    type="button"
                    class="text-xs text-gray-500 hover:text-gray-300 transition light:text-gray-600 light:hover:text-gray-800"
                    @click="pathRevealAll = !pathRevealAll"
                  >{{ pathRevealAll ? t('createSecretModal.pathHideAll') : t('createSecretModal.pathRevealAll') }}</button>
                </div>
                <div v-if="Object.keys(pathPreviewData).length === 0" class="px-3 py-3 text-xs text-gray-600 text-center light:text-gray-400">
                  {{ t('createSecretModal.pathPreviewEmpty') }}
                </div>
                <table v-else class="w-full text-xs font-mono table-fixed">
                  <tbody>
                    <template v-for="[key, value] in Object.entries(pathPreviewData)" :key="key">
                      <NestedJsonField
                        v-if="parseJsonValue(value).isNested"
                        :value="parseJsonValue(value).parsed"
                        :key-name="key"
                        :depth="0"
                        :editing-allowed="false"
                      />
                      <tr
                        v-else
                        class="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 transition light:border-gray-100 light:hover:bg-gray-50"
                      >
                        <td class="px-3 py-1.5 w-[40%] text-blue-300 font-semibold truncate light:text-blue-700" :title="key">{{ key }}</td>
                        <td class="px-3 py-1.5 text-gray-300 break-all light:text-gray-700">
                          <span v-if="pathRevealAll">{{ value }}</span>
                          <span v-else class="text-gray-600 select-none tracking-widest light:text-gray-400">••••••••</span>
                        </td>
                        <td class="px-3 py-1.5 w-8 text-right">
                          <button
                            type="button"
                            class="transition"
                            :class="pathCopiedKey === key ? 'text-green-400 light:text-green-600' : 'text-gray-600 hover:text-gray-300 light:text-gray-400 light:hover:text-gray-600'"
                            :title="t('createSecretModal.copyValue')"
                            @click="copyPathKey(key, String(value))"
                          >
                            <svg v-if="pathCopiedKey === key" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                            <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
                          </button>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                class="text-xs text-blue-400 hover:text-blue-300 transition light:text-blue-600 light:hover:text-blue-800"
                @click="pathMode = 'new'; newPath = ''; pathError = null"
              >{{ t('createSecretModal.pathNewEntry') }}</button>
            </div>

            <!-- New path input -->
            <div v-else class="space-y-1.5">
              <!-- Base path select (reuses loaded list + root option) -->
              <select
                v-model="newBase"
                class="w-full px-3 py-2 bg-gray-950 border border-gray-700 text-gray-400 font-mono rounded text-xs focus:outline-none focus:border-gray-500 light:bg-white light:border-gray-300 light:text-gray-600"
              >
                <option value="/">/ (racine)</option>
                <option v-for="path in filteredAvailablePaths" :key="path" :value="path">{{ path }}</option>
              </select>
              <!-- New leaf name -->
              <div
                class="flex items-center gap-1 bg-gray-950 border rounded px-3 py-2 focus-within:border-green-600 transition-colors light:bg-white"
                :class="pathError ? 'border-red-600' : 'border-gray-700 light:border-gray-300'"
              >
                <span v-if="newBase !== '/'" class="text-gray-600 text-xs font-mono shrink-0 select-none light:text-gray-500">{{ newBase }}/</span>
                <input
                  v-model="newPath"
                  :placeholder="t('createSecretModal.newPathPlaceholder')"
                  class="flex-1 bg-transparent text-green-300 font-mono text-xs focus:outline-none placeholder-gray-700 light:text-green-700 light:placeholder-gray-400"
                  @keydown.enter="requestPreview"
                />
              </div>
              <button
                type="button"
                class="text-xs text-gray-500 hover:text-gray-300 transition light:text-gray-600 light:hover:text-gray-800"
                @click="pathMode = 'select'; selectedExistingPath = ''; pathError = null"
              >{{ t('createSecretModal.pathBackToSelect') }}</button>
            </div>

            <p v-if="pathError" class="text-red-400 text-xs">⚠ {{ pathError }}</p>
            <p v-else-if="fullPath" class="text-gray-600 text-xs font-mono light:text-gray-500">→ {{ fullPath }}</p>
          </div>

          <!-- Mode selector -->
          <div class="flex gap-1 p-0.5 bg-gray-800 rounded w-fit light:bg-gray-200">
            <button
              type="button"
              class="px-3 py-1 text-xs rounded transition"
              :class="mode === 'form' ? 'bg-gray-600 text-white light:bg-white light:text-gray-900' : 'text-gray-500 hover:text-gray-300 light:text-gray-600 light:hover:text-gray-800'"
              @click="switchMode('form')"
            >{{ t('createSecretModal.modeForm') }}</button>
            <button
              type="button"
              class="px-3 py-1 text-xs rounded transition"
              :class="mode === 'json' ? 'bg-gray-600 text-white light:bg-white light:text-gray-900' : 'text-gray-500 hover:text-gray-300 light:text-gray-600 light:hover:text-gray-800'"
              @click="switchMode('json')"
            >{{ t('createSecretModal.modeJson') }}</button>
          </div>

          <!-- Form mode rows -->
          <div v-if="mode === 'form'" class="space-y-2">
            <div class="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs text-gray-600 px-1 light:text-gray-500">
              <span>{{ t('createSecretModal.keyColumn') }}</span>
              <span>{{ t('createSecretModal.valueColumn') }}</span>
              <span></span>
            </div>
            <div v-for="(row, i) in formRows" :key="i" class="space-y-0.5">
              <div class="grid grid-cols-[1fr_2fr_auto] gap-2 items-start">
                <input
                  v-model="row.key"
                  :placeholder="t('createSecretModal.keyPlaceholder')"
                  class="px-2 py-1.5 bg-gray-950 border border-gray-700 text-blue-300 font-mono text-xs rounded focus:outline-none focus:border-blue-700 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-blue-700 light:placeholder-gray-400"
                />
                <div class="flex gap-1 items-start">
                  <textarea
                    v-if="row.valueMode === 'json'"
                    v-model="row.value"
                    rows="3"
                    spellcheck="false"
                    placeholder='{"key": "value"}'
                    class="flex-1 px-2 py-1.5 bg-gray-950 font-mono text-xs rounded focus:outline-none resize-y placeholder-gray-700 light:bg-white light:placeholder-gray-400"
                    :class="row.jsonError ? 'border border-red-600 text-red-300 light:text-red-700' : 'border border-gray-700 text-gray-300 focus:border-gray-500 light:border-gray-300 light:text-gray-700'"
                    @blur="validateJsonRow(row)"
                  />
                  <input
                    v-else
                    v-model="row.value"
                    :placeholder="t('createSecretModal.valuePlaceholder')"
                    class="flex-1 px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-300 font-mono text-xs rounded focus:outline-none focus:border-gray-500 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-gray-700 light:placeholder-gray-400"
                    @keydown.enter="requestPreview"
                  />
                  <button
                    type="button"
                    class="shrink-0 px-1.5 py-1 text-[10px] rounded border transition font-mono"
                    :class="row.valueMode === 'json'
                      ? 'border-blue-600 bg-blue-900/40 text-blue-300 hover:bg-blue-800/60 light:bg-blue-50 light:border-blue-400 light:text-blue-700'
                      : 'border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-300 light:border-gray-300 light:text-gray-500 light:hover:text-gray-700'"
                    :title="row.valueMode === 'scalar' ? t('createSecretModal.valueToggleJson') : t('createSecretModal.valueToggleScalar')"
                    @click="toggleRowMode(row)"
                  >{{ row.valueMode === 'json' ? 'Aa' : '{ }' }}</button>
                </div>
                <button
                  type="button"
                  class="text-gray-700 hover:text-red-400 transition text-sm w-6 text-center mt-1.5 light:text-gray-400 light:hover:text-red-600"
                  @click="removeRow(i)"
                >✕</button>
              </div>
              <p v-if="row.jsonError" class="text-red-400 text-[11px]">⚠ {{ row.jsonError }}</p>
            </div>
            <button
              type="button"
              class="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition mt-1 light:text-gray-600 light:hover:text-gray-800"
              @click="addRow"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {{ t('createSecretModal.addKey') }}
            </button>
          </div>

          <!-- JSON mode -->
          <div v-else>
            <textarea
              v-model="jsonInput"
              class="w-full h-64 bg-gray-950 border border-gray-700 text-green-300 font-mono text-xs rounded p-3 resize-y focus:outline-none focus:border-green-600 light:bg-gray-50 light:border-gray-300 light:text-green-800"
              spellcheck="false"
              autocomplete="off"
            />
          </div>

          <!-- Errors -->
          <p v-if="jsonError" class="text-red-400 text-xs">⚠ {{ jsonError }}</p>
          <p v-if="saveError" class="text-red-400 text-xs">⚠ {{ saveError }}</p>

          <!-- Propagation collapsible (only when path is set) -->
          <div v-if="fullPath" class="border border-gray-700 rounded light:border-gray-200">
            <button
              type="button"
              class="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition light:text-gray-600 light:hover:text-gray-800"
              @click="togglePropOpen"
            >
              <span class="flex items-center gap-2">
                <span>{{ t('createSecretModal.propagateSection') }}</span>
                <span
                  v-if="activePropCount > 0"
                  class="px-1.5 py-0.5 rounded-full bg-blue-900 text-blue-300 text-[10px] font-medium light:bg-blue-100 light:text-blue-700"
                >{{ activePropCount }}</span>
              </span>
              <span class="text-gray-600">{{ propOpen ? '▲' : '▼' }}</span>
            </button>

            <div v-if="propOpen" class="border-t border-gray-700 px-3 py-3 space-y-3 light:border-gray-200">
              <!-- Controls row -->
              <div class="flex items-center justify-between flex-wrap gap-2">
                <button
                  type="button"
                  class="px-2 py-0.5 rounded-full border text-xs font-medium transition cursor-pointer"
                  :class="includeProd
                    ? 'bg-red-900/60 text-red-300 border-red-700 hover:bg-red-900'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200 light:bg-gray-100 light:border-gray-300 light:text-gray-600 light:hover:bg-gray-200'"
                  @click="includeProd = !includeProd"
                >{{ includeProd ? t('createSecretModal.propagateIncludeProd') : t('createSecretModal.propagateExcludeProd') }}</button>

                <div class="flex items-center gap-3">
                  <button type="button" class="text-xs text-gray-500 hover:text-gray-200 transition light:text-gray-600 light:hover:text-gray-800" @click="selectAllSiblings">{{ t('createSecretModal.propagateSelectAll') }}</button>
                  <button type="button" class="text-xs text-gray-500 hover:text-gray-200 transition light:text-gray-600 light:hover:text-gray-800" @click="deselectAllSiblings">{{ t('createSecretModal.propagateDeselectAll') }}</button>
                  <button type="button" class="text-xs text-gray-500 hover:text-gray-200 transition light:text-gray-600 light:hover:text-gray-800" :disabled="siblingsLoading" @click="loadSiblings" title="Actualiser">🔄</button>
                </div>
              </div>

              <div v-if="siblingsLoading" class="text-gray-500 text-xs text-center py-2">{{ t('createSecretModal.propagateScanTitle') }}</div>
              <div v-else-if="siblingsError" class="text-amber-400 text-xs px-2 py-1.5 bg-amber-950/40 border border-amber-800/50 rounded light:bg-amber-50 light:border-amber-300 light:text-amber-700">
                ⚠ {{ siblingsError }}
              </div>
              <div v-else-if="filteredSiblings.length === 0" class="text-gray-600 text-xs text-center py-2 light:text-gray-400">
                {{ t('createSecretModal.propagateNoSiblings') }}
              </div>
              <div v-else class="space-y-1 max-h-40 overflow-y-auto">
                <div
                  v-for="path in filteredSiblings"
                  :key="path"
                  class="flex items-center gap-2 cursor-pointer px-2 py-1 rounded hover:bg-gray-800 transition light:hover:bg-gray-100"
                  @click="toggleSibling(path)"
                >
                  <span
                    class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs"
                    :class="selectedSiblings.has(path) ? 'bg-blue-600 border-blue-500' : 'border-gray-600 bg-gray-800 light:bg-white light:border-gray-300'"
                  ><span v-if="selectedSiblings.has(path)">✓</span></span>
                  <span
                    class="text-xs font-mono truncate"
                    :class="pathIsProd(path) ? 'text-amber-400 light:text-amber-600' : 'text-gray-300 light:text-gray-700'"
                  >{{ path }}</span>
                  <span v-if="pathIsProd(path)" class="text-[10px] text-amber-600/70 shrink-0 light:text-amber-500">prod</span>
                </div>
              </div>

              <!-- Custom path input -->
              <div class="flex gap-1 mt-2">
                <input
                  v-model="customPropInput"
                  :placeholder="t('createSecretModal.propagateCustomPathPlaceholder')"
                  class="flex-1 px-2 py-1 bg-gray-950 border border-gray-700 text-gray-300 font-mono text-xs rounded focus:outline-none focus:border-gray-500 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-gray-700 light:placeholder-gray-400"
                  @keydown.enter.prevent="addCustomPropPath"
                />
                <button
                  type="button"
                  class="px-2 py-1 text-xs bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700 transition light:bg-gray-100 light:border-gray-300 light:text-gray-700 light:hover:bg-gray-200"
                  @click="addCustomPropPath"
                >{{ t('createSecretModal.propagateCustomPathAdd') }}</button>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 pt-1">
            <button
              class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded transition disabled:opacity-50"
              :disabled="saving"
              @click="requestPreview"
            >{{ saving ? t('createSecretModal.creating') : t('createSecretModal.preview') }}</button>
            <button
              class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition light:text-gray-600 light:hover:text-gray-800 light:border-gray-300"
              @click="emit('close')"
            >{{ t('createSecretModal.cancel') }}</button>
          </div>

          </template><!-- end v-else (paths loaded) -->
        </template><!-- end form view -->
      </div>

      <!-- Footer for diff view -->
      <div
        v-if="propView === 'diff'"
        class="px-5 py-3 border-t border-gray-700 flex items-center justify-between shrink-0 light:border-gray-200"
      >
        <span class="text-xs text-gray-500 light:text-gray-400">
          {{ cleanSiblings.length > 0 ? t('createSecretModal.propagateToClean', { n: cleanSiblings.length }) : '' }}
        </span>
        <div class="flex gap-2">
          <button
            v-if="cleanSiblings.length > 0"
            class="text-sm px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded font-semibold disabled:opacity-40 transition"
            :disabled="selectedClean.size === 0"
            @click="applyPropagation"
          >{{ t('createSecretModal.propagateConfirm', { n: selectedClean.size }) }}</button>
          <button
            class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
            @click="emit('close')"
          >{{ t('createSecretModal.cancel') }}</button>
        </div>
      </div>

      <!-- Footer for results view -->
      <div
        v-else-if="propView === 'results'"
        class="px-5 py-3 border-t border-gray-700 flex justify-end shrink-0 light:border-gray-200"
      >
        <button
          class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
          @click="emit('close')"
        >{{ t('createSecretModal.close') }}</button>
      </div>

    </div>
  </div>

  <ConfirmDiffModal
    v-if="showConfirm && parsedData"
    :path="fullPath"
    :before="{}"
    :after="parsedData"
    @confirm="confirmCreate"
    @cancel="showConfirm = false"
  />
</template>

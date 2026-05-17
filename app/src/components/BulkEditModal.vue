<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'

const { t } = useI18n()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

// ---- Available paths ----
const availablePaths = ref<string[]>([])
const selectedPath = ref<string>('')
const loadingPaths = ref(true)   // true on mount so spinner shows before first fetch
const pathsError = ref<string | null>(null)
const selectedPreset = ref<string>('all')
const loadingSelectedPathJson = ref(false)

const PROD_NAMES = new Set(['prod', 'production', 'prd'])
function pathIsProd(path: string): boolean {
  return path.split('/').slice(1).some(s => PROD_NAMES.has(s.toLowerCase()))
}
const includeProd = ref(false)
const selectedPathJsonError = ref<string | null>(null)
let selectedPathRequestId = 0

type PathPreset = {
  id: string
  label: string
  match: (path: string) => boolean
}

// Palette rotated by index for dynamic presets (index 0 = "Tous")
const ACTIVE_COLORS = [
  'bg-indigo-600 text-white border-indigo-500',   // 0 — Tous
  'bg-blue-600 text-white border-blue-500',
  'bg-emerald-600 text-white border-emerald-500',
  'bg-amber-600 text-white border-amber-500',
  'bg-cyan-600 text-white border-cyan-500',
  'bg-fuchsia-600 text-white border-fuchsia-500',
  'bg-violet-600 text-white border-violet-500',
  'bg-rose-600 text-white border-rose-500',
  'bg-teal-600 text-white border-teal-500',
  'bg-orange-600 text-white border-orange-500',
]

// Presets derived from the actual first path segment of loaded paths — works for any namespace
const dynamicPresets = computed<PathPreset[]>(() => {
  const segments = [...new Set(
    availablePaths.value.map(p => p.split('/')[0]).filter(Boolean)
  )].sort()
  return [
    { id: 'all', label: 'Tous', match: () => true },
    ...segments.map(seg => ({
      id: seg,
      label: seg,
      match: (path: string) => path === seg || path.startsWith(seg + '/'),
    })),
  ]
})

const presetOptions = computed(() =>
  dynamicPresets.value.map((preset) => ({
    ...preset,
    count: availablePaths.value.filter((p) => {
      if (!includeProd.value && pathIsProd(p)) return false
      return preset.match(p)
    }).length,
  }))
)

const filteredPaths = computed(() => {
  const current = dynamicPresets.value.find((p) => p.id === selectedPreset.value) ?? dynamicPresets.value[0]
  return availablePaths.value.filter((path) => {
    if (!includeProd.value && pathIsProd(path)) return false
    return current.match(path)
  })
})

function presetBadgeClass(presetId: string): string {
  if (selectedPreset.value === presetId) {
    const idx = dynamicPresets.value.findIndex(p => p.id === presetId)
    return ACTIVE_COLORS[idx % ACTIVE_COLORS.length]
  }
  return 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:text-white'
}

async function loadAvailablePaths() {
  loadingPaths.value = true
  pathsError.value = null
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      availablePaths.value = []
      selectedPath.value = ''
      pathsError.value = (err as { error?: string }).error ?? `HTTP ${res.status}`
      return
    }

    const payload = await res.json()
    const rawMap =
      payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
        ? payload.data
        : payload
    const keys = rawMap && typeof rawMap === 'object' ? Object.keys(rawMap as Record<string, unknown>).sort() : []

    availablePaths.value = keys
    if (availablePaths.value.length > 0) {
      selectedPath.value = availablePaths.value[0]
    } else {
      selectedPath.value = ''
      pathsError.value = t('bulkEditModal.noPathsAvailable')
    }
  } catch (e: unknown) {
    availablePaths.value = []
    selectedPath.value = ''
    pathsError.value = e instanceof Error ? e.message : t('bulkEditModal.noPathsAvailable')
  }
  loadingPaths.value = false
}

function defaultBulkJson(): string {
  return JSON.stringify(
    { 'your/path/here': { KEY_ONE: 'value1', KEY_TWO: 'value2' } },
    null,
    2
  )
}

function toStringRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)]))
}

function buildBulkJson(path: string, data: Record<string, string>): string {
  return JSON.stringify({ [path]: data }, null, 2)
}

async function loadSelectedPathJson(path: string) {
  if (!path) {
    bulkJson.value = defaultBulkJson()
    selectedPathJsonError.value = null
    return
  }

  const requestId = ++selectedPathRequestId
  loadingSelectedPathJson.value = true
  selectedPathJsonError.value = null
  try {
    const params = new URLSearchParams({ path, mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/read?${params}`)

    if (requestId !== selectedPathRequestId) return

    if (res.status === 404) {
      bulkJson.value = buildBulkJson(path, {})
      return
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      selectedPathJsonError.value = err.error ?? `HTTP ${res.status}`
      bulkJson.value = buildBulkJson(path, {})
      return
    }

    const payload = await res.json()
    const data = payload?.data && typeof payload.data === 'object'
      ? toStringRecord(payload.data as Record<string, unknown>)
      : {}
    bulkJson.value = buildBulkJson(path, data)
  } catch (e: unknown) {
    if (requestId !== selectedPathRequestId) return
    selectedPathJsonError.value = e instanceof Error ? e.message : t('bulkEditModal.loadingJson')
    bulkJson.value = buildBulkJson(path, {})
  } finally {
    if (requestId === selectedPathRequestId) {
      loadingSelectedPathJson.value = false
    }
  }
}

// ---- Input ----
const bulkJson = ref(defaultBulkJson())
const jsonError = ref<string | null>(null)
const previewLoading = ref(false)

// Watch for path selection changes
watch(selectedPath, async (path) => {
  await loadSelectedPathJson(path)
})

watch(selectedPreset, () => {
  selectedPath.value = filteredPaths.value.length > 0 ? filteredPaths.value[0] : ''
})

watch(availablePaths, () => {
  selectedPreset.value = 'all'
  includeProd.value = false
  selectedPath.value = filteredPaths.value.length > 0 ? filteredPaths.value[0] : ''
})

// Load available paths on mount
onMounted(() => {
  loadAvailablePaths()
})

// ---- Preview state ----
type PathDiff = {
  path: string
  before: Record<string, string>
  after: Record<string, string>
  fetchError?: string
}

const previews = ref<PathDiff[]>([])
const previewReady = ref(false)

// ---- Confirm state ----
const confirmIndex = ref<number | null>(null)
const applyResults = ref<{ path: string; ok: boolean; error?: string }[]>([])
const allApplied = ref(false)
const successMessage = ref<string | null>(null)

function parseBulk(): Record<string, Record<string, string>> | null {
  jsonError.value = null
  try {
    const parsed = JSON.parse(bulkJson.value)
    if (typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error(t('bulkEditModal.jsonMustBeObject'))
    for (const [path, data] of Object.entries(parsed)) {
      if (typeof data !== 'object' || Array.isArray(data))
        throw new Error(t('bulkEditModal.valueMustBeObject', { path }))
    }
    return parsed as Record<string, Record<string, string>>
  } catch (e: unknown) {
    jsonError.value = e instanceof Error ? e.message : t('bulkEditModal.jsonMustBeObject')
    return null
  }
}

async function preview() {
  const parsed = parseBulk()
  if (!parsed) return

  previewLoading.value = true
  previewReady.value = false
  previews.value = []
  applyResults.value = []
  allApplied.value = false

  const entries = Object.entries(parsed)
  const results: PathDiff[] = []

  for (const [path, afterData] of entries) {
    try {
      const params = new URLSearchParams({ path, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/read?${params}`)
      if (res.ok) {
        const json = await res.json()
        results.push({
          path,
          before: json.data ?? {},
          after: Object.fromEntries(Object.entries(afterData).map(([k, v]) => [k, String(v)])),
        })
      } else if (res.status === 404) {
        results.push({ path, before: {}, after: afterData })
      } else {
        const err = await res.json().catch(() => ({}))
        results.push({ path, before: {}, after: afterData, fetchError: err.error ?? `HTTP ${res.status}` })
      }
    } catch (e: unknown) {
      results.push({ path, before: {}, after: afterData, fetchError: e instanceof Error ? e.message : 'Network error' })
    }
  }

  previews.value = results
  previewReady.value = true
  previewLoading.value = false
}

// Confirm a single path
function startConfirm(index: number) {
  confirmIndex.value = index
}

async function confirmOne(index: number) {
  confirmIndex.value = null
  const entry = previews.value[index]
  try {
    await vault.writeSecret(entry.path, entry.after)
    applyResults.value.push({ path: entry.path, ok: true })
  } catch (e: unknown) {
    applyResults.value.push({ path: entry.path, ok: false, error: e instanceof Error ? e.message : t('bulkEditModal.applyAll') })
  }
  if (applyResults.value.length === previews.value.length) allApplied.value = true
}

// Apply all at once (show confirm for first with changes, then auto-apply rest)
const applyAllIndex = ref<number | null>(null)

async function applyAll() {
  applyResults.value = []
  allApplied.value = false
  // find first with changes
  const firstChanged = previews.value.findIndex((p) =>
    Object.keys(p.after).some((k) => p.before[k] !== p.after[k]) ||
    Object.keys(p.before).some((k) => !(k in p.after))
  )
  if (firstChanged === -1) return
  applyAllIndex.value = firstChanged
}

async function confirmApplyAll() {
  applyAllIndex.value = null
  for (const entry of previews.value) {
    try {
      await vault.writeSecret(entry.path, entry.after)
      applyResults.value.push({ path: entry.path, ok: true })
    } catch (e: unknown) {
      applyResults.value.push({ path: entry.path, ok: false, error: e instanceof Error ? e.message : t('bulkEditModal.applyAll') })
    }
  }
  allApplied.value = true

  // Show success notification
  const okCount = applyResults.value.filter(r => r.ok).length
  const errorCount = applyResults.value.filter(r => !r.ok).length
  successMessage.value = errorCount === 0 ? `✓ ${okCount}` : `✓ ${okCount} OK · ⚠ ${errorCount}`
  
  // Reset to JSON input after 2 seconds
  setTimeout(() => {
    previewReady.value = false
    previews.value = []
    applyResults.value = []
    allApplied.value = false
    successMessage.value = null
    loadSelectedPathJson(selectedPath.value)
  }, 2000)
}

const totalChanges = computed(() =>
  previews.value.filter((p) =>
    JSON.stringify(p.before) !== JSON.stringify(p.after)
  ).length
)

const confirmAllBefore = computed(() =>
  previews.value.reduce((acc, p) => ({ ...acc, ...Object.fromEntries(Object.entries(p.before).map(([k, v]) => [`${p.path} / ${k}`, v])) }), {} as Record<string, string>)
)
const confirmAllAfter = computed(() =>
  previews.value.reduce((acc, p) => ({ ...acc, ...Object.fromEntries(Object.entries(p.after).map(([k, v]) => [`${p.path} / ${k}`, v])) }), {} as Record<string, string>)
)

// Helper: determine row status for styling
function getRowStatus(entry: PathDiff, key: string) {
  if (!(key in entry.before) && key in entry.after) return 'added'
  if (key in entry.before && !(key in entry.after)) return 'removed'
  if (key in entry.before && key in entry.after && entry.before[key] !== entry.after[key]) return 'modified'
  return 'unchanged'
}
</script>

<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 light:bg-gray-50 border border-gray-700 light:border-gray-200 rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 light:border-gray-200">
        <span class="text-white light:text-gray-900 font-semibold text-sm">{{ t('bulkEditModal.title') }} <span class="text-green-400 light:text-green-700">{{ vault.currentMount }}</span></span>
        <button class="text-gray-500 hover:text-gray-300 light:hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <!-- Spinner while paths are loading -->
      <div v-if="loadingPaths" class="flex-1 flex flex-col items-center justify-center py-16 gap-4">
        <div class="w-12 h-12 border-2 border-gray-700 light:border-gray-300 border-t-green-400 rounded-full animate-spin"></div>
        <p class="text-gray-400 light:text-gray-600 text-sm">{{ t('bulkEditModal.loadingSecrets') }}</p>
        <p class="text-gray-600 light:text-gray-500 text-xs">{{ t('bulkEditModal.scanningMount') }} <span class="text-green-500 light:text-green-700">{{ vault.currentMount }}</span></p>
      </div>

      <div v-else class="overflow-auto flex-1 px-5 py-4 space-y-4">
        <!-- Success notification -->
        <div
          v-if="successMessage"
          class="px-4 py-3 bg-green-900 light:bg-green-100 border border-green-700 light:border-green-400 text-green-200 light:text-green-800 rounded text-sm animate-pulse"
        >
          {{ successMessage }}
        </div>

        <!-- JSON input -->
        <div v-if="!previewReady">
          <!-- Preset selector -->
          <div class="mb-4">
            <label class="text-gray-400 light:text-gray-600 text-xs block mb-2">{{ t('bulkEditModal.projectPreset') }}</label>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="preset in presetOptions"
                :key="preset.id"
                type="button"
                :disabled="loadingPaths || availablePaths.length === 0"
                class="px-3 py-1.5 rounded-full border text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                :class="presetBadgeClass(preset.id)"
                @click="selectedPreset = preset.id"
              >
                {{ preset.label }}
                <span class="ml-1 opacity-90">{{ preset.count }}</span>
              </button>
            </div>
          </div>

          <!-- Path selector -->
          <div class="mb-4">
            <div class="flex items-center gap-2 mb-2">
              <label class="text-gray-400 light:text-gray-600 text-xs">{{ t('bulkEditModal.pathToEdit') }}</label>
              <button
                type="button"
                class="px-2 py-0.5 rounded-full border text-xs font-medium transition cursor-pointer"
                :class="includeProd ? 'bg-red-900/60 text-red-300 border-red-700 hover:bg-red-900' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200'"
                @click="includeProd = !includeProd"
              >{{ includeProd ? t('bulkEditModal.prodIncluded') : t('bulkEditModal.prodExcluded') }}</button>
            </div>
            <div class="flex gap-2">
              <select
                v-model="selectedPath"
                :disabled="loadingPaths || filteredPaths.length === 0"
                class="flex-1 px-3 py-2 bg-gray-950 light:bg-gray-100 border border-gray-700 light:border-gray-200 text-green-300 light:text-gray-700 rounded text-sm focus:outline-none focus:border-green-600 light:focus:border-green-400 disabled:opacity-50"
              >
                <option value="" disabled>{{ loadingPaths ? t('bulkEditModal.loadingPaths') : t('bulkEditModal.selectPath') }}</option>
                <option v-for="path in filteredPaths" :key="path" :value="path">
                  {{ path }}
                </option>
              </select>
              <button
                class="px-3 py-2 text-sm bg-gray-700 light:bg-gray-200 hover:bg-gray-600 light:hover:bg-gray-300 text-gray-200 light:text-gray-700 rounded"
                :disabled="loadingPaths"
                @click="loadAvailablePaths"
              >
                🔄
              </button>
            </div>
            <div v-if="availablePaths.length > 0" class="text-gray-500 light:text-gray-500 text-xs mt-1">
              {{ t('bulkEditModal.pathCount', { filtered: filteredPaths.length, total: availablePaths.length }) }}
            </div>
            <div v-else-if="!loadingPaths && pathsError" class="text-red-400 light:text-red-700 text-xs mt-1">
              ⚠ {{ pathsError }}
            </div>
            <div v-else-if="!loadingPaths" class="text-gray-500 text-xs mt-1">
              {{ t('bulkEditModal.noPathsAvailable') }}
            </div>
          </div>

          <!-- JSON input -->
          <p class="text-gray-400 light:text-gray-600 text-xs mb-2">
            {{ t('bulkEditModal.editJsonHint') }}
          </p>
          <div v-if="loadingSelectedPathJson" class="text-blue-300 light:text-blue-700 text-xs mb-2">
            {{ t('bulkEditModal.loadingJson') }}
          </div>
          <div v-if="selectedPathJsonError" class="text-amber-300 light:text-amber-700 text-xs mb-2">
            {{ t('bulkEditModal.cannotLoadPath') }} {{ selectedPathJsonError }}
          </div>
          <textarea
            v-model="bulkJson"
            class="w-full h-72 bg-gray-950 light:bg-gray-100 border border-gray-700 light:border-gray-200 text-green-300 light:text-gray-700 font-mono text-xs rounded p-3 resize-y focus:outline-none focus:border-green-600 light:focus:border-green-400"
            :disabled="loadingSelectedPathJson"
            spellcheck="false"
          />
          <div v-if="jsonError" class="mt-2 text-red-400 light:text-red-700 text-xs">⚠ {{ jsonError }}</div>
          <div class="flex gap-2 mt-3">
            <button
              class="px-4 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded"
              :disabled="previewLoading || loadingSelectedPathJson"
              @click="preview"
            >
              {{ previewLoading ? t('bulkEditModal.loading') : t('bulkEditModal.previewDiffs') }}
            </button>
          </div>
        </div>

        <!-- Preview diffs -->
        <div v-if="previewReady" class="space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-gray-400 light:text-gray-600 text-sm">{{ t('bulkEditModal.pathsModified', { paths: previews.length, modified: totalChanges }) }}</span>
            <div class="flex gap-2">
              <button
                class="text-xs px-3 py-1 bg-gray-700 light:bg-gray-200 hover:bg-gray-600 light:hover:bg-gray-300 text-gray-200 light:text-gray-700 rounded"
                @click="previewReady = false"
              >{{ t('bulkEditModal.editBack') }}</button>
              <button
                class="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded"
                @click="applyAll"
              >{{ t('bulkEditModal.applyAll', { n: totalChanges }) }}</button>
            </div>
          </div>

          <!-- Per-path diffs -->
          <div
            v-for="(entry, i) in previews"
            :key="entry.path"
            class="border border-gray-700 light:border-gray-200 rounded"
          >
            <div class="flex items-center justify-between px-4 py-2 bg-gray-800 light:bg-gray-100 rounded-t">
              <span class="font-mono text-xs text-green-300 light:text-green-700">{{ entry.path }}</span>
              <div class="flex items-center gap-2">
                <span
                  v-if="applyResults.find(r => r.path === entry.path)"
                  :class="applyResults.find(r => r.path === entry.path)!.ok ? 'text-green-400' : 'text-red-400'"
                  class="text-xs"
                >
                  {{ applyResults.find(r => r.path === entry.path)!.ok ? '✓ OK' : '✗ ' + applyResults.find(r => r.path === entry.path)!.error }}
                </span>
                <span v-if="entry.fetchError" class="text-red-400 light:text-red-700 text-xs">⚠ {{ entry.fetchError }}</span>
                <button
                  v-if="!applyResults.find(r => r.path === entry.path)"
                  class="text-xs px-2 py-0.5 bg-green-800 light:bg-green-100 hover:bg-green-700 light:hover:bg-green-200 text-green-200 light:text-green-800 rounded"
                  @click="startConfirm(i)"
                >{{ t('bulkEditModal.apply') }}</button>
              </div>
            </div>
            <!-- Mini diff table -->
            <table class="w-full text-xs font-mono px-4 py-2">
              <tbody>
                <tr
                  v-for="key in [...new Set([...Object.keys(entry.before), ...Object.keys(entry.after)])].sort()"
                  :key="key"
                  class="border-b border-gray-800 light:border-gray-200 last:border-0"
                  :class="{
                    'text-green-300 bg-green-950': getRowStatus(entry, key) === 'added',
                    'text-red-300 bg-red-950': getRowStatus(entry, key) === 'removed',
                    'text-yellow-200 bg-yellow-950': getRowStatus(entry, key) === 'modified',
                    'text-gray-500': getRowStatus(entry, key) === 'unchanged',
                  }"
                >
                  <td class="px-4 py-1 w-1/4">{{ key }}</td>
                  <td class="px-2 py-1 w-1/3 opacity-70" :class="{ 'line-through': getRowStatus(entry, key) !== 'unchanged' }">{{ entry.before[key] ?? '' }}</td>
                  <td class="px-2 py-1 w-1/3">{{ entry.after[key] ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div><!-- end v-else body (paths loaded) -->

      <div v-if="allApplied" class="px-5 py-3 border-t border-gray-700 light:border-gray-200 text-green-400 light:text-green-700 text-sm text-center">
        {{ t('bulkEditModal.allApplied') }}
      </div>
    </div>
  </div>

  <!-- Confirm single -->
  <ConfirmDiffModal
    v-if="confirmIndex !== null"
    :path="previews[confirmIndex].path"
    :before="previews[confirmIndex].before"
    :after="previews[confirmIndex].after"
    @confirm="confirmOne(confirmIndex!)"
    @cancel="confirmIndex = null"
  />

  <!-- Confirm all -->
  <ConfirmDiffModal
    v-if="applyAllIndex !== null"
    path="(tous les chemins)"
    :before="confirmAllBefore"
    :after="confirmAllAfter"
    @confirm="confirmApplyAll"
    @cancel="applyAllIndex = null"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'
import NestedJsonField from './NestedJsonField.vue'
import type { SecretData } from '../types/secret'

const { t } = useI18n()
const props = defineProps<{ initialSource?: string; initialTarget?: string }>()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

// ── Step tracking ──
type Step = 1 | 2 | 3 | 4
const step = ref<Step>(1)

// ── Prod-path detection (same PROD_NAMES as other modals) ──
const PROD_NAMES = new Set(['prod', 'production', 'prd'])
function pathIsProd(path: string): boolean {
  return path.split('/').slice(1).some(s => PROD_NAMES.has(s.toLowerCase()))
}

// ── Available paths (loaded from namespace dump) ──
const availablePaths = ref<string[]>([])
const loadingPaths = ref(true)
const pathsError = ref<string | null>(null)

async function loadAvailablePaths() {
  loadingPaths.value = true
  pathsError.value = null
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      availablePaths.value = []
      pathsError.value = (err as { error?: string }).error ?? `HTTP ${res.status}`
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
    availablePaths.value = []
    pathsError.value = e instanceof Error ? e.message : t('compareModal.loadPathsError')
  }
  loadingPaths.value = false
}

onMounted(loadAvailablePaths)

// ── Prod filter (shared for both selects) ──
const includeProd = ref(false)

const filteredPaths = computed(() =>
  includeProd.value ? availablePaths.value : availablePaths.value.filter(p => !pathIsProd(p))
)

// ── Step 1 — Path inputs ──
const sourcePath = ref(props.initialSource ?? vault.currentPath)
const targetPath = ref(props.initialTarget ?? '')
const comparing = ref(false)
const compareError = ref<string | null>(null)

const targetIsProd = computed(() => targetPath.value.trim() !== '' && pathIsProd(targetPath.value.trim()))

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

// ── Source preview ──
const sourceExpanded = ref(false)
const sourceData = ref<Record<string, string> | null>(null)
const sourceLoading = ref(false)
const sourceRevealAll = ref(false)
const sourceCopiedKey = ref<string | null>(null)

watch(sourcePath, () => {
  sourceExpanded.value = false
  sourceData.value = null
  sourceRevealAll.value = false
})

async function toggleSourceExpand() {
  if (!sourcePath.value) return
  if (sourceExpanded.value) { sourceExpanded.value = false; return }
  if (!sourceData.value) {
    sourceLoading.value = true
    try {
      const params = new URLSearchParams({ path: sourcePath.value, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/read?${params}`)
      const json = await res.json()
      sourceData.value = res.ok ? (json.data ?? {}) : {}
    } catch { sourceData.value = {} }
    finally { sourceLoading.value = false }
  }
  sourceExpanded.value = true
}

async function copySourceKey(key: string, value: string) {
  await navigator.clipboard.writeText(value)
  sourceCopiedKey.value = key
  setTimeout(() => { if (sourceCopiedKey.value === key) sourceCopiedKey.value = null }, 2000)
}

// ── Step 2 — Diff result ──
// path: original key path array from the nested structure (e.g. ["api","key3"]).
// Needed to reconstruct the nested object on write-back without ambiguity.
type DiffItem = { key: string; path: string[]; source_value?: string; target_value?: string }

const diffResult = ref<{
  source_path: string
  target_path: string
  added: DiffItem[]
  missing: DiffItem[]
  changed: DiffItem[]
  unchanged: DiffItem[]
  target_data: Record<string, string>   // flat — for ConfirmDiffModal display only
  target_raw: Record<string, unknown>   // original nested — used for write-back
} | null>(null)

const showUnchanged = ref(false)

// Per-key selection (only added + changed rows are selectable)
const selectedKeys = ref<Set<string>>(new Set())

const selectableKeys = computed(() => {
  if (!diffResult.value) return []
  return [
    ...(diffResult.value.added ?? []).map(i => i.key),
    ...(diffResult.value.changed ?? []).map(i => i.key),
  ]
})

const allSelected = computed(() =>
  selectableKeys.value.length > 0 &&
  selectableKeys.value.every(k => selectedKeys.value.has(k))
)

function toggleSelectAll() {
  if (allSelected.value) {
    selectedKeys.value = new Set()
  } else {
    selectedKeys.value = new Set(selectableKeys.value)
  }
}

function toggleKey(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}

// ── Badge filter shortcuts ──
function selectOnlyAdded() {
  selectedKeys.value = new Set((diffResult.value?.added ?? []).map(i => i.key))
}
function selectOnlyChanged() {
  selectedKeys.value = new Set((diffResult.value?.changed ?? []).map(i => i.key))
}
function selectNone() {
  selectedKeys.value = new Set()
}

const onlyAddedSelected = computed(() => {
  const added = (diffResult.value?.added ?? []).map(i => i.key)
  return added.length > 0 && added.every(k => selectedKeys.value.has(k)) &&
    !(diffResult.value?.changed ?? []).some(i => selectedKeys.value.has(i.key))
})
const onlyChangedSelected = computed(() => {
  const changed = (diffResult.value?.changed ?? []).map(i => i.key)
  return changed.length > 0 && changed.every(k => selectedKeys.value.has(k)) &&
    !(diffResult.value?.added ?? []).some(i => selectedKeys.value.has(i.key))
})

// ── Step 3 — Confirm diff ──
const showConfirm = ref(false)
const showProdConfirm = ref(false)

function handleCopyClick() {
  if (targetIsProd.value) {
    showProdConfirm.value = true
  } else {
    showConfirm.value = true
  }
}

function confirmProdAndProceed() {
  showProdConfirm.value = false
  showConfirm.value = true
}

// Set a value at a nested path inside a cloned object.
// Uses the path[] array from the diff item — never splits on '.' — so literal dot
// keys ("spring.datasource.url" as a top-level key) are handled correctly.
function setNestedPath(obj: Record<string, unknown>, path: string[], value: string): void {
  if (path.length === 0) return
  if (path.length === 1) { obj[path[0]] = value; return }
  const [head, ...rest] = path
  if (!obj[head] || typeof obj[head] !== 'object' || Array.isArray(obj[head])) obj[head] = {}
  setNestedPath(obj[head] as Record<string, unknown>, rest, value)
}

const confirmBefore = computed(() => diffResult.value?.target_data ?? {})

// Flat version — for ConfirmDiffModal display only (before/after diff table)
const confirmAfter = computed(() => {
  if (!diffResult.value) return {}
  const merged: Record<string, string> = { ...(diffResult.value.target_data ?? {}) }
  for (const item of [...(diffResult.value.added ?? []), ...(diffResult.value.changed ?? [])]) {
    if (selectedKeys.value.has(item.key)) merged[item.key] = item.source_value ?? ''
  }
  return merged
})

// Nested version — what actually gets written to Vault, preserving original structure
const confirmAfterRaw = computed(() => {
  if (!diffResult.value) return {}
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(diffResult.value.target_raw ?? {}))
  for (const item of [...(diffResult.value.added ?? []), ...(diffResult.value.changed ?? [])]) {
    if (selectedKeys.value.has(item.key)) {
      setNestedPath(result, item.path?.length ? item.path : [item.key], item.source_value ?? '')
    }
  }
  return result
})

// ── Step 4 — Success ──
const writtenCount = ref(0)
const writeError = ref<string | null>(null)

// ── Stale-request prevention ──
let compareSeq = 0

async function runCompare() {
  const src = sourcePath.value.trim()
  const tgt = targetPath.value.trim()
  if (!src || !tgt) return
  comparing.value = true
  compareError.value = null
  diffResult.value = null
  selectedKeys.value = new Set()
  showUnchanged.value = false

  const id = ++compareSeq
  try {
    const res = await fetch('/api/kv/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_path: src,
        target_path: tgt,
        mount: vault.currentMount,
        namespace: vault.currentNamespace,
      }),
    })
    if (id !== compareSeq) return
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      compareError.value = (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`
      return
    }
    if (
      !json ||
      !Array.isArray(json.added) ||
      !Array.isArray(json.missing) ||
      !Array.isArray(json.changed) ||
      !Array.isArray(json.unchanged)
    ) {
      compareError.value = t('compareModal.compareError')
      return
    }
    diffResult.value = json as typeof diffResult.value
    // Pre-select all added + changed keys
    selectedKeys.value = new Set(selectableKeys.value)
    step.value = 2
  } catch (e: unknown) {
    if (id !== compareSeq) return
    compareError.value = e instanceof Error ? e.message : t('compareModal.compareError')
  } finally {
    if (id === compareSeq) comparing.value = false
  }
}

async function applyWrite() {
  showConfirm.value = false
  writeError.value = null
  const tgt = diffResult.value?.target_path ?? targetPath.value.trim()
  try {
    await vault.writeSecret(tgt, confirmAfterRaw.value as SecretData)
    writtenCount.value = selectedKeys.value.size
    step.value = 4
  } catch (e: unknown) {
    writeError.value = e instanceof Error ? e.message : t('compareModal.writeError')
  }
}

function goToTarget() {
  const tgt = diffResult.value?.target_path ?? targetPath.value.trim()
  if (!tgt) { emit('close'); return }
  const segments = tgt.split('/').filter(Boolean)
  // Navigate to the parent folder, not the secret itself
  const parentSegments = segments.slice(0, -1)
  vault.currentPath = ''
  vault.pathHistory = []
  for (const seg of parentSegments) {
    vault.pathHistory.push(vault.currentPath)
    vault.currentPath = vault.currentPath ? `${vault.currentPath}/${seg}` : seg
  }
  vault.listPath(vault.currentPath)
  vault.readSecret(tgt)
  emit('close')
}

const showHowTo = ref(false)

const STEP_LABELS = computed<Record<number, string>>(() => ({
  1: t('compareModal.step1'),
  2: t('compareModal.step2'),
  3: t('compareModal.step3'),
  4: t('compareModal.step4'),
}))

const step1Valid = computed(() => sourcePath.value.trim().length > 0 && targetPath.value.trim().length > 0)
const canCopy = computed(() => selectedKeys.value.size > 0 && vault.editingEnabled)
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="step < 3 ? emit('close') : undefined"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl light:bg-white light:border-gray-200">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0 light:border-gray-200">
        <div class="flex items-center gap-3">
          <span class="text-white font-semibold text-sm light:text-black">{{ t('compareModal.title') }}</span>
          <button
            v-if="step === 1 && !loadingPaths"
            type="button"
            class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold transition"
            :class="showHowTo ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-300 border border-gray-600 hover:border-gray-400 light:text-gray-400 light:hover:text-gray-600 light:border-gray-300'"
            :title="t('compareModal.howToTitle')"
            @click="showHowTo = !showHowTo"
          >i</button>
          <span class="text-gray-600 text-xs">·</span>
          <span class="text-gray-500 text-xs light:text-gray-600">{{ t('compareModal.mount') }} <span class="text-green-400">{{ vault.currentMount }}</span></span>
        </div>
        <!-- Step indicators -->
        <div class="flex items-center gap-1">
          <template v-for="s in [1, 2, 3, 4]" :key="s">
            <div
              class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
              :class="step === s ? 'bg-blue-700 text-white' : s < step ? 'bg-gray-700 text-gray-300 light:bg-gray-200 light:text-gray-600' : 'text-gray-600'"
            >
              <span>{{ s }}</span>
              <span class="hidden sm:inline">{{ STEP_LABELS[s] }}</span>
            </div>
            <span v-if="s < 4" class="text-gray-700 text-xs">›</span>
          </template>
        </div>
        <button
          class="text-gray-500 hover:text-gray-300 ml-3 shrink-0 light:hover:text-gray-700"
          @click="emit('close')"
        >✕</button>
      </div>

      <!-- Body -->
      <div class="overflow-auto flex-1 px-5 py-4">

        <!-- ── STEP 1 — Path selector ── -->
        <div v-if="step === 1" class="space-y-4">

          <!-- Loading state: spinner + how-to -->
          <div v-if="loadingPaths" class="flex flex-col items-center py-8 gap-6">
            <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <div class="w-full space-y-3 text-xs text-gray-500">
              <div class="border border-gray-700 rounded-lg px-4 py-3 space-y-2.5 light:border-gray-200">
                <p class="text-gray-400 font-medium light:text-gray-600">{{ t('compareModal.howToTitle') }}</p>
                <div v-for="(step, i) in [t('compareModal.howToStep1'), t('compareModal.howToStep2'), t('compareModal.howToStep3'), t('compareModal.howToStep4')]" :key="i" class="flex items-start gap-2">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">{{ i + 1 }}</span>
                  <span class="light:text-gray-500">{{ step }}</span>
                </div>
              </div>
            </div>
          </div>

          <template v-else>

          <!-- How-to card (toggled via ℹ icon) -->
          <div v-if="showHowTo" class="border border-blue-800/50 bg-blue-950/20 rounded-lg px-4 py-3 space-y-2.5 text-xs text-gray-400 light:border-blue-200 light:bg-blue-50 light:text-gray-500">
            <div class="flex items-center justify-between">
              <p class="text-blue-300 font-medium light:text-blue-700">{{ t('compareModal.howToTitle') }}</p>
              <button type="button" class="text-gray-600 hover:text-gray-400 light:text-gray-400 light:hover:text-gray-600" @click="showHowTo = false">✕</button>
            </div>
            <div v-for="(s, i) in [t('compareModal.howToStep1'), t('compareModal.howToStep2'), t('compareModal.howToStep3'), t('compareModal.howToStep4')]" :key="i" class="flex items-start gap-2">
              <span class="shrink-0 w-5 h-5 rounded-full bg-gray-800 text-gray-400 text-[10px] flex items-center justify-center font-semibold light:bg-gray-100 light:text-gray-600">{{ i + 1 }}</span>
              <span>{{ s }}</span>
            </div>
          </div>

          <!-- Paths loading error -->
          <div v-if="pathsError" class="text-amber-400 text-xs px-3 py-2 bg-amber-950/40 border border-amber-800/50 rounded light:bg-amber-50 light:border-amber-300 light:text-amber-700">
            ⚠ {{ pathsError }}
          </div>

          <!-- Prod filter toggle + path count -->
          <div class="flex items-center justify-between">
            <button
              type="button"
              class="px-2 py-0.5 rounded-full border text-xs font-medium transition cursor-pointer"
              :class="includeProd ? 'bg-red-900/60 text-red-300 border-red-700 hover:bg-red-900' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200 light:bg-gray-100 light:border-gray-300 light:text-gray-600 light:hover:bg-gray-200'"
              @click="includeProd = !includeProd"
            >{{ includeProd ? t('compareModal.prodIncluded') : t('compareModal.prodExcluded') }}</button>
            <span v-if="!loadingPaths && availablePaths.length > 0" class="text-gray-600 text-xs light:text-gray-500">
              {{ t('compareModal.pathCount', { filtered: filteredPaths.length, total: availablePaths.length }) }}
            </span>
            <span v-else-if="!loadingPaths && !pathsError" class="text-gray-600 text-xs light:text-gray-500">
              {{ t('compareModal.noPathsAvailable') }}
            </span>
          </div>

          <!-- Source path -->
          <div class="space-y-1">
            <label class="text-gray-400 text-xs mb-1.5 block light:text-gray-600">{{ t('compareModal.sourcePath') }}</label>
            <div class="flex gap-2">
              <select
                v-model="sourcePath"
                :disabled="loadingPaths || filteredPaths.length === 0"
                class="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 text-blue-300 font-mono rounded text-sm focus:outline-none focus:border-blue-600 disabled:opacity-50 light:bg-white light:border-gray-300 light:text-blue-700"
              >
                <option value="" disabled>{{ loadingPaths ? t('compareModal.loadingPaths') : t('compareModal.selectPath') }}</option>
                <option v-for="path in filteredPaths" :key="path" :value="path">{{ path }}</option>
              </select>
              <button
                type="button"
                class="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
                :disabled="loadingPaths"
                :title="t('compareModal.refreshPaths')"
                @click="loadAvailablePaths"
              >🔄</button>
              <!-- Expand source preview -->
              <button
                v-if="sourcePath"
                type="button"
                class="px-2.5 py-2 text-sm bg-gray-800 border border-gray-700 text-gray-400 rounded hover:bg-gray-700 hover:text-gray-200 transition light:bg-gray-100 light:border-gray-300 light:text-gray-600 light:hover:bg-gray-200"
                :title="t('compareModal.sourcePreviewToggle')"
                :disabled="sourceLoading"
                @click="toggleSourceExpand"
              >
                <svg v-if="sourceLoading" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 animate-spin"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                <svg v-else-if="sourceExpanded" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
              </button>
            </div>

            <!-- Source preview panel -->
            <div v-if="sourceExpanded && sourceData" class="border border-gray-700 rounded overflow-hidden light:border-gray-200">
              <div class="flex items-center justify-between px-3 py-1.5 bg-gray-800/60 border-b border-gray-700 light:bg-gray-50 light:border-gray-200">
                <span class="text-xs text-gray-500 font-mono light:text-gray-500">{{ Object.keys(sourceData).length }} {{ t('compareModal.sourcePreviewKeys') }}</span>
                <button
                  type="button"
                  class="text-xs text-gray-500 hover:text-gray-300 transition light:text-gray-600 light:hover:text-gray-800"
                  @click="sourceRevealAll = !sourceRevealAll"
                >{{ sourceRevealAll ? t('compareModal.sourceHideAll') : t('compareModal.sourceRevealAll') }}</button>
              </div>
              <div v-if="Object.keys(sourceData).length === 0" class="px-3 py-3 text-xs text-gray-600 text-center light:text-gray-400">
                {{ t('compareModal.sourcePreviewEmpty') }}
              </div>
              <table v-else class="w-full text-xs font-mono table-fixed">
                <tbody>
                  <template v-for="[key, value] in Object.entries(sourceData)" :key="key">

                    <!-- Nested JSON value: reuse NestedJsonField (read-only) -->
                    <NestedJsonField
                      v-if="parseJsonValue(value).isNested"
                      :value="parseJsonValue(value).parsed"
                      :key-name="key"
                      :depth="0"
                      :editing-allowed="false"
                    />

                    <!-- Plain scalar value -->
                    <tr
                      v-else
                      class="border-b border-gray-800 last:border-0 hover:bg-gray-800/40 transition light:border-gray-100 light:hover:bg-gray-50"
                    >
                      <td class="px-3 py-1.5 w-[40%] text-blue-300 font-semibold truncate light:text-blue-700" :title="key">{{ key }}</td>
                      <td class="px-3 py-1.5 text-gray-300 break-all light:text-gray-700">
                        <span v-if="sourceRevealAll">{{ value }}</span>
                        <span v-else class="text-gray-600 select-none tracking-widest light:text-gray-400">••••••••</span>
                      </td>
                      <td class="px-3 py-1.5 w-8 text-right">
                        <button
                          type="button"
                          class="transition"
                          :class="sourceCopiedKey === key ? 'text-green-400 light:text-green-600' : 'text-gray-600 hover:text-gray-300 light:text-gray-400 light:hover:text-gray-600'"
                          :title="t('compareModal.copyValue')"
                          @click="copySourceKey(key, String(value))"
                        >
                          <svg v-if="sourceCopiedKey === key" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                          <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /></svg>
                        </button>
                      </td>
                    </tr>

                  </template>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Target path -->
          <div>
            <label class="text-gray-400 text-xs mb-1.5 block light:text-gray-600">{{ t('compareModal.targetPath') }}</label>
            <select
              v-model="targetPath"
              :disabled="loadingPaths || filteredPaths.length === 0"
              class="w-full px-3 py-2 bg-gray-950 border border-gray-700 text-green-300 font-mono rounded text-sm focus:outline-none focus:border-green-600 disabled:opacity-50 light:bg-white light:border-gray-300 light:text-green-700"
            >
              <option value="" disabled>{{ loadingPaths ? t('compareModal.loadingPaths') : t('compareModal.selectPath') }}</option>
              <option v-for="path in filteredPaths" :key="path" :value="path">{{ path }}</option>
            </select>
            <!-- Protected path warning (shown when prod paths are included and target is prod) -->
            <div
              v-if="targetIsProd"
              class="mt-1.5 flex items-center gap-1.5 text-xs text-amber-400 light:text-amber-600"
            >
              <span>⚠</span>
              <span>{{ t('compareModal.protectedWarning') }}</span>
            </div>
          </div>

          <!-- Compare error -->
          <div v-if="compareError" class="text-red-400 text-sm px-3 py-2 bg-red-950 border border-red-800 rounded light:bg-red-50 light:border-red-300">
            ⚠ {{ compareError }}
          </div>

          </template><!-- end v-else (paths loaded) -->
        </div>

        <!-- ── STEP 2 — Diff table ── -->
        <div v-else-if="step === 2 && diffResult" class="space-y-4">

          <!-- Summary header -->
          <div class="flex items-center justify-between flex-wrap gap-2">
            <div class="text-xs text-gray-400 light:text-gray-600 font-mono">
              <span class="text-blue-300">{{ diffResult.source_path }}</span>
              <span class="text-gray-600 mx-1.5">→</span>
              <span class="text-green-300">{{ diffResult.target_path }}</span>
            </div>
            <div class="flex items-center gap-2 text-xs">
              <button
                v-if="diffResult.added.length"
                type="button"
                class="px-1.5 py-0.5 rounded font-mono text-xs transition cursor-pointer"
                :class="onlyAddedSelected ? 'bg-green-700 text-white ring-1 ring-green-400' : 'bg-green-950 text-green-400 hover:bg-green-900 light:bg-green-50 light:text-green-700 light:hover:bg-green-100'"
                :title="t('compareModal.filterAdded')"
                @click="selectOnlyAdded"
              >+{{ diffResult.added.length }}</button>
              <button
                v-if="diffResult.changed.length"
                type="button"
                class="px-1.5 py-0.5 rounded font-mono text-xs transition cursor-pointer"
                :class="onlyChangedSelected ? 'bg-yellow-600 text-white ring-1 ring-yellow-400' : 'bg-yellow-950 text-yellow-400 hover:bg-yellow-900 light:bg-yellow-50 light:text-yellow-700 light:hover:bg-yellow-100'"
                :title="t('compareModal.filterChanged')"
                @click="selectOnlyChanged"
              >~{{ diffResult.changed.length }}</button>
              <button
                v-if="diffResult.missing.length"
                type="button"
                class="px-1.5 py-0.5 rounded font-mono text-xs transition cursor-pointer bg-red-950 text-red-400 hover:bg-red-900 light:bg-red-50 light:text-red-700 light:hover:bg-red-100"
                :title="t('compareModal.filterMissing')"
                @click="selectNone"
              >-{{ diffResult.missing.length }}</button>
              <button
                v-if="diffResult.unchanged.length"
                type="button"
                class="px-1.5 py-0.5 rounded font-mono text-xs transition cursor-pointer"
                :class="showUnchanged ? 'bg-gray-600 text-white ring-1 ring-gray-400' : 'bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300 light:bg-gray-100 light:text-gray-500 light:hover:bg-gray-200'"
                :title="t('compareModal.filterUnchanged')"
                @click="showUnchanged = !showUnchanged"
              >={{ diffResult.unchanged.length }}</button>
            </div>
          </div>

          <!-- Select-all + unchanged toggle -->
          <div class="flex items-center justify-between">
            <label
              v-if="selectableKeys.length > 0"
              class="flex items-center gap-2 cursor-pointer select-none"
              @click="toggleSelectAll"
            >
              <span
                class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs transition"
                :class="allSelected ? 'bg-blue-500 border-blue-400' : 'border-gray-600 bg-gray-800 light:bg-white light:border-gray-300'"
              >
                <span v-if="allSelected">✓</span>
              </span>
              <span class="text-xs text-gray-400 light:text-gray-600">{{ t('compareModal.selectAll') }} ({{ selectedKeys.size }}/{{ selectableKeys.length }})</span>
            </label>
            <div v-else></div>
            <button
              v-if="diffResult.unchanged.length > 0"
              class="text-xs px-2 py-0.5 rounded border transition"
              :class="showUnchanged ? 'bg-gray-700 border-gray-600 text-gray-300 light:bg-gray-200 light:border-gray-300 light:text-gray-700' : 'border-gray-700 text-gray-600 hover:border-gray-500 hover:text-gray-400 light:border-gray-300 light:hover:text-gray-700'"
              @click="showUnchanged = !showUnchanged"
            >{{ t('compareModal.unchangedToggle') }}</button>
          </div>

          <!-- Diff table -->
          <div class="border border-gray-700 rounded overflow-hidden light:border-gray-200">
            <table class="w-full text-xs font-mono table-fixed">
              <thead>
                <tr class="text-gray-500 text-left border-b border-gray-700 uppercase light:border-gray-200 light:text-gray-400">
                  <th class="px-3 py-2 w-8 shrink-0"></th>
                  <th class="px-3 py-2 w-[32%]">Key</th>
                  <th class="px-3 py-2 w-[30%]">Source</th>
                  <th class="px-3 py-2 w-[30%]">Target</th>
                  <th class="px-3 py-2 w-6 text-right"></th>
                </tr>
              </thead>
              <tbody>

                <!-- Added rows (green, selectable) -->
                <tr
                  v-for="item in diffResult.added"
                  :key="'added-' + item.key"
                  class="border-b border-gray-800 last:border-0 bg-green-950 text-green-300 cursor-pointer hover:bg-green-900 transition-colors light:bg-green-50 light:text-green-800 light:hover:bg-green-100 light:border-gray-200"
                  @click="toggleKey(item.key)"
                >
                  <td class="px-3 py-1.5">
                    <span
                      class="w-4 h-4 rounded border flex items-center justify-center text-white text-xs transition"
                      :class="selectedKeys.has(item.key) ? 'bg-green-600 border-green-500' : 'border-green-800 bg-green-950 light:bg-green-50 light:border-green-300'"
                    >
                      <span v-if="selectedKeys.has(item.key)">✓</span>
                    </span>
                  </td>
                  <td class="px-3 py-1.5 font-semibold max-w-0 truncate" :title="item.key">{{ item.key }}</td>
                  <td class="px-3 py-1.5 break-all opacity-90">{{ item.source_value }}</td>
                  <td class="px-3 py-1.5 opacity-40 italic">—</td>
                  <td class="px-3 py-1.5 text-right opacity-60">+</td>
                </tr>

                <!-- Changed rows (amber, selectable) -->
                <tr
                  v-for="item in diffResult.changed"
                  :key="'changed-' + item.key"
                  class="border-b border-gray-800 last:border-0 bg-yellow-950 text-yellow-200 cursor-pointer hover:bg-yellow-900 transition-colors light:bg-yellow-50 light:text-yellow-800 light:hover:bg-yellow-100 light:border-gray-200"
                  @click="toggleKey(item.key)"
                >
                  <td class="px-3 py-1.5">
                    <span
                      class="w-4 h-4 rounded border flex items-center justify-center text-white text-xs transition"
                      :class="selectedKeys.has(item.key) ? 'bg-yellow-600 border-yellow-500' : 'border-yellow-800 bg-yellow-950 light:bg-yellow-50 light:border-yellow-300'"
                    >
                      <span v-if="selectedKeys.has(item.key)">✓</span>
                    </span>
                  </td>
                  <td class="px-3 py-1.5 font-semibold max-w-0 truncate" :title="item.key">{{ item.key }}</td>
                  <td class="px-3 py-1.5 break-all opacity-90">{{ item.source_value }}</td>
                  <td class="px-3 py-1.5 break-all opacity-60 line-through">{{ item.target_value }}</td>
                  <td class="px-3 py-1.5 text-right opacity-60">~</td>
                </tr>

                <!-- Missing rows (red, disabled) -->
                <tr
                  v-for="item in diffResult.missing"
                  :key="'missing-' + item.key"
                  class="border-b border-gray-800 last:border-0 bg-red-950 text-red-300 opacity-70 light:bg-red-50 light:text-red-800 light:border-gray-200"
                >
                  <td class="px-3 py-1.5">
                    <span class="w-4 h-4 rounded border flex items-center justify-center border-red-800 bg-red-950 light:bg-red-50 light:border-red-200"></span>
                  </td>
                  <td class="px-3 py-1.5 font-semibold max-w-0 truncate" :title="item.key">{{ item.key }}</td>
                  <td class="px-3 py-1.5 opacity-40 italic">—</td>
                  <td class="px-3 py-1.5 break-all">{{ item.target_value }}</td>
                  <td class="px-3 py-1.5 text-right opacity-60">−</td>
                </tr>

                <!-- Unchanged rows (gray, disabled, collapsible) -->
                <template v-if="showUnchanged">
                  <tr
                    v-for="item in diffResult.unchanged"
                    :key="'unchanged-' + item.key"
                    class="border-b border-gray-800 last:border-0 text-gray-500 light:text-gray-400 light:border-gray-200"
                  >
                    <td class="px-3 py-1.5">
                      <span class="w-4 h-4 rounded border flex items-center justify-center border-gray-700 light:border-gray-200"></span>
                    </td>
                    <td class="px-3 py-1.5 max-w-0 truncate" :title="item.key">{{ item.key }}</td>
                    <td class="px-3 py-1.5 break-all">{{ item.source_value }}</td>
                    <td class="px-3 py-1.5 break-all">{{ item.target_value }}</td>
                    <td class="px-3 py-1.5 text-right opacity-60">=</td>
                  </tr>
                </template>

              </tbody>
            </table>
          </div>

          <!-- Write error -->
          <div v-if="writeError" class="text-red-400 text-sm px-3 py-2 bg-red-950 border border-red-800 rounded light:bg-red-50 light:border-red-300">
            ⚠ {{ writeError }}
          </div>

          <!-- Editing disabled notice -->
          <div v-if="!vault.editingEnabled" class="text-amber-400 text-xs px-3 py-2 bg-amber-950 border border-amber-800 rounded light:bg-amber-50 light:border-amber-300 light:text-amber-700">
            {{ t('compareModal.editingDisabled') }}
          </div>

          <!-- Prod copy confirmation panel -->
          <div
            v-if="showProdConfirm"
            class="border border-red-700 bg-red-950/60 rounded-lg p-4 space-y-3 light:bg-red-50 light:border-red-400"
          >
            <div class="flex items-start gap-2">
              <span class="text-red-400 text-lg leading-none mt-0.5">⚠</span>
              <div>
                <p class="text-red-300 text-sm font-semibold light:text-red-700">{{ t('compareModal.prodConfirmTitle') }}</p>
                <p class="text-red-400/80 text-xs mt-1 font-mono break-all light:text-red-600">{{ diffResult?.target_path ?? targetPath }}</p>
                <p class="text-red-400/70 text-xs mt-1.5 light:text-red-500">{{ t('compareModal.prodConfirmBody', { n: selectedKeys.size }) }}</p>
              </div>
            </div>
            <div class="flex gap-2 justify-end">
              <button
                type="button"
                class="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
                @click="showProdConfirm = false"
              >{{ t('compareModal.prodConfirmCancel') }}</button>
              <button
                type="button"
                class="text-xs px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded font-semibold"
                @click="confirmProdAndProceed"
              >{{ t('compareModal.prodConfirmOk') }}</button>
            </div>
          </div>

        </div>

        <!-- ── STEP 4 — Success ── -->
        <div v-else-if="step === 4" class="flex flex-col items-center py-10 gap-4">
          <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2 border-green-500 bg-green-950 text-green-400 light:bg-green-50">
            ✓
          </div>
          <div class="text-center">
            <div class="text-white font-semibold text-base mb-1 light:text-gray-900">
              {{ writtenCount }} {{ t('compareModal.success') }}
            </div>
            <div class="text-gray-400 text-sm font-mono light:text-gray-600">
              {{ diffResult?.target_path ?? targetPath }}
            </div>
          </div>
          <button
            class="mt-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-sm font-semibold transition"
            @click="goToTarget"
          >{{ t('compareModal.goToTarget') }} →</button>
        </div>

      </div><!-- end body -->

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-gray-700 flex items-center justify-between shrink-0 light:border-gray-200">
        <!-- Back button -->
        <button
          v-if="step === 2"
          class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
          @click="step = 1; compareError = null"
        >{{ t('compareModal.back') }}</button>
        <div v-else></div>

        <!-- Right actions -->
        <div class="flex gap-2">
          <!-- Step 1 — Compare button -->
          <button
            v-if="step === 1"
            class="text-sm px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold disabled:opacity-40 transition"
            :disabled="!step1Valid || comparing"
            @click="runCompare"
          >{{ comparing ? t('compareModal.comparing') : t('compareModal.compare') }}</button>

          <!-- Step 2 — Copy selected -->
          <button
            v-if="step === 2"
            class="text-sm px-4 py-1.5 text-white rounded font-semibold disabled:opacity-40 transition"
            :class="targetIsProd ? 'bg-red-700 hover:bg-red-600' : 'bg-green-700 hover:bg-green-600'"
            :disabled="!canCopy || showProdConfirm"
            :title="!vault.editingEnabled ? t('compareModal.editingDisabled') : selectedKeys.size === 0 ? t('compareModal.nothingSelected') : ''"
            @click="handleCopyClick"
          >{{ selectedKeys.size > 0 ? t('compareModal.copySelected') : t('compareModal.nothingSelected') }}</button>

          <!-- Step 4 — Close -->
          <button
            v-if="step === 4"
            class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
            @click="emit('close')"
          >{{ t('compareModal.close') }}</button>
        </div>
      </div>

    </div>
  </div>

  <!-- ConfirmDiffModal — rendered outside the modal div so z-index stacking is clean -->
  <ConfirmDiffModal
    v-if="showConfirm && diffResult"
    :path="diffResult.target_path"
    :before="confirmBefore"
    :after="confirmAfter"
    @confirm="applyWrite"
    @cancel="showConfirm = false"
  />
</template>

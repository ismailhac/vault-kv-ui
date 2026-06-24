<script setup lang="ts">
import { ref, computed, watch, provide } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const vFocus = { mounted: (el: HTMLElement) => (el as HTMLInputElement).focus() }
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'
import VersionTimeline from './VersionTimeline.vue'
import NestedJsonField from './NestedJsonField.vue'
import SmartValueCell from './SmartValueCell.vue'
import SmartEditValue from './SmartEditValue.vue'
import CloneModal from './CloneModal.vue'

const vault = useVaultStore()
const editingAllowed = computed(() => vault.editingEnabled)

// Shared slot: only one NestedJsonField instance may be in edit mode at a time.
const activeNestedEdit = ref<symbol | null>(null)
provide('activeNestedEdit', activeNestedEdit)

// ---- JSON bulk edit mode (advanced) ----
const editMode = ref(false)
const editJson = ref('')
const jsonError = ref<string | null>(null)
const saveSuccess = ref(false)
const showDiff = ref(false)
const pendingData = ref<Record<string, string>>({})
// Holds the native-typed write payload when pendingData was stringified for display only.
const rawWriteData = ref<Record<string, unknown> | null>(null)
const isRestoring = ref(false)

function enterEdit() {
  if (!vault.selectedSecret) return
  editJson.value = JSON.stringify(vault.selectedSecret.data, null, 2)
  jsonError.value = null
  editMode.value = true
  saveSuccess.value = false
  cancelEditRow()
}

function cancelEdit() {
  editMode.value = false
  jsonError.value = null
}

function requestSave() {
  jsonError.value = null
  try {
    const parsed = JSON.parse(editJson.value)
    if (typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error(t('secretPanel.jsonMustBeObject'))
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
        throw new Error(t('secretPanel.valueMustBeString', { key: k }))
    }
    pendingData.value = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v)])
    )
    showDiff.value = true
  } catch (e: unknown) {
    jsonError.value = e instanceof Error ? e.message : t('secretPanel.invalidJson')
  }
}

async function confirmSave() {
  if (!vault.selectedSecret) return
  const path = vault.selectedSecret.path
  const wasRestoring = isRestoring.value
  isRestoring.value = false
  showDiff.value = false
  const writeData = (rawWriteData.value ?? pendingData.value) as Record<string, string>
  rawWriteData.value = null
  try {
    await vault.writeSecret(path, writeData)
    await vault.readSecret(path)
    editMode.value = false
    saveSuccess.value = true
    setTimeout(() => (saveSuccess.value = false), 3000)
    if (wasRestoring) await vault.fetchVersions(path)
  } catch (e: unknown) {
    jsonError.value = e instanceof Error ? e.message : t('secretPanel.saveError')
  }
}

// ---- Inline row editing (key + value in one shot) ----
const editingRow = ref<string | null>(null)
const editingRowKey = ref('')
const editingRowValue = ref('')
const rowEditError = ref<string | null>(null)
const rowSaveSuccess = ref<string | null>(null)

function startEditRow(key: string, val: string) {
  if (!editingAllowed.value || editMode.value) return
  activeNestedEdit.value = null
  editingRow.value = key
  editingRowKey.value = key
  editingRowValue.value = val
  rowEditError.value = null
}

function cancelEditRow() {
  editingRow.value = null
  rowEditError.value = null
}

function cancelOnRowBlur(e: FocusEvent) {
  if (!editingRow.value) return
  const rel = e.relatedTarget as HTMLElement | null
  if (rel && (e.currentTarget as HTMLElement).contains(rel)) return
  cancelEditRow()
}

async function saveRow(originalKey: string) {
  if (!vault.selectedSecret) return
  const newKey = editingRowKey.value.trim()
  if (!newKey) { cancelEditRow(); return }

  const currentVal = vault.selectedSecret.data[originalKey]
  const currentStr = currentVal !== null && typeof currentVal === 'object' ? JSON.stringify(currentVal) : String(currentVal ?? '')
  if (newKey === originalKey && editingRowValue.value === currentStr) {
    cancelEditRow()
    return
  }

  editingRow.value = null
  rowEditError.value = null

  const newData: Record<string, string> = {}
  for (const [k, v] of Object.entries(vault.selectedSecret.data)) {
    const strV = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
    newData[k === originalKey ? newKey : k] = k === originalKey ? editingRowValue.value : strV
  }

  try {
    await vault.writeSecret(vault.selectedSecret.path, newData)
    await vault.readSecret(vault.selectedSecret.path)
    rowSaveSuccess.value = newKey
    setTimeout(() => { if (rowSaveSuccess.value === newKey) rowSaveSuccess.value = null }, 2000)
    await vault.fetchVersions(vault.selectedSecret.path)
  } catch (e: unknown) {
    rowEditError.value = e instanceof Error ? e.message : t('secretPanel.saveError')
  }
}

// ---- Restore from version timeline ----
function handleRestore(historicalData: Record<string, string>) {
  pendingData.value = historicalData
  isRestoring.value = true
  showDiff.value = true
}

// ---- Delete key (via ConfirmDiffModal) ----
function removeKey(key: string) {
  if (!vault.selectedSecret) return
  const native: Record<string, unknown> = { ...vault.selectedSecret.data }
  delete native[key]
  rawWriteData.value = native
  pendingData.value = stringifyData(native)
  showDiff.value = true
}

// ---- Row selection ----
const selectedPaths = ref<Map<string, unknown>>(new Map())
const showRowFormatPicker = ref(false)
const showCloneRows = ref(false)

const allTopLevelKeys = computed(() => {
  if (!vault.selectedSecret) return []
  return Object.keys(vault.selectedSecret.data)
})

const allRowsSelected = computed(() =>
  allTopLevelKeys.value.length > 0 && allTopLevelKeys.value.every(k => selectedPaths.value.has(k))
)
const someRowsSelected = computed(() =>
  selectedPaths.value.size > 0
)

function setDeepPath(obj: Record<string, unknown>, parts: string[], value: unknown): void {
  const [head, ...rest] = parts
  if (!rest.length) { obj[head] = value; return }
  if (typeof obj[head] !== 'object' || obj[head] === null) obj[head] = {}
  setDeepPath(obj[head] as Record<string, unknown>, rest, value)
}

const selectedRowsData = computed<Record<string, unknown>>(() => {
  const result: Record<string, unknown> = {}
  for (const [path, value] of selectedPaths.value) {
    setDeepPath(result, path.split('.'), value)
  }
  return result
})

function togglePath(path: string, value: unknown) {
  const next = new Map(selectedPaths.value)
  if (next.has(path)) next.delete(path); else next.set(path, value)
  selectedPaths.value = next
}

function toggleRowSelect(key: string) {
  if (!vault.selectedSecret) return
  togglePath(key, vault.selectedSecret.data[key])
}

function toggleLeafPath(fullPath: string, value: unknown) {
  togglePath(fullPath, value)
}

function isPathSelected(fullPath: string): boolean {
  return selectedPaths.value.has(fullPath)
}

const selectedLeafPathsList = computed(() =>
  [...selectedPaths.value.entries()].map(([path, value]) => ({ path, value }))
)

function toggleAllRows() {
  if (allRowsSelected.value) {
    selectedPaths.value = new Map()
  } else {
    const next = new Map<string, unknown>()
    if (vault.selectedSecret) {
      for (const [k, v] of Object.entries(vault.selectedSecret.data)) next.set(k, v)
    }
    selectedPaths.value = next
  }
}

function clearRowSelection() {
  selectedPaths.value = new Map()
}

function serializeRowJson(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2)
}

function serializeRowCsv(data: Record<string, unknown>): string {
  const rows = ['key,value']
  for (const [k, v] of Object.entries(data)) rows.push(`${k},${JSON.stringify(v)}`)
  return rows.join('\n')
}

function serializeRowYaml(data: Record<string, unknown>): string {
  return Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')
}

function downloadSelectedRows(format: 'json' | 'csv' | 'yaml') {
  showRowFormatPicker.value = false
  const data = selectedRowsData.value
  const secretName = vault.selectedSecret?.path.split('/').pop() ?? 'secret'
  const mimeType = format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/yaml'
  const filename = `${secretName}-selection.${format}`
  let content: string
  if (format === 'json') content = serializeRowJson(data)
  else if (format === 'csv') content = serializeRowCsv(data)
  else content = serializeRowYaml(data)
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ---- Copy + masking ----
const valuesVisible = ref(false)
const copiedCell = ref<string | null>(null)
const toastMessage = ref('')
const toastVisible = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null

async function copyCell(text: string, id: string, label: string) {
  await navigator.clipboard.writeText(text)
  copiedCell.value = id
  setTimeout(() => { if (copiedCell.value === id) copiedCell.value = null }, 1500)
  toastMessage.value = label
  toastVisible.value = true
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastVisible.value = false }, 1800)
}

// ---- Download ----
function downloadSecret() {
  if (!vault.selectedSecret) return
  const filename = vault.selectedSecret.path.replace(/\//g, '_') + '.json'
  const content = JSON.stringify({ [vault.selectedSecret.path]: vault.selectedSecret.data }, null, 2)
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Reset transient state when secret changes
watch(() => vault.selectedSecret?.path, () => {
  editMode.value = false
  jsonError.value = null
  saveSuccess.value = false
  isRestoring.value = false
  cancelEditRow()
  rowSaveSuccess.value = null
  clearRowSelection()
})

// Stringify unknown values so ConfirmDiffModal (Record<string,string>) works correctly
function stringifyData(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
    ])
  )
}

const currentBefore = computed<Record<string, string>>(() =>
  vault.selectedSecret ? stringifyData(vault.selectedSecret.data) : {}
)

// Detect whether a value should render as a nested accordion
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

// Deep-set a value at a key path inside a cloned object
function setNestedValue(obj: unknown, path: string[], value: string): void {
  if (!path.length || typeof obj !== 'object' || obj === null) return
  const [head, ...rest] = path
  if (!rest.length) {
    (obj as Record<string, unknown>)[head] = value
  } else {
    setNestedValue((obj as Record<string, unknown>)[head], rest, value)
  }
}

// Rename a key at a given path inside a cloned object (preserves key order)
function renameNestedKey(obj: unknown, path: string[], newKey: string): void {
  if (!path.length || typeof obj !== 'object' || obj === null) return
  const [head, ...rest] = path
  const o = obj as Record<string, unknown>
  if (!rest.length) {
    if (!(head in o) || head === newKey) return
    const rebuilt: Record<string, unknown> = {}
    for (const k of Object.keys(o)) rebuilt[k === head ? newKey : k] = o[k]
    for (const k of Object.keys(o)) delete o[k]
    Object.assign(o, rebuilt)
  } else {
    renameNestedKey(o[head], rest, newKey)
  }
}

// Handle key renames bubbled up from NestedJsonField
function handleKeyRename(path: string[], newKey: string) {
  if (!vault.selectedSecret) return
  const topKey = path[0]
  const data = vault.selectedSecret.data

  let nativeAfter: Record<string, unknown>
  if (path.length === 1) {
    nativeAfter = {}
    for (const k of Object.keys(data)) nativeAfter[k === topKey ? newKey : k] = data[k]
  } else {
    const raw = data[topKey]
    const wasString = typeof raw === 'string'
    let current: unknown = raw
    if (typeof raw === 'string') { try { current = JSON.parse(raw) } catch {} }
    const cloned = JSON.parse(JSON.stringify(current))
    renameNestedKey(cloned, path.slice(1), newKey)
    nativeAfter = { ...data }
    nativeAfter[topKey] = wasString ? JSON.stringify(cloned) : cloned
  }
  rawWriteData.value = nativeAfter
  pendingData.value = stringifyData(nativeAfter)
  showDiff.value = true
}

// Handle leaf edits bubbled up from NestedJsonField
function handleLeafEdit(path: string[], newValue: string) {
  if (!vault.selectedSecret) return
  const topKey = path[0]
  const raw = vault.selectedSecret.data[topKey]
  const wasString = typeof raw === 'string'

  let current: unknown = raw
  if (typeof raw === 'string') { try { current = JSON.parse(raw) } catch {} }

  const cloned = JSON.parse(JSON.stringify(current))
  setNestedValue(cloned, path.slice(1), newValue)

  const nativeAfter: Record<string, unknown> = { ...vault.selectedSecret.data }
  nativeAfter[topKey] = wasString ? JSON.stringify(cloned) : cloned

  rawWriteData.value = nativeAfter
  pendingData.value = stringifyData(nativeAfter)
  showDiff.value = true
}
</script>

<template>
  <div v-if="vault.selectedSecret" class="mt-6 flex flex-col gap-3">

    <!-- ── Container 1 : Clés / Valeurs ── -->
    <div class="bg-gray-900 border border-gray-700 rounded light:bg-white light:border-gray-200">

      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800 light:border-gray-200">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-green-400 text-sm font-semibold font-mono truncate light:text-green-700">{{ vault.selectedSecret.path }}</span>
          <span v-if="saveSuccess" class="text-green-500 text-xs shrink-0">{{ t('secretPanel.saved') }}</span>
          <span v-if="rowEditError" class="text-red-400 text-xs shrink-0">⚠ {{ rowEditError }}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-2">
          <button
            v-if="!editMode && editingAllowed"
            class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
            :title="t('secretPanel.jsonEdit')"
            @click="enterEdit"
          >{{ t('secretPanel.jsonEdit') }}</button>
          <button
            v-if="!editMode"
            class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
            :title="t('secretPanel.downloadSecret')"
            @click="downloadSecret"
          >{{ t('secretPanel.downloadSecret') }}</button>
          <button
            v-if="!editMode"
            class="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors light:hover:text-gray-800 light:hover:bg-gray-200"
            :title="valuesVisible ? t('secretPanel.hideValues') : t('secretPanel.showValues')"
            @click="valuesVisible = !valuesVisible"
          >
            <svg v-if="valuesVisible" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </button>
          <button class="text-gray-500 hover:text-gray-300 text-xs" @click="vault.selectedSecret = null">✕</button>
        </div>
      </div>

      <!-- Loading / error -->
      <div v-if="vault.secretLoading" class="px-4 py-8 text-gray-500 text-sm animate-pulse text-center light:text-gray-400">
        {{ t('secretPanel.loading') }}
      </div>
      <div v-else-if="vault.secretError" class="px-4 py-4 text-red-400 text-sm">
        {{ vault.secretError }}
      </div>

      <!-- Read mode: inline editable table -->
      <div v-else-if="!editMode" class="px-4 py-3">

        <!-- Format picker backdrop -->
        <div v-if="showRowFormatPicker" class="fixed inset-0 z-20" @click="showRowFormatPicker = false" />

        <!-- Row selection action bar -->
        <div
          v-if="selectedPaths.size > 0"
          class="flex items-center gap-2 mb-3 px-3 py-2 bg-blue-950/40 border border-blue-800/50 rounded light:bg-blue-50 light:border-blue-200"
        >
          <span class="text-blue-300 text-xs font-medium">{{ t('selectionBar.selected', { n: selectedPaths.size }) }}</span>
          <div class="flex-1" />
          <button
            class="text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors cursor-pointer light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
            @click="clearRowSelection"
          >✕ {{ t('selectionBar.clear') }}</button>
          <div class="relative z-30">
            <button
              class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors cursor-pointer light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
              :title="t('selectionBar.downloadTooltip')"
              @click="showRowFormatPicker = !showRowFormatPicker"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-green-400">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              {{ t('selectionBar.download') }}
            </button>
            <div
              v-if="showRowFormatPicker"
              class="absolute right-0 top-full mt-1 bg-gray-900 border border-gray-700 rounded shadow-xl overflow-hidden w-28 light:bg-white light:border-gray-200"
            >
              <button
                v-for="fmt in (['json', 'csv', 'yaml'] as const)"
                :key="fmt"
                class="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white transition-colors font-mono uppercase cursor-pointer light:text-gray-700 light:hover:bg-gray-100 light:hover:text-gray-900"
                @click="downloadSelectedRows(fmt)"
              >{{ fmt }}</button>
            </div>
          </div>
          <button
            v-if="vault.editingEnabled"
            class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-800 hover:bg-blue-700 text-blue-100 rounded transition-colors cursor-pointer"
            :title="t('selectionBar.cloneTooltip')"
            @click="showCloneRows = true"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
            {{ t('selectionBar.clone') }}
          </button>
        </div>

        <table class="w-full text-sm">
          <thead>
            <tr class="text-gray-500 text-xs uppercase border-b border-gray-700 light:border-gray-200 light:text-gray-400">
              <th class="text-left py-1 pr-4 w-1/3">
                <div class="flex items-center gap-2">
                  <input
                    v-if="allTopLevelKeys.length > 0"
                    type="checkbox"
                    class="accent-blue-500 w-3.5 h-3.5 cursor-pointer shrink-0"
                    :checked="allRowsSelected"
                    :indeterminate="someRowsSelected && !allRowsSelected"
                    :title="t('selectionBar.selectAll')"
                    @change="toggleAllRows"
                  />
                  {{ t('secretPanel.keyHeader') }}
                </div>
              </th>
              <th class="text-left py-1">{{ t('secretPanel.valueHeader') }}</th>
              <th v-if="editingAllowed" class="w-14"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(val, key) in vault.selectedSecret.data" :key="key">

              <!-- Nested JSON value: accordion via NestedJsonField -->
              <NestedJsonField
                v-if="parseJsonValue(val).isNested"
                :value="parseJsonValue(val).parsed"
                :key-name="String(key)"
                :depth="0"
                :editing-allowed="editingAllowed"
                :selected="selectedPaths.has(String(key))"
                :toggle-handler="() => toggleRowSelect(String(key))"
                :leaf-toggle-handler="toggleLeafPath"
                :is-leaf-selected="isPathSelected"
                @leaf-edit="handleLeafEdit"
                @key-rename="handleKeyRename"
              />

              <!-- Plain value: inline editable row -->
              <tr
                v-else
                class="group border-b border-gray-800 last:border-0 light:border-gray-200"
                :class="editingAllowed && editingRow !== String(key) ? 'cursor-pointer' : ''"
                :title="editingAllowed && editingRow !== String(key) ? t('secretPanel.editTip') : undefined"
                @dblclick="startEditRow(String(key), String(val))"
                @focusout="cancelOnRowBlur"
              >
                <!-- Key cell -->
                <td class="py-1.5 pr-4 align-middle">
                  <div v-if="editingRow !== String(key)" class="flex items-center gap-1">
                    <input
                      type="checkbox"
                      class="accent-blue-500 w-3.5 h-3.5 cursor-pointer shrink-0 mr-0.5"
                      :checked="selectedPaths.has(String(key))"
                      @click.stop
                      @change="togglePath(String(key), val)"
                    />
                    <button
                      class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-gray-300 rounded transition-colors shrink-0 cursor-pointer light:hover:text-gray-700"
                      :title="t('secretPanel.copyKey')"
                      @click.stop="copyCell(String(key), `key-${String(key)}`, t('secretPanel.copiedKey'))"
                    >
                      <span v-if="copiedCell === `key-${String(key)}`" class="text-green-400 text-xs">✓</span>
                      <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                      </svg>
                    </button>
                    <span
                      class="font-mono text-xs break-all"
                      :class="rowSaveSuccess === String(key) ? 'text-green-400 light:text-green-700' : 'text-blue-300 light:text-blue-700'"
                    >{{ key }}</span>
                  </div>
                  <input
                    v-else
                    v-focus
                    v-model="editingRowKey"
                    class="w-full bg-gray-800 border border-yellow-500 text-yellow-200 font-mono text-xs rounded px-2 py-0.5 focus:outline-none focus:border-yellow-400 light:bg-white light:text-yellow-700 light:border-yellow-400"
                    :placeholder="t('secretPanel.keyNamePlaceholder')"
                    @keyup.enter="saveRow(String(key))"
                    @keyup.escape="cancelEditRow"
                    @click.stop
                  />
                </td>

                <!-- Value cell -->
                <td class="py-1.5 font-mono text-xs align-middle">
                  <div v-if="editingRow !== String(key)" class="flex items-center gap-1.5">
                    <button
                      class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-gray-300 rounded transition-colors shrink-0 cursor-pointer light:hover:text-gray-700"
                      :title="t('secretPanel.copyValue')"
                      @click.stop="copyCell(String(val), `val-${String(key)}`, t('secretPanel.copiedValue'))"
                    >
                      <span v-if="copiedCell === `val-${String(key)}`" class="text-green-400 text-xs">✓</span>
                      <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                      </svg>
                    </button>
                    <SmartValueCell :value="val" :masked="!valuesVisible" />
                    <span v-if="rowSaveSuccess === String(key)" class="text-green-400 shrink-0">✓</span>
                  </div>
                  <div v-else class="flex items-center gap-1" @click.stop @dblclick.stop>
                    <SmartEditValue
                      v-model="editingRowValue"
                      :original-value="val"
                      :autofocus="false"
                      @confirm="saveRow(String(key))"
                      @cancel="cancelEditRow"
                    />
                  </div>
                </td>

                <!-- Delete key -->
                <td v-if="editingAllowed" class="py-2 text-right align-middle">
                  <button
                    v-if="editingRow !== String(key)"
                    class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 rounded transition-colors light:hover:text-red-600"
                    :title="t('secretPanel.deleteKeyTitle', { key })"
                    @click.stop="removeKey(String(key))"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
        <div class="mt-3 text-xs text-gray-600 flex items-center gap-2 light:text-gray-500">
          <span>v{{ (vault.selectedSecret.metadata as Record<string, unknown>)?.version }} · {{ String((vault.selectedSecret.metadata as Record<string, unknown>)?.created_time ?? '').substring(0, 10) }}</span>
          <span v-if="editingAllowed" class="text-gray-700 light:text-gray-500">· {{ t('secretPanel.editTip') }}</span>
        </div>
      </div>

      <!-- JSON edit mode (advanced) -->
      <div v-else class="px-4 py-3">
        <p class="text-gray-500 text-xs mb-2 light:text-gray-600">{{ t('secretPanel.jsonEditHint') }}</p>
        <textarea
          v-model="editJson"
          class="w-full h-64 bg-gray-950 border border-gray-700 text-green-300 font-mono text-xs rounded p-3 resize-y focus:outline-none focus:border-green-600 light:bg-gray-50 light:border-gray-300 light:text-green-800"
          spellcheck="false"
          autocomplete="off"
        />
        <div v-if="jsonError" class="mt-2 text-red-400 text-xs">⚠ {{ jsonError }}</div>
        <div class="flex gap-2 mt-3">
          <button class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded" @click="requestSave">
            {{ t('secretPanel.previewChanges') }}
          </button>
          <button class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded light:text-gray-600 light:hover:text-gray-800 light:border-gray-300" @click="cancelEdit">
            {{ t('secretPanel.cancel') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Container 2 : Historique des versions ── -->
    <div class="bg-gray-900 border border-gray-700 rounded light:bg-white light:border-gray-200">
      <VersionTimeline
        :path="vault.selectedSecret.path"
        :current-data="stringifyData(vault.selectedSecret.data)"
        @restore="handleRestore"
      />
    </div>

  </div>

  <!-- Copy toast -->
  <Transition name="toast">
    <div
      v-if="toastVisible"
      class="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl text-xs text-gray-200 light:bg-white light:border-gray-300 light:text-gray-800"
    >
      <span class="text-green-400">✓</span>
      {{ toastMessage }}
    </div>
  </Transition>

  <!-- Diff confirmation modal (JSON bulk edit, key delete, restore) -->
  <ConfirmDiffModal
    v-if="showDiff && vault.selectedSecret"
    :path="vault.selectedSecret.path"
    :before="currentBefore"
    :after="pendingData"
    @confirm="confirmSave"
    @cancel="showDiff = false; rawWriteData = null"
  />

  <!-- Clone selected KV rows -->
  <CloneModal
    v-if="showCloneRows"
    :selected-data="selectedRowsData"
    :selected-leaf-paths="selectedLeafPathsList"
    @close="showCloneRows = false"
    @cloned="() => { clearRowSelection(); showCloneRows = false }"
  />
</template>

<style scoped>
.toast-enter-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.toast-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }
</style>

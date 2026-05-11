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
  try {
    await vault.writeSecret(path, pendingData.value)
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
  const without = stringifyData(vault.selectedSecret.data)
  delete without[key]
  pendingData.value = without
  showDiff.value = true
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

  if (path.length === 1) {
    const before = stringifyData(vault.selectedSecret.data)
    const after: Record<string, string> = {}
    for (const k of Object.keys(before)) after[k === topKey ? newKey : k] = before[k]
    pendingData.value = after
  } else {
    const raw = vault.selectedSecret.data[topKey]
    let current: unknown = raw
    if (typeof raw === 'string') { try { current = JSON.parse(raw) } catch {} }
    const cloned = JSON.parse(JSON.stringify(current))
    renameNestedKey(cloned, path.slice(1), newKey)
    const after = stringifyData(vault.selectedSecret.data)
    after[topKey] = JSON.stringify(cloned)
    pendingData.value = after
  }
  showDiff.value = true
}

// Handle leaf edits bubbled up from NestedJsonField
function handleLeafEdit(path: string[], newValue: string) {
  if (!vault.selectedSecret) return
  const topKey = path[0]
  const raw = vault.selectedSecret.data[topKey]

  let current: unknown = raw
  if (typeof raw === 'string') {
    try { current = JSON.parse(raw) } catch {}
  }

  const cloned = JSON.parse(JSON.stringify(current))
  setNestedValue(cloned, path.slice(1), newValue)
  const serialized = JSON.stringify(cloned)

  const after = stringifyData(vault.selectedSecret.data)
  after[topKey] = serialized

  pendingData.value = after
  showDiff.value = true
}
</script>

<template>
  <div v-if="vault.selectedSecret" class="mt-6 flex flex-col gap-3">

    <!-- ── Container 1 : Clés / Valeurs ── -->
    <div class="bg-gray-900 border border-gray-700 rounded">

      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-green-400 text-sm font-semibold font-mono truncate">{{ vault.selectedSecret.path }}</span>
          <span v-if="saveSuccess" class="text-green-500 text-xs shrink-0">{{ t('secretPanel.saved') }}</span>
          <span v-if="rowEditError" class="text-red-400 text-xs shrink-0">⚠ {{ rowEditError }}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-2">
          <button
            v-if="!editMode && editingAllowed"
            class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            :title="t('secretPanel.jsonEdit')"
            @click="enterEdit"
          >{{ t('secretPanel.jsonEdit') }}</button>
          <button
            v-if="!editMode"
            class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            :title="t('secretPanel.downloadSecret')"
            @click="downloadSecret"
          >{{ t('secretPanel.downloadSecret') }}</button>
          <button class="text-gray-500 hover:text-gray-300 text-xs" @click="vault.selectedSecret = null">✕</button>
        </div>
      </div>

      <!-- Loading / error -->
      <div v-if="vault.secretLoading" class="px-4 py-8 text-gray-500 text-sm animate-pulse text-center">
        {{ t('secretPanel.loading') }}
      </div>
      <div v-else-if="vault.secretError" class="px-4 py-4 text-red-400 text-sm">
        {{ vault.secretError }}
      </div>

      <!-- Read mode: inline editable table -->
      <div v-else-if="!editMode" class="px-4 py-3">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-gray-500 text-xs uppercase border-b border-gray-700">
              <th class="text-left py-1 pr-4 w-1/3">{{ t('secretPanel.keyHeader') }}</th>
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
                @leaf-edit="handleLeafEdit"
                @key-rename="handleKeyRename"
              />

              <!-- Plain value: inline editable row -->
              <tr
                v-else
                class="group border-b border-gray-800 last:border-0"
                :class="editingAllowed && editingRow !== String(key) ? 'cursor-pointer' : ''"
                :title="editingAllowed && editingRow !== String(key) ? t('secretPanel.editTip') : undefined"
                @dblclick="startEditRow(String(key), String(val))"
                @focusout="cancelOnRowBlur"
              >
                <!-- Key cell -->
                <td class="py-1.5 pr-4 align-middle">
                  <span
                    v-if="editingRow !== String(key)"
                    class="font-mono text-xs break-all"
                    :class="rowSaveSuccess === String(key) ? 'text-green-400' : 'text-blue-300'"
                  >{{ key }}</span>
                  <input
                    v-else
                    v-focus
                    v-model="editingRowKey"
                    class="w-full bg-gray-800 border border-yellow-500 text-yellow-200 font-mono text-xs rounded px-2 py-0.5 focus:outline-none focus:border-yellow-400"
                    :placeholder="t('secretPanel.keyNamePlaceholder')"
                    @keyup.enter="saveRow(String(key))"
                    @keyup.escape="cancelEditRow"
                    @click.stop
                  />
                </td>

                <!-- Value cell -->
                <td class="py-1.5 font-mono text-xs align-middle">
                  <div v-if="editingRow !== String(key)" class="flex items-center gap-1.5">
                    <SmartValueCell :value="val" />
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
                    class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 rounded transition-colors"
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
        <div class="mt-3 text-xs text-gray-600 flex items-center gap-2">
          <span>v{{ (vault.selectedSecret.metadata as Record<string, unknown>)?.version }} · {{ String((vault.selectedSecret.metadata as Record<string, unknown>)?.created_time ?? '').substring(0, 10) }}</span>
          <span v-if="editingAllowed" class="text-gray-700">· {{ t('secretPanel.editTip') }}</span>
        </div>
      </div>

      <!-- JSON edit mode (advanced) -->
      <div v-else class="px-4 py-3">
        <p class="text-gray-500 text-xs mb-2">{{ t('secretPanel.jsonEditHint') }}</p>
        <textarea
          v-model="editJson"
          class="w-full h-64 bg-gray-950 border border-gray-700 text-green-300 font-mono text-xs rounded p-3 resize-y focus:outline-none focus:border-green-600"
          spellcheck="false"
          autocomplete="off"
        />
        <div v-if="jsonError" class="mt-2 text-red-400 text-xs">⚠ {{ jsonError }}</div>
        <div class="flex gap-2 mt-3">
          <button class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded" @click="requestSave">
            {{ t('secretPanel.previewChanges') }}
          </button>
          <button class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded" @click="cancelEdit">
            {{ t('secretPanel.cancel') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Container 2 : Historique des versions ── -->
    <div class="bg-gray-900 border border-gray-700 rounded">
      <VersionTimeline
        :path="vault.selectedSecret.path"
        :current-data="stringifyData(vault.selectedSecret.data)"
        @restore="handleRestore"
      />
    </div>

  </div>

  <!-- Diff confirmation modal (JSON bulk edit, key delete, restore) -->
  <ConfirmDiffModal
    v-if="showDiff && vault.selectedSecret"
    :path="vault.selectedSecret.path"
    :before="currentBefore"
    :after="pendingData"
    @confirm="confirmSave"
    @cancel="showDiff = false"
  />
</template>

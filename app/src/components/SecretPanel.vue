<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const vFocus = { mounted: (el: HTMLElement) => (el as HTMLInputElement).focus() }
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'
import VersionTimeline from './VersionTimeline.vue'

const vault = useVaultStore()
const editingAllowed = computed(() => vault.editingEnabled)

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
      throw new Error('Le JSON doit être un objet {clé: valeur}')
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
        throw new Error(`La valeur de "${k}" doit être une chaîne`)
    }
    pendingData.value = Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v)])
    )
    showDiff.value = true
  } catch (e: unknown) {
    jsonError.value = e instanceof Error ? e.message : 'JSON invalide'
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
    jsonError.value = e instanceof Error ? e.message : 'Erreur lors de la sauvegarde'
  }
}

// ---- Inline row editing (key + value in one shot) ----
const editingRow = ref<string | null>(null)   // original key of the row being edited
const editingRowKey = ref('')
const editingRowValue = ref('')
const rowEditError = ref<string | null>(null)
const rowSaveSuccess = ref<string | null>(null) // new key name after successful save

function startEditRow(key: string, val: string) {
  if (!editingAllowed.value || editMode.value) return
  editingRow.value = key
  editingRowKey.value = key
  editingRowValue.value = val
  rowEditError.value = null
}

function cancelEditRow() {
  editingRow.value = null
  rowEditError.value = null
}

async function saveRow(originalKey: string) {
  if (!vault.selectedSecret) return
  const newKey = editingRowKey.value.trim()
  if (!newKey) { cancelEditRow(); return }

  // Skip write if nothing actually changed
  if (newKey === originalKey && editingRowValue.value === vault.selectedSecret.data[originalKey]) {
    cancelEditRow()
    return
  }

  editingRow.value = null
  rowEditError.value = null

  // Rebuild preserving key order, renaming in place if needed
  const newData: Record<string, string> = {}
  for (const [k, v] of Object.entries(vault.selectedSecret.data)) {
    newData[k === originalKey ? newKey : k] = k === originalKey ? editingRowValue.value : v
  }

  try {
    await vault.writeSecret(vault.selectedSecret.path, newData)
    await vault.readSecret(vault.selectedSecret.path)
    rowSaveSuccess.value = newKey
    setTimeout(() => { if (rowSaveSuccess.value === newKey) rowSaveSuccess.value = null }, 2000)
    await vault.fetchVersions(vault.selectedSecret.path)
  } catch (e: unknown) {
    rowEditError.value = e instanceof Error ? e.message : 'Erreur lors de la sauvegarde'
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
  const without = { ...vault.selectedSecret.data }
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

const currentBefore = computed(() => vault.selectedSecret?.data ?? {})
</script>

<template>
  <div v-if="vault.selectedSecret" class="mt-6 flex flex-col gap-3">

    <!-- ── Container 1 : Clés / Valeurs ── -->
    <div class="bg-gray-900 border border-gray-700 rounded">

      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-green-400 text-sm font-semibold font-mono truncate">{{ vault.selectedSecret.path }}</span>
          <span v-if="saveSuccess" class="text-green-500 text-xs shrink-0">✓ Sauvegardé</span>
          <span v-if="rowEditError" class="text-red-400 text-xs shrink-0">⚠ {{ rowEditError }}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-2">
          <button
            v-if="!editMode && editingAllowed"
            class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            title="Édition JSON avancée"
            @click="enterEdit"
          >✏ JSON</button>
          <button
            v-if="!editMode"
            class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            title="Télécharger ce secret"
            @click="downloadSecret"
          >⬇ Download</button>
          <button class="text-gray-500 hover:text-gray-300 text-xs" @click="vault.selectedSecret = null">✕</button>
        </div>
      </div>

      <!-- Loading / error -->
      <div v-if="vault.secretLoading" class="px-4 py-8 text-gray-500 text-sm animate-pulse text-center">
        Chargement…
      </div>
      <div v-else-if="vault.secretError" class="px-4 py-4 text-red-400 text-sm">
        {{ vault.secretError }}
      </div>

      <!-- Read mode: inline editable table -->
      <div v-else-if="!editMode" class="px-4 py-3">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-gray-500 text-xs uppercase border-b border-gray-700">
              <th class="text-left py-1 pr-4 w-1/3">Clé</th>
              <th class="text-left py-1">Valeur</th>
              <th v-if="editingAllowed" class="w-14"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(val, key) in vault.selectedSecret.data"
              :key="key"
              class="group border-b border-gray-800 last:border-0"
              :class="editingAllowed && editingRow !== String(key) ? 'cursor-pointer' : ''"
              @dblclick="startEditRow(String(key), String(val))"
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
                  placeholder="Nom de la clé"
                  @keyup.enter="saveRow(String(key))"
                  @keyup.escape="cancelEditRow"
                  @click.stop
                />
              </td>

              <!-- Value cell -->
              <td class="py-1.5 font-mono text-xs align-middle">
                <div v-if="editingRow !== String(key)" class="flex items-center gap-1.5">
                  <span
                    class="break-all"
                    :class="rowSaveSuccess === String(key) ? 'text-green-400' : 'text-gray-300'"
                  >{{ val }}</span>
                  <span v-if="rowSaveSuccess === String(key)" class="text-green-400 shrink-0">✓</span>
                </div>
                <div v-else class="flex items-center gap-1">
                  <input
                    v-model="editingRowValue"
                    class="flex-1 min-w-0 bg-gray-800 border border-blue-500 text-gray-100 font-mono text-xs rounded px-2 py-0.5 focus:outline-none focus:border-blue-400"
                    @keyup.enter="saveRow(String(key))"
                    @keyup.escape="cancelEditRow"
                    @click.stop
                  />
                  <button
                    class="text-green-400 hover:text-green-300 text-sm shrink-0"
                    title="Sauvegarder (Entrée)"
                    @click.stop="saveRow(String(key))"
                  >✓</button>
                  <button
                    class="text-gray-500 hover:text-gray-300 text-xs shrink-0"
                    title="Annuler (Échap)"
                    @click.stop="cancelEditRow"
                  >✕</button>
                </div>
              </td>

              <!-- Delete key -->
              <td v-if="editingAllowed" class="py-2 text-right align-middle">
                <button
                  v-if="editingRow !== String(key)"
                  class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                  :title="`Supprimer la clé ${key}`"
                  @click.stop="removeKey(String(key))"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="mt-3 text-xs text-gray-600 flex items-center gap-2">
          <span>v{{ (vault.selectedSecret.metadata as Record<string, unknown>)?.version }} · {{ String((vault.selectedSecret.metadata as Record<string, unknown>)?.created_time ?? '').substring(0, 10) }}</span>
          <span v-if="editingAllowed" class="text-gray-700">· Double-cliquez sur une ligne pour modifier</span>
        </div>
      </div>

      <!-- JSON edit mode (advanced) -->
      <div v-else class="px-4 py-3">
        <p class="text-gray-500 text-xs mb-2">Modifiez le JSON ci-dessous. Toutes les valeurs doivent être des chaînes.</p>
        <textarea
          v-model="editJson"
          class="w-full h-64 bg-gray-950 border border-gray-700 text-green-300 font-mono text-xs rounded p-3 resize-y focus:outline-none focus:border-green-600"
          spellcheck="false"
          autocomplete="off"
        />
        <div v-if="jsonError" class="mt-2 text-red-400 text-xs">⚠ {{ jsonError }}</div>
        <div class="flex gap-2 mt-3">
          <button class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded" @click="requestSave">
            Prévisualiser les changements
          </button>
          <button class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded" @click="cancelEdit">
            Annuler
          </button>
        </div>
      </div>
    </div>

    <!-- ── Container 2 : Historique des versions ── -->
    <div class="bg-gray-900 border border-gray-700 rounded">
      <VersionTimeline
        :path="vault.selectedSecret.path"
        :current-data="vault.selectedSecret.data"
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

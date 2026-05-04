<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'

const vault = useVaultStore()
const editingAllowed = computed(() => vault.editingEnabled)

// ---- Edit state ----
const editMode = ref(false)
const editJson = ref('')
const jsonError = ref<string | null>(null)
const saveSuccess = ref(false)
const showDiff = ref(false)
const pendingData = ref<Record<string, string>>({})

function enterEdit() {
  if (!vault.selectedSecret) return
  editJson.value = JSON.stringify(vault.selectedSecret.data, null, 2)
  jsonError.value = null
  editMode.value = true
  saveSuccess.value = false
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
    // ensure all values are strings
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
  showDiff.value = false
  try {
    await vault.writeSecret(vault.selectedSecret.path, pendingData.value)
    // Reload
    await vault.readSecret(vault.selectedSecret.path)
    editMode.value = false
    saveSuccess.value = true
    setTimeout(() => (saveSuccess.value = false), 3000)
  } catch (e: unknown) {
    jsonError.value = e instanceof Error ? e.message : 'Erreur lors de la sauvegarde'
  }
}

// ---- Download ----
function downloadSecret() {
  if (!vault.selectedSecret) return
  const filename = vault.selectedSecret.path.replace(/\//g, '_') + '.json'
  const content = JSON.stringify(
    { [vault.selectedSecret.path]: vault.selectedSecret.data },
    null,
    2
  )
  triggerDownload(filename, content)
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function removeKey(key: string) {
  if (!vault.selectedSecret) return
  const without = { ...vault.selectedSecret.data }
  delete without[key]
  pendingData.value = without
  showDiff.value = true
}

// Reset edit mode when secret changes
watch(() => vault.selectedSecret?.path, () => {
  editMode.value = false
  jsonError.value = null
  saveSuccess.value = false
})

const currentBefore = computed(() => vault.selectedSecret?.data ?? {})
</script>

<template>
  <div v-if="vault.selectedSecret" class="mt-6 bg-gray-900 border border-gray-700 rounded">
    <!-- Panel header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
      <div class="flex items-center gap-2">
        <span class="text-green-400 text-sm font-semibold font-mono">{{ vault.selectedSecret.path }}</span>
        <span v-if="saveSuccess" class="text-green-500 text-xs">✓ Sauvegardé</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="!editMode && editingAllowed"
          class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
          @click="enterEdit"
        >✏ Éditer</button>
        <button
          v-if="!editMode"
          class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
          @click="downloadSecret"
          title="Télécharger ce secret"
        >⬇ Download</button>
        <button
          class="text-gray-500 hover:text-gray-300 text-xs"
          @click="vault.selectedSecret = null"
        >✕</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="vault.secretLoading" class="px-4 py-8 text-gray-500 text-sm animate-pulse text-center">
      Chargement…
    </div>
    <div v-else-if="vault.secretError" class="px-4 py-4 text-red-400 text-sm">
      {{ vault.secretError }}
    </div>

    <!-- Read mode: table -->
    <div v-else-if="!editMode" class="px-4 py-3">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-gray-500 text-xs uppercase border-b border-gray-700">
            <th class="text-left py-1 pr-4 w-1/3">Clé</th>
            <th class="text-left py-1">Valeur</th>
            <th v-if="editingAllowed" class="w-6"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(val, key) in vault.selectedSecret.data"
            :key="key"
            class="group border-b border-gray-800 last:border-0"
          >
            <td class="py-2 pr-4 text-blue-300 font-mono text-xs">{{ key }}</td>
            <td class="py-2 text-gray-300 break-all font-mono text-xs">{{ val }}</td>
            <td v-if="editingAllowed" class="py-2 text-right">
              <button
                class="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                :title="`Supprimer la clé ${key}`"
                @click="removeKey(String(key))"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="mt-3 text-xs text-gray-600">
        v{{ (vault.selectedSecret.metadata as Record<string, unknown>)?.version }} ·
        {{ String((vault.selectedSecret.metadata as Record<string, unknown>)?.created_time ?? '').substring(0, 10) }}
      </div>
    </div>

    <!-- Edit mode: JSON textarea -->
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
        <button
          class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded"
          @click="requestSave"
        >Prévisualiser les changements</button>
        <button
          class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded"
          @click="cancelEdit"
        >Annuler</button>
      </div>
    </div>
  </div>

  <!-- Diff confirmation modal -->
  <ConfirmDiffModal
    v-if="showDiff && vault.selectedSecret"
    :path="vault.selectedSecret.path"
    :before="currentBefore"
    :after="pendingData"
    @confirm="confirmSave"
    @cancel="showDiff = false"
  />
</template>

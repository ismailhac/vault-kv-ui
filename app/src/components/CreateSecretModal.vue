<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'

const { t } = useI18n()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

// ── Root project presets ──
function isRelated(project: string, nsLabel: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[-_]/g, '')
  return n(project).includes(n(nsLabel)) || n(nsLabel).includes(n(project))
}

const rootFolders = ref<string[]>([])

onMounted(async () => {
  if (vault.currentPath) return // already inside a project, no need
  try {
    const params = new URLSearchParams({ path: '', mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/list?${params}`)
    if (res.ok) {
      const json = await res.json()
      rootFolders.value = (json.keys as string[]).filter((k: string) => k.endsWith('/')).map((k: string) => k.replace(/\/$/, ''))
    }
  } catch {}
})

const suggestedFolders = computed(() => rootFolders.value.filter(p => isRelated(p, vault.currentNamespaceLabel)))
const otherFolders = computed(() => rootFolders.value.filter(p => !isRelated(p, vault.currentNamespaceLabel)))

function applyPreset(folder: string) {
  newPath.value = `${folder}/`
  pathError.value = null
}

type Mode = 'form' | 'json'
const mode = ref<Mode>('form')
const newPath = ref('')
const jsonInput = ref('{\n  "KEY": "value"\n}')
const formRows = ref([{ key: '', value: '' }])
const jsonError = ref<string | null>(null)
const pathError = ref<string | null>(null)
const showConfirm = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)

const fullPath = computed(() => {
  const p = newPath.value.trim().replace(/^\/+|\/+$/g, '')
  return vault.currentPath ? `${vault.currentPath}/${p}` : p
})

const parsedData = computed((): Record<string, string> | null => {
  if (mode.value === 'json') {
    try {
      const parsed = JSON.parse(jsonInput.value)
      if (typeof parsed !== 'object' || Array.isArray(parsed)) return null
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
    } catch {
      return null
    }
  }
  const rows = formRows.value.filter(r => r.key.trim())
  if (rows.length === 0) return null
  return Object.fromEntries(rows.map(r => [r.key.trim(), r.value]))
})

function switchMode(m: Mode) {
  if (m === mode.value) return
  jsonError.value = null
  if (m === 'json') {
    const d = parsedData.value
    jsonInput.value = d && Object.keys(d).length ? JSON.stringify(d, null, 2) : '{\n  "KEY": "value"\n}'
  } else {
    const d = parsedData.value
    formRows.value = d && Object.keys(d).length
      ? Object.entries(d).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }]
  }
  mode.value = m
}

function addRow() {
  formRows.value.push({ key: '', value: '' })
}

function removeRow(i: number) {
  if (formRows.value.length > 1) formRows.value.splice(i, 1)
  else formRows.value[0] = { key: '', value: '' }
}

function requestPreview() {
  pathError.value = null
  jsonError.value = null
  saveError.value = null

  if (!newPath.value.trim()) {
    pathError.value = t('createSecretModal.pathRequired')
    return
  }
  if (mode.value === 'json') {
    try {
      const parsed = JSON.parse(jsonInput.value)
      if (typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error(t('createSecretModal.jsonMustBeObject'))
    } catch (e: unknown) {
      jsonError.value = e instanceof Error ? e.message : t('createSecretModal.jsonMustBeObject')
      return
    }
  } else {
    if (!formRows.value.some(r => r.key.trim())) {
      jsonError.value = t('createSecretModal.addAtLeastOneKey')
      return
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
    emit('close')
    await vault.listPath(vault.currentPath)
  } catch (e: unknown) {
    saveError.value = e instanceof Error ? e.message : t('createSecretModal.createError')
    saving.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700">
        <span class="text-white font-semibold text-sm">{{ t('createSecretModal.title') }}</span>
        <button class="text-gray-500 hover:text-gray-300" @click="emit('close')">✕</button>
      </div>

      <div class="overflow-auto flex-1 px-5 py-4 space-y-4">

        <!-- Path input -->
        <div>
          <label class="text-gray-400 text-xs block mb-1.5">{{ t('createSecretModal.pathLabel') }}</label>
          <div class="flex items-center gap-1 bg-gray-950 border rounded px-3 py-2 focus-within:border-green-600 transition-colors"
               :class="pathError ? 'border-red-600' : 'border-gray-700'">
            <span v-if="vault.currentPath" class="text-gray-600 text-xs font-mono shrink-0 select-none">
              {{ vault.currentPath }}/
            </span>
            <input
              v-model="newPath"
              placeholder="mon-app/prod/config"
              class="flex-1 bg-transparent text-green-300 font-mono text-xs focus:outline-none placeholder-gray-700"
              @keydown.enter="requestPreview"
            />
          </div>
          <p v-if="pathError" class="mt-1 text-red-400 text-xs">⚠ {{ pathError }}</p>
          <p v-else-if="newPath.trim()" class="mt-1 text-gray-600 text-xs font-mono">
            → {{ fullPath }}
          </p>
          <!-- Project presets — only at root -->
          <div v-if="!vault.currentPath && rootFolders.length" class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="p in suggestedFolders" :key="p"
              type="button"
              class="px-2 py-0.5 text-[11px] font-mono rounded border transition"
              :class="newPath.startsWith(p + '/') || newPath === p + '/'
                ? 'bg-green-900 border-green-700 text-green-200'
                : 'bg-green-950/50 border-green-900 text-green-400 hover:border-green-700 hover:text-green-200'"
              @click="applyPreset(p)"
            >{{ p }}</button>
            <button
              v-for="p in otherFolders" :key="p"
              type="button"
              class="px-2 py-0.5 text-[11px] font-mono rounded border transition bg-gray-900 border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
              @click="applyPreset(p)"
            >{{ p }}</button>
          </div>
        </div>

        <!-- Mode selector -->
        <div class="flex gap-1 p-0.5 bg-gray-800 rounded w-fit">
          <button
            type="button"
            class="px-3 py-1 text-xs rounded transition"
            :class="mode === 'form' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'"
            @click="switchMode('form')"
          >{{ t('createSecretModal.modeForm') }}</button>
          <button
            type="button"
            class="px-3 py-1 text-xs rounded transition"
            :class="mode === 'json' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'"
            @click="switchMode('json')"
          >{{ t('createSecretModal.modeJson') }}</button>
        </div>

        <!-- Form mode -->
        <div v-if="mode === 'form'" class="space-y-2">
          <div class="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs text-gray-600 px-1">
            <span>{{ t('createSecretModal.keyColumn') }}</span><span>{{ t('createSecretModal.valueColumn') }}</span><span></span>
          </div>
          <div
            v-for="(row, i) in formRows"
            :key="i"
            class="grid grid-cols-[1fr_2fr_auto] gap-2 items-center"
          >
            <input
              v-model="row.key"
              :placeholder="t('createSecretModal.keyPlaceholder')"
              class="px-2 py-1.5 bg-gray-950 border border-gray-700 text-blue-300 font-mono text-xs rounded focus:outline-none focus:border-blue-700 placeholder-gray-700"
            />
            <input
              v-model="row.value"
              :placeholder="t('createSecretModal.valuePlaceholder')"
              class="px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-300 font-mono text-xs rounded focus:outline-none focus:border-gray-500 placeholder-gray-700"
              @keydown.enter="requestPreview"
            />
            <button
              type="button"
              class="text-gray-700 hover:text-red-400 transition text-sm w-6 text-center"
              @click="removeRow(i)"
            >✕</button>
          </div>
          <button
            type="button"
            class="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200 transition mt-1"
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
            class="w-full h-64 bg-gray-950 border border-gray-700 text-green-300 font-mono text-xs rounded p-3 resize-y focus:outline-none focus:border-green-600"
            spellcheck="false"
            autocomplete="off"
          />
        </div>

        <!-- Errors -->
        <p v-if="jsonError" class="text-red-400 text-xs">⚠ {{ jsonError }}</p>
        <p v-if="saveError" class="text-red-400 text-xs">⚠ {{ saveError }}</p>

        <!-- Actions -->
        <div class="flex gap-2 pt-1">
          <button
            class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded transition"
            :disabled="saving"
            @click="requestPreview"
          >
            {{ saving ? t('createSecretModal.creating') : t('createSecretModal.preview') }}
          </button>
          <button
            class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition"
            @click="emit('close')"
          >{{ t('createSecretModal.cancel') }}</button>
        </div>

      </div>
    </div>
  </div>

  <!-- Diff confirm — before is always empty (new secret) -->
  <ConfirmDiffModal
    v-if="showConfirm && parsedData"
    :path="fullPath"
    :before="{}"
    :after="parsedData"
    @confirm="confirmCreate"
    @cancel="showConfirm = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'

const { t } = useI18n()
const props = defineProps<{ path: string; isFolder: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const vault = useVaultStore()

// ── Tree data ──
type TreeGroup = { folder: string; secrets: string[] }

const allPaths = ref<string[]>([])
const selectedPaths = ref<Set<string>>(new Set())
const loadingPaths = ref(false)
const deleting = ref(false)
const error = ref<string | null>(null)

function buildTree(paths: string[]): TreeGroup[] {
  const groups: Record<string, string[]> = {}
  for (const p of [...paths].sort()) {
    const parts = p.split('/')
    const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    if (!groups[folder]) groups[folder] = []
    groups[folder].push(parts[parts.length - 1])
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, secrets]) => ({ folder, secrets }))
}

const tree = computed(() => buildTree(allPaths.value))

const allSelected = computed(() =>
  allPaths.value.length > 0 && allPaths.value.every(p => selectedPaths.value.has(p))
)
const someSelected = computed(() =>
  allPaths.value.some(p => selectedPaths.value.has(p))
)
const selectedCount = computed(() => selectedPaths.value.size)

function toggleAll() {
  if (allSelected.value) {
    selectedPaths.value = new Set()
  } else {
    selectedPaths.value = new Set(allPaths.value)
  }
}

function togglePath(path: string) {
  const next = new Set(selectedPaths.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  selectedPaths.value = next
}

function toggleFolder(group: TreeGroup) {
  const fullPaths = group.secrets.map(s => group.folder ? `${group.folder}/${s}` : s)
  const allChecked = fullPaths.every(p => selectedPaths.value.has(p))
  const next = new Set(selectedPaths.value)
  for (const p of fullPaths) allChecked ? next.delete(p) : next.add(p)
  selectedPaths.value = next
}

function folderAllChecked(group: TreeGroup): boolean {
  return group.secrets.every(s => {
    const p = group.folder ? `${group.folder}/${s}` : s
    return selectedPaths.value.has(p)
  })
}

onMounted(async () => {
  if (!props.isFolder) return
  loadingPaths.value = true
  try {
    const params = new URLSearchParams({ path: props.path, mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (res.ok) {
      const json = await res.json()
      const data = json?.data ?? json
      const paths = typeof data === 'object' && data !== null ? Object.keys(data).sort() : []
      allPaths.value = paths
      selectedPaths.value = new Set(paths)
    }
  } catch {}
  loadingPaths.value = false
})

async function confirm() {
  deleting.value = true
  error.value = null
  try {
    if (!props.isFolder) {
      await vault.deleteSecret(props.path)
    } else if (allSelected.value) {
      // All selected → single aggregate delete-folder call
      await vault.deleteFolder(props.path)
    } else {
      // Partial selection → individual deletes
      for (const p of selectedPaths.value) {
        await vault.deleteSecret(p)
      }
    }
    emit('confirm')
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Error'
    deleting.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
    @click.self="emit('cancel')"
  >
    <div class="bg-gray-900 border border-red-900 rounded-lg w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">

      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-gray-800 shrink-0">
        <div class="w-8 h-8 rounded-full bg-red-950 flex items-center justify-center shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-red-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-white font-semibold text-sm">
            {{ isFolder ? t('deleteConfirmModal.deleteFolder') : t('deleteConfirmModal.deleteSecret') }}
          </div>
          <div class="text-gray-500 text-xs mt-0.5 font-mono truncate">{{ path }}{{ isFolder ? '/' : '' }}</div>
        </div>
        <button class="text-gray-500 hover:text-gray-300 shrink-0" @click="emit('cancel')">✕</button>
      </div>

      <!-- Single secret body -->
      <div v-if="!isFolder" class="px-5 py-4 space-y-3">
        <p class="text-gray-400 text-xs">
          {{ t('deleteConfirmModal.secretDeleteWarning') }}
        </p>
        <p v-if="error" class="text-red-400 text-xs">⚠ {{ error }}</p>
      </div>

      <!-- Folder body: loading -->
      <div v-else-if="loadingPaths" class="px-5 py-8 text-center text-gray-500 text-sm animate-pulse">
        {{ t('deleteConfirmModal.loadingSecrets') }}
      </div>

      <!-- Folder body: tree + checkboxes -->
      <div v-else class="flex flex-col min-h-0 flex-1">
        <!-- Controls bar -->
        <div class="flex items-center justify-between px-5 py-2 border-b border-gray-800 shrink-0">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              class="accent-red-500 w-3.5 h-3.5"
              :checked="allSelected"
              :indeterminate="someSelected && !allSelected"
              @change="toggleAll"
            />
            <span class="text-gray-400 text-xs">
              {{ t('deleteConfirmModal.selectedCount', { selected: selectedCount, total: allPaths.length }) }}
            </span>
          </label>
          <span class="text-gray-600 text-xs">{{ allPaths.length === 0 ? t('deleteConfirmModal.emptyFolder') : t('deleteConfirmModal.scrollDown') }}</span>
        </div>

        <!-- Scrollable tree -->
        <div class="overflow-y-auto flex-1 px-2 py-2 space-y-1">
          <div v-for="group in tree" :key="group.folder">
            <!-- Folder header -->
            <div
              class="flex items-center gap-2 px-3 py-1 rounded cursor-pointer hover:bg-gray-800 select-none group"
              @click="toggleFolder(group)"
            >
              <input
                type="checkbox"
                class="accent-red-500 w-3 h-3 shrink-0"
                :checked="folderAllChecked(group)"
                :indeterminate="group.secrets.some(s => selectedPaths.has(group.folder ? `${group.folder}/${s}` : s)) && !folderAllChecked(group)"
                @change.stop="toggleFolder(group)"
                @click.stop
              />
              <span class="text-yellow-400 text-xs">📁</span>
              <span class="text-yellow-300/80 text-xs font-mono">{{ group.folder || '(root)' }}/</span>
              <span class="text-gray-600 text-[10px] ml-auto">{{ group.secrets.length }}</span>
            </div>
            <!-- Secrets -->
            <div
              v-for="secret in group.secrets"
              :key="`${group.folder}/${secret}`"
              class="flex items-center gap-2 pl-8 pr-3 py-1 rounded cursor-pointer hover:bg-gray-800/60 select-none"
              @click="togglePath(group.folder ? `${group.folder}/${secret}` : secret)"
            >
              <input
                type="checkbox"
                class="accent-red-500 w-3 h-3 shrink-0"
                :checked="selectedPaths.has(group.folder ? `${group.folder}/${secret}` : secret)"
                @change.stop="togglePath(group.folder ? `${group.folder}/${secret}` : secret)"
                @click.stop
              />
              <span class="text-gray-500 text-xs">🔑</span>
              <span
                class="text-xs font-mono"
                :class="selectedPaths.has(group.folder ? `${group.folder}/${secret}` : secret) ? 'text-red-300' : 'text-gray-500'"
              >{{ secret }}</span>
            </div>
          </div>
          <div v-if="allPaths.length === 0" class="text-center text-gray-600 text-xs py-4">
            {{ t('deleteConfirmModal.noSecretsInFolder') }}
          </div>
        </div>

        <p v-if="error" class="px-5 py-2 text-red-400 text-xs shrink-0">⚠ {{ error }}</p>
      </div>

      <!-- Actions -->
      <div class="flex gap-2 px-5 py-4 border-t border-gray-800 shrink-0">
        <button
          class="flex-1 py-2 text-sm bg-red-800 hover:bg-red-700 text-white rounded transition font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="deleting || (isFolder && !someSelected)"
          @click="confirm"
        >
          <template v-if="deleting">{{ t('deleteConfirmModal.deleting') }}</template>
          <template v-else-if="!isFolder">{{ t('deleteConfirmModal.deleteSecretBtn') }}</template>
          <template v-else>{{ t('deleteConfirmModal.deleteSelectedBtn', { n: selectedCount }) }}</template>
        </button>
        <button
          class="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded transition"
          :disabled="deleting"
          @click="emit('cancel')"
        >{{ t('deleteConfirmModal.cancel') }}</button>
      </div>

    </div>
  </div>
</template>

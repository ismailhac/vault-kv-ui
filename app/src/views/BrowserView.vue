<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useVaultStore } from '../stores/vault'
import SecretPanel from '../components/SecretPanel.vue'
import BulkEditModal from '../components/BulkEditModal.vue'
import FeatureFlagModal from '../components/FeatureFlagModal.vue'
import KeyRemovalModal from '../components/KeyRemovalModal.vue'
import KeyUpdateModal from '../components/KeyUpdateModal.vue'
import KeyAdjustModal from '../components/KeyAdjustModal.vue'
import KeyRenameModal from '../components/KeyRenameModal.vue'
import DownloadOverlay from '../components/DownloadOverlay.vue'
import CreateSecretModal from '../components/CreateSecretModal.vue'
import DeleteConfirmModal from '../components/DeleteConfirmModal.vue'

const vault = useVaultStore()
const showBulk = ref(false)
const showFeatureFlag = ref(false)
const showKeyRemoval = ref(false)
const showKeyUpdate = ref(false)
const showKeyAdjust = ref(false)
const showKeyRename = ref(false)
const showCreate = ref(false)
const downloadLoading = ref(false)

const pendingDelete = ref<{ path: string; isFolder: boolean } | null>(null)

function requestDelete(entry: { key: string; isFolder: boolean }) {
  const path = vault.currentPath ? `${vault.currentPath}/${entry.key.replace(/\/$/, '')}` : entry.key.replace(/\/$/, '')
  pendingDelete.value = { path, isFolder: entry.isFolder }
}

async function onDeleteConfirmed() {
  const deletedPath = pendingDelete.value?.path
  pendingDelete.value = null
  await vault.listPath(vault.currentPath)
  if (vault.selectedSecret && vault.selectedSecret.path === deletedPath) {
    vault.selectedSecret = null
  }
}

const hideEmpty = ref(false)
const emptyPaths = ref<Set<string>>(new Set())
const checkingEmpty = ref(false)
let emptyCheckSeq = 0

const filteredEntries = computed(() => {
  if (!hideEmpty.value) return vault.entries
  return vault.entries.filter(e => e.isFolder || !emptyPaths.value.has(e.key))
})

watch(() => vault.entries, async (entries) => {
  emptyPaths.value = new Set()
  hideEmpty.value = false
  const nonFolders = entries.filter(e => !e.isFolder)
  if (nonFolders.length === 0) { checkingEmpty.value = false; return }

  const seq = ++emptyCheckSeq
  checkingEmpty.value = true
  const found = new Set<string>()

  await Promise.all(nonFolders.map(async (entry) => {
    const fullPath = vault.currentPath ? `${vault.currentPath}/${entry.key}` : entry.key
    try {
      const params = new URLSearchParams({ path: fullPath, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/read?${params}`)
      if (res.ok) {
        const json = await res.json()
        if (Object.keys(json.data || {}).length === 0) found.add(entry.key)
      }
    } catch {}
  }))

  if (seq !== emptyCheckSeq) return
  emptyPaths.value = found
  checkingEmpty.value = false
  if (found.size > 0) hideEmpty.value = true
})

function toggleHideEmpty() {
  hideEmpty.value = !hideEmpty.value
}

function resetToRoot() {
  vault.currentPath = ''
  vault.pathHistory = []
  vault.selectedSecret = null
  vault.secretError = null
  vault.listPath('')
}

function onGoHomeEvent() {
  resetToRoot()
}

function openSecret(key: string) {
  const fullPath = vault.currentPath ? `${vault.currentPath}/${key}` : key
  vault.readSecret(fullPath)
}

async function downloadPath() {
  downloadLoading.value = true
  try {
    const params = new URLSearchParams({ path: vault.currentPath, mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    const json = await res.json()
    const filename = (vault.currentPath || vault.currentMount).replace(/\//g, '_') + '_dump.json'
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } finally {
    downloadLoading.value = false
  }
}

onMounted(() => {
  vault.listPath('')
  if (typeof window !== 'undefined') {
    window.addEventListener('vault-go-home', onGoHomeEvent)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('vault-go-home', onGoHomeEvent)
  }
})
</script>

<template>

  <!-- ── LANDING (not authenticated) ────────────────────────────────────────── -->
  <template v-if="!vault.isAuthenticated">
    <div class="fixed inset-0 bg-gray-950 flex flex-col items-center justify-center gap-12 text-center select-none px-4">

      <!-- Logo + name -->
      <div class="space-y-6">
        <div class="landing-logo text-green-400 font-black leading-none" style="font-size: 9rem;">⬡</div>
        <div>
          <h1 class="text-white font-bold tracking-wide" style="font-size: 2.75rem;">Vault Admin</h1>
          <p class="text-gray-500 text-sm mt-2 tracking-widest uppercase">Secret Manager · HashiCorp Vault KV v2</p>
        </div>
      </div>

      <!-- CTA button -->
      <button
        class="landing-btn group cursor-pointer inline-flex items-center gap-3 px-10 py-4 bg-green-700 hover:bg-green-600 text-white font-bold text-lg rounded-xl transition-all duration-300 hover:scale-105"
        @click="vault.showLoginModal = true"
      >
        <span>🔑</span>
        <span>{{ vault.isConfigured ? 'Se connecter' : 'Commencer la configuration' }}</span>
        <span class="group-hover:translate-x-1.5 transition-transform duration-200">→</span>
      </button>

      <!-- Dev credit -->
      <div class="text-gray-700 text-xs space-y-1 leading-relaxed">
        <div>Built with Vue 3 · Node.js · Tailwind CSS</div>
        <div>By <span class="text-gray-500 font-medium">Ismail</span> · v{{ vault.appVersion }} · MIT</div>
      </div>

    </div>
  </template>

  <!-- ── BROWSER UI (authenticated) ─────────────────────────────────────────── -->
  <template v-else>

  <div v-if="vault.tokenError && !vault.showLoginModal" class="mb-4 bg-red-950 border border-red-700 text-red-300 rounded px-4 py-3 text-sm">
    Erreur Vault : {{ vault.tokenError }}
    <button class="ml-2 underline text-red-300 hover:text-red-100" @click="vault.showLoginModal = true">Se connecter</button>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center justify-between mb-4 gap-2 flex-wrap">
    <!-- Mount + breadcrumbs + refresh -->
    <div class="flex items-center gap-2 flex-wrap">
      <select
        v-model="vault.currentMount"
        @change="resetToRoot"
        class="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1"
      >
        <option value="secret">secret</option>
        <option value="kv">kv</option>
      </select>
      <span class="text-gray-600">/</span>
      <button class="text-blue-400 hover:underline text-sm pointer" @click="resetToRoot">(root)</button>
      <template v-for="(crumb, i) in vault.breadcrumbs" :key="i">
        <span class="text-gray-600">/</span>
        <button class="text-blue-400 hover:underline text-sm pointer" @click="vault.navigateToBreadcrumb(i)">{{ crumb }}</button>
      </template>
      <!-- Refresh -->
      <button
        class="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-700 rounded pointer transition-colors"
        title="Rafraîchir"
        :disabled="vault.listLoading"
        @click="vault.listPath(vault.currentPath)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" :class="['w-4 h-4', vault.listLoading && 'animate-spin']">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
        </svg>
      </button>
    </div>

    <!-- Actions -->
    <div v-if="vault.editingEnabled" class="flex items-center gap-1.5 flex-wrap">
      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-green-800 hover:bg-green-700 text-green-100 rounded pointer transition-colors"
        @click="showCreate = true"
        title="Créer un nouveau secret"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Nouveau
      </button>

      <div class="w-px h-5 bg-gray-600 mx-0.5" />

      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded pointer transition-colors"
        @click="showFeatureFlag = true"
        title="Appliquer une feature flag à plusieurs paths"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-amber-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" />
        </svg>
        Feature Flag
      </button>

      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded pointer transition-colors"
        @click="showKeyUpdate = true"
        title="Rechercher une clé et remplacer sa valeur dans plusieurs secrets"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-blue-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
        Remplacer
      </button>

      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded pointer transition-colors"
        @click="showKeyAdjust = true"
        title="Rechercher une clé et ajuster sa valeur path par path"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-violet-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
        </svg>
        Ajuster
      </button>

      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded pointer transition-colors"
        @click="showKeyRename = true"
        title="Corriger un nom de clé erroné dans plusieurs secrets"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-teal-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6Z" />
        </svg>
        Renommer
      </button>

      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-red-900/60 text-gray-200 hover:text-red-300 rounded pointer transition-colors"
        @click="showKeyRemoval = true"
        title="Rechercher et supprimer une clé de plusieurs secrets"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-red-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
        </svg>
        Supprimer
      </button>

      <div class="w-px h-5 bg-gray-600 mx-0.5" />

      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded pointer transition-colors"
        @click="showBulk = true"
        title="Éditer plusieurs paths en JSON"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-yellow-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
        Groupée
      </button>

      <button
        class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded pointer transition-colors"
        :disabled="downloadLoading"
        @click="downloadPath"
        title="Télécharger tous les secrets du chemin courant"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5 text-green-400">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download
      </button>
    </div>
  </div>

  <!-- Read-only banner -->
  <div
    v-if="!vault.editingEnabled"
    class="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-950 border border-amber-800 rounded text-amber-300 text-xs"
  >
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 shrink-0">
      <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
    Mode lecture seule — les actions d'écriture sont désactivées par l'administrateur.
    <RouterLink to="/admin" class="ml-auto underline hover:text-amber-100">Gérer →</RouterLink>
  </div>

  <!-- Entries header: count + hide-empty toggle -->
  <div
    v-if="!vault.listLoading && !vault.listError && (vault.entries.some(e => !e.isFolder) || checkingEmpty)"
    class="flex items-center justify-between mb-2 px-1"
  >
    <span class="text-xs text-gray-600">
      {{ filteredEntries.length }}<template v-if="hideEmpty && emptyPaths.size > 0"> / {{ vault.entries.length }}</template> entrée(s)
      <span v-if="hideEmpty && emptyPaths.size > 0" class="text-gray-700"> · {{ emptyPaths.size }} vide(s) masqué(s)</span>
    </span>
    <button
      class="flex items-center gap-1 text-xs px-2 py-0.5 rounded pointer transition-colors"
      :class="hideEmpty ? 'bg-indigo-900/50 text-indigo-300 hover:bg-indigo-900' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-700'"
      :disabled="checkingEmpty"
      @click="toggleHideEmpty"
      title="Masquer les secrets sans aucune clé"
    >
      <svg v-if="checkingEmpty" class="animate-spin w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <svg v-else-if="hideEmpty" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
      {{ checkingEmpty ? 'Vérification…' : hideEmpty ? `Afficher (${emptyPaths.size} vides)` : `Masquer vides (${emptyPaths.size})` }}
    </button>
  </div>

  <!-- Entries list -->
  <div class="bg-gray-900 border border-gray-800 rounded overflow-hidden">
    <div v-if="vault.listLoading" class="px-4 py-8 text-center text-gray-500 text-sm animate-pulse">
      Chargement…
    </div>
    <div v-else-if="vault.listError" class="px-4 py-4 text-red-400 text-sm">
      Erreur : {{ vault.listError }}
    </div>
    <div v-else-if="vault.entries.length === 0 && vault.currentPath !== ''" class="px-4 py-8 text-gray-500 text-sm text-center">
      Dossier vide
    </div>
    <div v-else-if="vault.entries.length === 0" class="px-4 py-8 text-gray-500 text-sm text-center">
      Aucun secret trouvé à la racine du mount
    </div>

    <!-- Back row -->
    <div
      v-if="vault.pathHistory.length > 0"
      class="flex items-center gap-3 px-4 py-2 border-b border-gray-800 hover:bg-gray-800 cursor-pointer text-sm text-gray-400"
      @click="vault.navigateBack"
    >
      <span>←</span>
      <span>..</span>
    </div>

    <!-- Entries -->
    <div
      v-for="entry in filteredEntries"
      :key="entry.key"
      class="group flex items-center justify-between px-4 py-2 border-b border-gray-800 last:border-0 hover:bg-gray-800 cursor-pointer text-sm"
      @click="entry.isFolder ? vault.navigateTo(entry.key) : openSecret(entry.key)"
    >
      <div class="flex items-center gap-3" :class="entry.isFolder ? 'text-yellow-300' : 'text-gray-200'">
        <span>{{ entry.isFolder ? '📁' : '🔑' }}</span>
        <span>{{ entry.key }}</span>
      </div>
      <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        <button
          v-if="!entry.isFolder"
          class="text-xs text-gray-500 hover:text-gray-200 px-2 py-0.5 border border-gray-700 rounded"
          title="Ouvrir ce secret"
          @click.stop="openSecret(entry.key)"
        >⬇</button>
        <button
          v-if="vault.editingEnabled"
          class="p-1 text-gray-600 hover:text-red-400 hover:bg-red-950/50 rounded transition-colors"
          :title="entry.isFolder ? 'Supprimer ce dossier et tous ses secrets' : 'Supprimer ce secret'"
          @click.stop="requestDelete(entry)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- Secret panel -->
  <SecretPanel />

  <!-- Modals -->
  <CreateSecretModal v-if="showCreate" @close="showCreate = false" />
  <DeleteConfirmModal
    v-if="pendingDelete"
    :path="pendingDelete.path"
    :is-folder="pendingDelete.isFolder"
    @confirm="onDeleteConfirmed"
    @cancel="pendingDelete = null"
  />
  <BulkEditModal v-if="showBulk" @close="showBulk = false" />
  <FeatureFlagModal v-if="showFeatureFlag" @close="showFeatureFlag = false" />
  <KeyRemovalModal v-if="showKeyRemoval" @close="showKeyRemoval = false" />
  <KeyUpdateModal v-if="showKeyUpdate" @close="showKeyUpdate = false" />
  <KeyAdjustModal v-if="showKeyAdjust" @close="showKeyAdjust = false" />
  <KeyRenameModal v-if="showKeyRename" @close="showKeyRename = false" />

  <!-- Download overlay (blocks all interaction) -->
  <DownloadOverlay v-if="downloadLoading" />

  </template><!-- end v-else authenticated -->
</template>

<style scoped>
@keyframes logo-pulse {
  0%   { transform: scale(1)    rotate(0deg);  filter: drop-shadow(0 0 20px #22c55e70) drop-shadow(0 0 60px #22c55e30); }
  20%  { transform: scale(1.08) rotate(6deg);  filter: drop-shadow(0 0 50px #4ade80dd) drop-shadow(0 0 120px #22c55e70); }
  40%  { transform: scale(1.12) rotate(0deg);  filter: drop-shadow(0 0 70px #86efacff) drop-shadow(0 0 160px #22c55e90); }
  60%  { transform: scale(1.08) rotate(-6deg); filter: drop-shadow(0 0 50px #4ade80dd) drop-shadow(0 0 120px #22c55e70); }
  80%  { transform: scale(1.03) rotate(0deg);  filter: drop-shadow(0 0 30px #22c55e90) drop-shadow(0 0 80px #22c55e40); }
  100% { transform: scale(1)    rotate(0deg);  filter: drop-shadow(0 0 20px #22c55e70) drop-shadow(0 0 60px #22c55e30); }
}
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 25px #15803d60, 0 6px 30px #00000080; }
  50%       { box-shadow: 0 0 60px #16a34aaa, 0 0 120px #15803d50, 0 6px 40px #00000090; }
}
.landing-logo { animation: logo-pulse 3s ease-in-out infinite; }
.landing-btn  { animation: glow-pulse 2s ease-in-out infinite; }
</style>

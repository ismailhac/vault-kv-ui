<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'

const { t } = useI18n()
const props = defineProps<{ initialQuery?: string; initialScope?: string }>()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

const query = ref(props.initialQuery ?? '')
const scopePath = ref(props.initialScope ?? '')
const searchBy = ref<'path' | 'key' | 'value'>('key')
const excludeProd = ref(true)
const hasSearched = ref(false)

// Revealed values (key = `${path}::${keyName}`)
const revealedKeys = ref(new Set<string>())
function toggleReveal(path: string, key: string) {
  const id = `${path}::${key}`
  if (revealedKeys.value.has(id)) revealedKeys.value.delete(id)
  else revealedKeys.value.add(id)
  revealedKeys.value = new Set(revealedKeys.value) // trigger reactivity
}
function isRevealed(path: string, key: string) {
  return revealedKeys.value.has(`${path}::${key}`)
}

const allKeyCombos = computed(() =>
  filteredResults.value.flatMap(r => r.matchedKeys.map(k => `${r.path}::${k}`))
)
const allRevealed = computed(() =>
  allKeyCombos.value.length > 0 && allKeyCombos.value.every(id => revealedKeys.value.has(id))
)
function revealAll() {
  revealedKeys.value = new Set(allKeyCombos.value)
}
function hideAll() {
  revealedKeys.value = new Set()
}

// Search history
const HISTORY_KEY = 'vault-search-history'
const MAX_HISTORY = 8
const searchHistory = ref<string[]>(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'))
const queryFocused = ref(false)

const historyVisible = computed(() =>
  queryFocused.value && !query.value.trim() && searchHistory.value.length > 0
)

function saveToHistory(q: string) {
  const trimmed = q.trim()
  if (!trimmed) return
  const next = [trimmed, ...searchHistory.value.filter(h => h !== trimmed)].slice(0, MAX_HISTORY)
  searchHistory.value = next
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
}

function removeFromHistory(q: string) {
  searchHistory.value = searchHistory.value.filter(h => h !== q)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(searchHistory.value))
}

async function pickHistory(q: string) {
  query.value = q
  queryFocused.value = false
  await runSearch()
}

// Scope combobox
const scopeOptions = ref<string[]>([])
const scopeFocused = ref(false)

const filteredScopeOptions = computed(() => {
  const typed = scopePath.value
  // Only suggest at level 1 (no slash yet or empty)
  if (typed.includes('/')) return []
  if (!typed.trim()) return scopeOptions.value
  return scopeOptions.value.filter(o => o.toLowerCase().startsWith(typed.toLowerCase()))
})

function selectScope(opt: string) {
  scopePath.value = opt + '/'
  scopeFocused.value = false
  nextTick(() => {
    const el = document.getElementById('scope-input')
    el?.focus()
  })
}

watch(() => props.initialQuery, (val) => {
  if (val !== undefined && val !== query.value) query.value = val
})
watch(() => props.initialScope, (val) => {
  if (val !== undefined && val !== scopePath.value) scopePath.value = val
})

onMounted(async () => {
  if (props.initialQuery) query.value = props.initialQuery
  if (props.initialScope !== undefined) scopePath.value = props.initialScope
  // Fetch root-level folders for scope combobox
  try {
    const params = new URLSearchParams({ path: '', mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/list?${params}`)
    if (res.ok) {
      const json = await res.json()
      scopeOptions.value = (json.keys ?? [])
        .filter((k: string) => k.endsWith('/'))
        .map((k: string) => k.slice(0, -1))
    }
  } catch {}
  if (props.initialQuery?.trim()) runSearch()
})

const PROD_SEGMENTS = ['prod', 'production', 'prd']

function isProdPath(path: string) {
  return path.split('/').some(seg => PROD_SEGMENTS.includes(seg.toLowerCase()))
}

const filteredResults = computed(() =>
  excludeProd.value
    ? vault.searchResults.filter(r => !isProdPath(r.path))
    : vault.searchResults
)

const elapsedSeconds = computed(() => (vault.searchElapsedMs / 1000).toFixed(1))

function highlight(text: string, term: string): string {
  if (!term.trim()) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const escapedTerm = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.replace(new RegExp(escapedTerm, 'gi'), m => `<mark class="bg-amber-500/30 text-amber-200 rounded-sm">${m}</mark>`)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function runSearch() {
  if (!query.value.trim()) return
  hasSearched.value = true
  saveToHistory(query.value.trim())
  await vault.searchSecrets(query.value.trim(), searchBy.value, scopePath.value.trim() || undefined)
}

async function openSecret(path: string) {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  vault.currentPath = parent
  vault.pathHistory.push(parent)
  vault.listPath(parent)
  vault.readSecret(path)
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') runSearch()
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-start justify-center pt-16 px-4"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[75vh] flex flex-col shadow-2xl">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
        <span class="text-white font-semibold text-sm">{{ t('searchModal.title') }}</span>
        <button class="text-gray-500 hover:text-gray-300 text-lg leading-none" @click="emit('close')">✕</button>
      </div>

      <!-- Search controls -->
      <div class="px-5 py-3 border-b border-gray-700 shrink-0 space-y-2">
        <!-- Query + search button -->
        <div class="flex gap-2">
          <div class="relative flex-1">
            <input
              v-model="query"
              type="text"
              :placeholder="t('searchModal.searchPlaceholder')"
              class="w-full bg-gray-950 border border-gray-700 text-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-sky-600 placeholder-gray-600"
              autocomplete="off"
              @keydown="onKeydown"
              @focus="queryFocused = true"
              @blur="queryFocused = false"
              autofocus
            />
            <!-- Search history dropdown -->
            <div
              v-if="historyVisible"
              class="absolute top-full left-0 right-0 z-50 mt-0.5 bg-gray-900 border border-gray-700 rounded shadow-xl overflow-hidden"
            >
              <div
                v-for="h in searchHistory"
                :key="h"
                class="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-700 transition-colors cursor-pointer group"
                @mousedown.prevent="pickHistory(h)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3 text-gray-600 shrink-0">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <span class="flex-1 text-sm text-gray-300 font-mono truncate">{{ h }}</span>
                <button
                  class="text-gray-700 hover:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  @mousedown.stop.prevent="removeFromHistory(h)"
                >✕</button>
              </div>
            </div>
          </div>
          <button
            class="px-4 py-1.5 text-sm bg-sky-700 hover:bg-sky-600 text-white rounded transition-colors disabled:opacity-40 disabled:pointer-events-none"
            :disabled="!query.trim() || vault.searchLoading"
            @click="runSearch"
          >
            <span v-if="vault.searchLoading" class="animate-pulse">{{ t('searchModal.scanning') }}</span>
            <span v-else>{{ t('searchModal.search') }}</span>
          </button>
        </div>

        <!-- Mode + prod filter row -->
        <div class="flex items-center gap-4 text-xs text-gray-400">
          <div class="flex items-center gap-2">
            <span>{{ t('searchModal.searchBy') }}</span>
            <button
              :class="['px-2 py-0.5 rounded transition-colors', searchBy === 'path' ? 'bg-sky-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300']"
              @click="searchBy = 'path'"
            >{{ t('searchModal.byPath') }}</button>
            <button
              :class="['px-2 py-0.5 rounded transition-colors', searchBy === 'key' ? 'bg-sky-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300']"
              @click="searchBy = 'key'"
            >{{ t('searchModal.byKey') }}</button>
            <button
              :class="['px-2 py-0.5 rounded transition-colors', searchBy === 'value' ? 'bg-amber-700 text-white' : 'bg-gray-800 hover:bg-gray-700 text-gray-300']"
              @click="searchBy = 'value'"
            >{{ t('searchModal.byValue') }}</button>
          </div>
          <label class="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" v-model="excludeProd" class="accent-sky-500" />
            {{ t('searchModal.excludeProd') }}
          </label>
        </div>

        <!-- Scope combobox -->
        <div class="flex items-center gap-2 text-xs">
          <span class="text-gray-500 shrink-0">{{ t('searchModal.scopeLabel') }}</span>
          <div class="relative flex-1">
            <input
              id="scope-input"
              v-model="scopePath"
              type="text"
              :placeholder="t('searchModal.scopePlaceholder')"
              class="w-full bg-gray-950 border border-gray-700 text-gray-400 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-700 placeholder-gray-700 font-mono"
              autocomplete="off"
              @focus="scopeFocused = true"
              @blur="scopeFocused = false"
              @keydown.enter.prevent="runSearch"
            />
            <!-- Level-1 dropdown -->
            <div
              v-if="scopeFocused && filteredScopeOptions.length > 0"
              class="absolute top-full left-0 right-0 z-50 mt-0.5 bg-gray-900 border border-gray-700 rounded shadow-xl max-h-40 overflow-y-auto"
            >
              <button
                v-for="opt in filteredScopeOptions"
                :key="opt"
                class="w-full text-left px-3 py-1.5 text-xs font-mono text-gray-300 hover:bg-gray-700 transition-colors"
                @mousedown.prevent="selectScope(opt)"
              >{{ opt }}/</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Results -->
      <div class="overflow-y-auto flex-1 px-5 py-3">

        <!-- Loading -->
        <div v-if="vault.searchLoading" class="text-gray-500 text-sm text-center py-10 animate-pulse">
          {{ t('searchModal.scanning') }}
        </div>

        <!-- Error -->
        <div v-else-if="vault.searchError" class="text-red-400 text-sm py-4">
          {{ vault.searchError }}
        </div>

        <!-- No results yet (before first search) -->
        <div v-else-if="!hasSearched" class="text-gray-600 text-xs text-center py-10">
          {{ t('searchModal.enterSearch') }}
        </div>

        <!-- Empty after prod filter -->
        <div v-else-if="filteredResults.length === 0" class="text-gray-500 text-sm text-center py-6">
          {{ t('searchModal.noResults') }}
          <span v-if="excludeProd && vault.searchResults.length > 0" class="block text-xs text-gray-600 mt-1">
            ({{ t('searchModal.hiddenByProd', { n: vault.searchResults.length - filteredResults.length }) }})
          </span>
        </div>

        <!-- Results with show/hide all -->
        <template v-else>
          <!-- Show / hide all toggle -->
          <div v-if="allKeyCombos.length > 0" class="flex justify-end mb-2">
            <button
              class="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              @click="allRevealed ? hideAll() : revealAll()"
            >
              <!-- Eye open -->
              <svg v-if="!allRevealed" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.573-3.007-9.964-7.178Z" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              <!-- Eye slash -->
              <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
              {{ allRevealed ? t('searchModal.hideAll') : t('searchModal.showAll') }}
            </button>
          </div>

        <!-- Results list -->
        <div class="space-y-1">
          <div
            v-for="result in filteredResults"
            :key="result.path"
            class="flex flex-col gap-1 px-3 py-2 bg-gray-800 border border-transparent hover:border-sky-800 rounded transition-colors"
          >
            <!-- Path row — click to navigate -->
            <div class="flex items-center gap-2 cursor-pointer" @click="openSecret(result.path)">
              <span class="text-green-400 text-sm font-mono truncate" v-html="highlight(result.path, query)" />
              <span
                v-if="result.matchedIn === 'value'"
                class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 font-medium"
              >{{ t('searchModal.matchedInValue') }}</span>
            </div>
            <!-- Matched keys with masked values -->
            <div
              v-for="key in result.matchedKeys"
              :key="key"
              class="flex items-center gap-2 text-xs pl-1"
            >
              <span class="text-gray-400 font-mono" v-html="highlight(key, query)" />
              <span class="text-gray-600">·</span>
              <span v-if="isRevealed(result.path, key)" class="font-mono text-gray-400 break-all max-h-20 overflow-y-auto block" v-html="highlight(result.matchedValues?.[key] ?? '—', query)" />
              <span v-else class="font-mono text-gray-500">••••••••</span>
              <button
                class="shrink-0 text-gray-600 hover:text-gray-300 transition-colors"
                :title="isRevealed(result.path, key) ? t('searchModal.hideValue') : t('searchModal.showValue')"
                @click.stop="toggleReveal(result.path, key)"
              >
                <!-- Eye open -->
                <svg v-if="isRevealed(result.path, key)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.573-3.007-9.964-7.178Z" />
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
                <!-- Eye slash -->
                <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              </button>
            </div>
          </div>
        </div>
        </template>

      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-5 py-2.5 border-t border-gray-700 shrink-0 text-xs text-gray-600">
        <span v-if="hasSearched && !vault.searchLoading">
          {{ t('searchModal.resultCount', { n: filteredResults.length }) }}
          <span v-if="excludeProd && vault.searchResults.length !== filteredResults.length">
            {{ t('searchModal.hiddenProd', { n: vault.searchResults.length - filteredResults.length }) }}
          </span>
          <span v-if="vault.searchScannedCount > 0" class="ml-2 text-gray-700">
            · {{ t('searchModal.scannedInfo', { n: vault.searchScannedCount, s: elapsedSeconds }) }}
          </span>
        </span>
        <span v-else />
        <button class="text-gray-500 hover:text-gray-300 transition-colors" @click="emit('close')">{{ t('searchModal.close') }}</button>
      </div>

    </div>
  </div>
</template>

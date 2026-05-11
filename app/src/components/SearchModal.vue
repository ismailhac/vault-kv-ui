<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'

const { t } = useI18n()
const props = defineProps<{ initialQuery?: string }>()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

const query = ref(props.initialQuery ?? '')

watch(() => props.initialQuery, (val) => {
  if (val !== undefined && val !== query.value) {
    query.value = val
  }
})
const searchBy = ref<'path' | 'key'>('path')
const excludeProd = ref(true)

const PROD_SEGMENTS = ['prod', 'production', 'prd']

function isProdPath(path: string) {
  return path.split('/').some(seg => PROD_SEGMENTS.includes(seg.toLowerCase()))
}

const filteredResults = computed(() =>
  excludeProd.value
    ? vault.searchResults.filter(r => !isProdPath(r.path))
    : vault.searchResults
)

async function runSearch() {
  if (!query.value.trim()) return
  await vault.searchSecrets(query.value.trim(), searchBy.value)
}

function openSecret(path: string) {
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
        <div class="flex gap-2">
          <input
            v-model="query"
            type="text"
            :placeholder="t('searchModal.searchPlaceholder')"
            class="flex-1 bg-gray-950 border border-gray-700 text-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-sky-600 placeholder-gray-600"
            @keydown="onKeydown"
            autofocus
          />
          <button
            class="px-4 py-1.5 text-sm bg-sky-700 hover:bg-sky-600 text-white rounded transition-colors disabled:opacity-40 disabled:pointer-events-none"
            :disabled="!query.trim() || vault.searchLoading"
            @click="runSearch"
          >
            <span v-if="vault.searchLoading" class="animate-pulse">{{ t('searchModal.scanning') }}</span>
            <span v-else>{{ t('searchModal.search') }}</span>
          </button>
        </div>

        <div class="flex items-center gap-4 text-xs text-gray-400">
          <!-- Search mode toggle -->
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
          </div>
          <!-- Prod toggle -->
          <label class="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" v-model="excludeProd" class="accent-sky-500" />
            {{ t('searchModal.excludeProd') }}
          </label>
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
        <div v-else-if="vault.searchResults.length === 0 && !vault.searchError" class="text-gray-600 text-xs text-center py-10">
          {{ t('searchModal.enterSearch') }}
        </div>

        <!-- Empty after prod filter -->
        <div v-else-if="filteredResults.length === 0" class="text-gray-500 text-sm text-center py-6">
          {{ t('searchModal.noResults') }}
          <span v-if="excludeProd && vault.searchResults.length > 0" class="block text-xs text-gray-600 mt-1">
            ({{ vault.searchResults.length - filteredResults.length }} {{ t('searchModal.hiddenByProd', { n: vault.searchResults.length - filteredResults.length }) }})
          </span>
        </div>

        <!-- Results list -->
        <div v-else class="space-y-1">
          <div
            v-for="result in filteredResults"
            :key="result.path"
            class="flex flex-col gap-0.5 px-3 py-2 bg-gray-800 hover:bg-gray-750 border border-transparent hover:border-sky-800 rounded cursor-pointer transition-colors"
            @click="openSecret(result.path)"
          >
            <span class="text-green-400 text-sm font-mono truncate">{{ result.path }}</span>
            <span v-if="result.matchedKeys.length > 0" class="text-gray-500 text-xs">
              {{ t('searchModal.matchedKeys') }} {{ result.matchedKeys.join(', ') }}
            </span>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-5 py-2.5 border-t border-gray-700 shrink-0 text-xs text-gray-600">
        <span v-if="filteredResults.length > 0">
          {{ t('searchModal.resultCount', { n: filteredResults.length }) }}
          <span v-if="excludeProd && vault.searchResults.length !== filteredResults.length">
            {{ t('searchModal.hiddenProd', { n: vault.searchResults.length - filteredResults.length }) }}
          </span>
        </span>
        <span v-else />
        <button class="text-gray-500 hover:text-gray-300 transition-colors" @click="emit('close')">{{ t('searchModal.close') }}</button>
      </div>

    </div>
  </div>
</template>

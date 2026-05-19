<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'

const { t } = useI18n()
const vault = useVaultStore()

const tokenValid   = computed(() => !!vault.tokenStatus && vault.tokenStatus.ttl > 0)
const tokenExpired = computed(() => !!vault.tokenStatus && vault.tokenStatus.ttl <= 0)

const ttlDisplay = computed(() => {
  const label = vault.ttlLabel
  if (label === '__expired__') return t('tokenStatusBar.ttlExpired')
  return label
})

function onNamespaceChange(e: Event) {
  vault.switchNamespace((e.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="flex items-center gap-2 min-w-0 overflow-hidden text-sm">

    <!-- Namespace selector or label -->
    <template v-if="vault.namespaces.length > 1">
      <select
        :value="vault.currentNamespace"
        :disabled="vault.tokenLoading"
        class="bg-gray-800 border border-gray-700 text-purple-300 text-xs rounded px-2 py-0.5 cursor-pointer disabled:opacity-50 shrink-0 max-w-[120px] light:bg-gray-100 light:border-gray-300 light:text-purple-700"
        :title="t('tokenStatusBar.changeNamespace')"
        @change="onNamespaceChange"
      >
        <option v-for="ns in vault.namespaces" :key="ns.id" :value="ns.namespace">
          {{ ns.label }}
        </option>
      </select>
      <span class="text-gray-700 shrink-0 light:text-gray-400">·</span>
    </template>
    <template v-else-if="vault.namespaces.length === 1">
      <span class="text-purple-300 font-mono text-xs shrink-0 max-w-[120px] truncate light:text-purple-700" :title="vault.namespaces[0].label">
        {{ vault.namespaces[0].label }}
      </span>
      <span class="text-gray-700 shrink-0 light:text-gray-400">·</span>
    </template>

    <!-- Checking -->
    <span v-if="vault.tokenLoading" class="text-gray-500 animate-pulse text-xs shrink-0">
      {{ t('tokenStatusBar.checkingToken') }}
    </span>

    <!-- Valid token -->
    <template v-else-if="tokenValid">
      <span
        class="inline-flex items-center gap-1.5 text-green-400 text-xs min-w-0 light:text-green-700"
        :title="vault.tokenStatus!.display_name"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"></span>
        <span class="truncate">{{ vault.tokenStatus!.display_name }}</span>
      </span>
      <span class="shrink-0 font-mono text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded leading-none light:bg-gray-100 light:text-gray-600">
        {{ ttlDisplay }}
      </span>
    </template>

    <!-- Expired token -->
    <template v-else-if="tokenExpired">
      <span class="text-amber-400 text-xs font-semibold shrink-0 light:text-amber-700">{{ t('tokenStatusBar.tokenExpired') }}</span>
      <button
        class="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white rounded font-bold border border-red-400 animate-pulse transition shrink-0"
        @click="vault.showLoginModal = true"
      >
        {{ t('tokenStatusBar.reconnect') }}
      </button>
    </template>

    <!-- No token -->
    <template v-else>
      <span class="text-red-400 text-xs shrink-0">{{ t('tokenStatusBar.notAuthenticated') }}</span>
      <button
        class="text-xs px-2.5 py-1 bg-green-700 hover:bg-green-600 text-white rounded font-semibold transition shrink-0"
        @click="vault.showLoginModal = true"
      >
        {{ t('tokenStatusBar.connect') }}
      </button>
    </template>

  </div>
</template>

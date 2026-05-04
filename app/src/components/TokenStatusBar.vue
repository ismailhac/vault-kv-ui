<script setup lang="ts">
import { computed } from 'vue'
import { useVaultStore } from '../stores/vault'

const vault = useVaultStore()

const tokenValid   = computed(() => !!vault.tokenStatus && vault.tokenStatus.ttl > 0)
const tokenExpired = computed(() => !!vault.tokenStatus && vault.tokenStatus.ttl <= 0)

function onNamespaceChange(e: Event) {
  vault.switchNamespace((e.target as HTMLSelectElement).value)
}

function openSetup() {
  vault.showSetupStep = true
  vault.showLoginModal = true
}
</script>

<template>
  <div class="flex items-center gap-3 text-sm flex-wrap">
    <!-- Namespace selector (only if multiple namespaces configured) -->
    <template v-if="vault.namespaces.length > 1">
      <select
        :value="vault.currentNamespace"
        :disabled="vault.tokenLoading"
        class="bg-gray-800 border border-gray-700 text-purple-300 text-xs rounded px-2 py-1 cursor-pointer disabled:opacity-50"
        title="Changer de namespace Vault"
        @change="onNamespaceChange"
      >
        <option v-for="ns in vault.namespaces" :key="ns.id" :value="ns.namespace">
          {{ ns.label }}
        </option>
      </select>
      <span class="text-gray-700">·</span>
    </template>
    <template v-else-if="vault.namespaces.length === 1">
      <span class="text-purple-300 font-mono text-xs">{{ vault.namespaces[0].label }}</span>
      <span class="text-gray-700">·</span>
    </template>

    <!-- Checking -->
    <span v-if="vault.tokenLoading" class="text-gray-500 animate-pulse text-xs">Vérification…</span>

    <!-- Valid token — no reconnect button, just status -->
    <template v-else-if="tokenValid">
      <span class="inline-flex items-center gap-1.5 text-green-400 text-xs">
        <span class="w-2 h-2 rounded-full bg-green-400 inline-block shrink-0"></span>
        {{ vault.tokenStatus!.display_name }}
      </span>
      <span class="text-gray-700">·</span>
      <span class="text-gray-400 text-xs">TTL {{ vault.ttlLabel }}</span>
    </template>

    <!-- Expired token — very prominent reconnect -->
    <template v-else-if="tokenExpired">
      <span class="text-amber-400 text-xs font-semibold">⏰ Token expiré</span>
      <button
        class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold border border-red-400 animate-pulse transition"
        @click="vault.showLoginModal = true"
      >
        🔑 Reconnecter
      </button>
    </template>

    <!-- No token at all -->
    <template v-else>
      <span class="text-red-400 text-xs">⚠ Non authentifié</span>
      <button
        class="text-xs px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded font-semibold transition"
        @click="vault.showLoginModal = true"
      >
        🔑 Se connecter
      </button>
    </template>

    <!-- Config shortcut -->
    <button
      class="text-gray-600 hover:text-gray-400 transition text-xs"
      title="Configuration Vault"
      @click="openSetup"
    >⚙</button>
  </div>
</template>

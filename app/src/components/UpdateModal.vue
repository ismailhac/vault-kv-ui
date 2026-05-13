<script setup lang="ts">
import { ref } from 'vue'
import { useVaultStore } from '../stores/vault'

const vault = useVaultStore()
const emit = defineEmits<{ close: [] }>()

const CMD = 'npm install -g vault-admin@latest'
const copied = ref(false)

async function copy() {
  await navigator.clipboard.writeText(CMD)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center px-4" @click.self="emit('close')">
    <div class="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl w-full max-w-sm">

      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span class="text-green-400 text-sm font-semibold">
          ↑ v{{ vault.latestVersion }} available
        </span>
        <button class="text-gray-600 hover:text-gray-300 text-base leading-none cursor-pointer transition-colors" @click="emit('close')">✕</button>
      </div>

      <!-- Command -->
      <div class="flex items-center gap-2 px-4 py-3 bg-gray-950 rounded-b-lg">
        <span class="text-gray-600 select-none text-sm font-mono">$</span>
        <span class="flex-1 font-mono text-sm text-green-300 select-all">{{ CMD }}</span>
        <button
          class="shrink-0 text-gray-500 hover:text-gray-200 transition-colors cursor-pointer"
          title="Copy"
          @click="copy"
        >
          <span v-if="copied" class="text-green-400 text-xs font-mono">✓</span>
          <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
          </svg>
        </button>
      </div>

    </div>
  </div>
</template>

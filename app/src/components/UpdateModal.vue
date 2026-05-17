<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'

const { t } = useI18n()
const vault = useVaultStore()
const emit = defineEmits<{ close: [] }>()

type Tab = 'unix' | 'windows'
const activeTab = ref<Tab>('unix')
const copied = ref(false)

const NPM_URL = 'https://www.npmjs.com/package/vault-admin'

const command = computed(() =>
  activeTab.value === 'unix'
    ? 'npm install -g vault-admin@latest'
    : 'npm install -g vault-admin@latest'
)

async function copy() {
  await navigator.clipboard.writeText(command.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <div class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4" @click.self="emit('close')">
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-md shadow-2xl flex flex-col light:bg-gray-50 light:border-gray-300">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-700 light:border-gray-300">
        <div class="flex items-center gap-2">
          <span class="text-green-400 text-base">↑</span>
          <span class="text-white font-semibold text-sm light:text-gray-900">{{ t('updateModal.title') }}</span>
        </div>
        <button class="text-gray-500 hover:text-gray-300 text-lg leading-none cursor-pointer" @click="emit('close')">✕</button>
      </div>

      <!-- Version info -->
      <div class="px-5 py-4 flex items-center gap-6 text-sm border-b border-gray-800 light:border-gray-200">
        <div class="flex flex-col gap-0.5">
          <span class="text-gray-600 text-xs">{{ t('updateModal.current') }}</span>
          <span class="text-gray-400 font-mono">v{{ vault.appVersion }}</span>
        </div>
        <span class="text-gray-700 text-lg">→</span>
        <div class="flex flex-col gap-0.5">
          <span class="text-gray-600 text-xs">{{ t('updateModal.latest') }}</span>
          <span class="text-green-400 font-mono font-semibold">v{{ vault.latestVersion }}</span>
        </div>
      </div>

      <!-- OS tabs -->
      <div class="px-5 pt-4 pb-2">
        <div class="flex gap-1 mb-3">
          <button
            :class="['px-3 py-1.5 text-xs rounded transition-colors font-mono cursor-pointer', activeTab === 'unix' ? 'bg-gray-700 text-green-300 light:bg-gray-200 light:text-green-800' : 'text-gray-500 hover:text-gray-300 light:hover:text-gray-700']"
            @click="activeTab = 'unix'"
          ><span class="text-gray-500 mr-1">$</span> macOS / Linux</button>
          <button
            :class="['px-3 py-1.5 text-xs rounded transition-colors font-mono cursor-pointer', activeTab === 'windows' ? 'bg-gray-700 text-blue-300 light:bg-gray-200 light:text-blue-800' : 'text-gray-500 hover:text-gray-300 light:hover:text-gray-700']"
            @click="activeTab = 'windows'"
          ><span class="text-gray-500 mr-1">PS&gt;</span> Windows</button>
        </div>

        <!-- Command block -->
        <div class="relative bg-gray-950 border border-gray-700 rounded px-4 py-3 flex items-center gap-3 light:bg-gray-100 light:border-gray-300">
          <div class="flex-1 overflow-x-auto">
            <template v-if="activeTab === 'unix'">
              <span class="text-gray-600 select-none mr-1">$</span>
              <span class="text-green-300 font-mono text-sm light:text-gray-700">{{ command }}</span>
            </template>
            <template v-else>
              <span class="text-blue-400 select-none mr-1">PS&gt;</span>
              <span class="text-green-300 font-mono text-sm light:text-gray-700">{{ command }}</span>
            </template>
          </div>
          <button
            class="shrink-0 text-gray-500 hover:text-gray-200 transition-colors cursor-pointer"
            :title="t('updateModal.copy')"
            @click="copy"
          >
            <span v-if="copied" class="text-green-400 text-xs">✓</span>
            <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
            </svg>
          </button>
        </div>

        <!-- Windows-specific steps -->
        <template v-if="activeTab === 'windows'">
          <ol class="mt-3 space-y-1 text-xs text-gray-500 list-none">
            <li><span class="text-gray-700 mr-1">1.</span> {{ t('updateModal.windowsStep1') }}</li>
            <li><span class="text-gray-700 mr-1">2.</span> {{ t('updateModal.windowsStep2') }}</li>
            <li><span class="text-gray-700 mr-1">3.</span> {{ t('updateModal.windowsStep3') }} <span class="font-mono text-gray-400">vault-admin</span></li>
          </ol>
        </template>
        <template v-else>
          <p class="text-gray-700 text-xs mt-3">
            {{ t('updateModal.restartHint') }}
            <span class="font-mono text-gray-500">vault-admin</span>
          </p>
        </template>
      </div>

      <!-- Footer -->
      <div class="flex items-center justify-between px-5 py-3 border-t border-gray-800 mt-2 light:border-gray-200">
        <a
          :href="NPM_URL"
          target="_blank"
          rel="noopener"
          class="text-xs text-sky-600 hover:text-sky-400 transition-colors cursor-pointer"
        >{{ t('updateModal.npmPage') }} ↗</a>
        <button
          class="text-xs text-gray-500 hover:text-gray-300 transition-colors cursor-pointer"
          @click="emit('close')"
        >{{ t('updateModal.close') }}</button>
      </div>

    </div>
  </div>
</template>

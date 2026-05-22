<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'

const props = defineProps<{ anchor: HTMLElement | null }>()
const { t } = useI18n()
const vault = useVaultStore()
const emit = defineEmits<{ close: [] }>()

const renewing = ref(false)
const renewedOk = ref(false)
const renewError = ref<string | null>(null)

const status = computed(() => vault.tokenStatus)

// Fixed position anchored below the button
const panelStyle = computed(() => {
  if (!props.anchor) return {}
  const rect = props.anchor.getBoundingClientRect()
  return {
    position: 'fixed' as const,
    top: `${rect.bottom + 6}px`,
    right: `${window.innerWidth - rect.right}px`,
  }
})

function formatDate(val: string | number | null): string {
  if (!val) return '—'
  // Vault returns creation_time as a Unix timestamp (seconds), not ISO
  const ms = typeof val === 'number' ? val * 1000 : Date.parse(val)
  if (isNaN(ms)) return String(val)
  return new Date(ms).toLocaleString()
}

function formatTtl(seconds: number): string {
  if (seconds <= 0) return t('tokenStatusBar.ttlExpired')
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

async function renew() {
  renewing.value = true
  renewError.value = null
  renewedOk.value = false
  try {
    await vault.renewToken()
    renewedOk.value = true
    setTimeout(() => { renewedOk.value = false }, 3000)
  } catch (e: unknown) {
    renewError.value = e instanceof Error ? e.message : t('tokenInspector.renewError')
  } finally {
    renewing.value = false
  }
}

// Click-outside to close
function onMousedown(e: MouseEvent) {
  const panel = document.getElementById('token-inspector-panel')
  if (panel && !panel.contains(e.target as Node) && !props.anchor?.contains(e.target as Node)) {
    emit('close')
  }
}
onMounted(() => document.addEventListener('mousedown', onMousedown))
onUnmounted(() => document.removeEventListener('mousedown', onMousedown))
</script>

<template>
  <Teleport to="body">
    <div
      id="token-inspector-panel"
      :style="panelStyle"
      class="z-[9999] w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl text-xs light:bg-white light:border-gray-200"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-700 light:border-gray-200">
        <span class="text-gray-100 font-semibold text-sm light:text-gray-900">🔑 {{ t('tokenInspector.title') }}</span>
        <button
          class="text-gray-500 hover:text-gray-300 text-base leading-none light:hover:text-gray-700"
          :title="t('tokenInspector.close')"
          @click="emit('close')"
        >✕</button>
      </div>

      <div v-if="status" class="px-4 py-3 space-y-3">

        <!-- Display name -->
        <div class="flex justify-between gap-2">
          <span class="text-gray-500 shrink-0 light:text-gray-500">{{ t('tokenInspector.displayName') }}</span>
          <span class="text-gray-100 font-mono truncate text-right light:text-gray-900">{{ status.display_name || '—' }}</span>
        </div>

        <!-- Accessor -->
        <div class="flex justify-between gap-2">
          <span class="text-gray-500 shrink-0 light:text-gray-500">{{ t('tokenInspector.accessor') }}</span>
          <span class="text-gray-400 font-mono truncate text-right light:text-gray-600" :title="status.accessor">{{ status.accessor || '—' }}</span>
        </div>

        <!-- TTL -->
        <div class="flex justify-between gap-2">
          <span class="text-gray-500 shrink-0 light:text-gray-500">{{ t('tokenInspector.ttl') }}</span>
          <span
            class="font-mono font-semibold"
            :class="status.ttl > 0 && status.ttl < 600 ? 'text-red-400 light:text-red-600' : 'text-green-400 light:text-green-700'"
          >{{ formatTtl(status.ttl) }}</span>
        </div>

        <!-- Creation time -->
        <div class="flex justify-between gap-2">
          <span class="text-gray-500 shrink-0 light:text-gray-500">{{ t('tokenInspector.creationTime') }}</span>
          <span class="text-gray-400 text-right light:text-gray-600">{{ formatDate(status.creation_time) }}</span>
        </div>

        <!-- Renewable -->
        <div class="flex justify-between gap-2">
          <span class="text-gray-500 shrink-0 light:text-gray-500">{{ t('tokenInspector.renewable') }}</span>
          <span :class="status.renewable ? 'text-green-400 light:text-green-700' : 'text-gray-500 light:text-gray-400'">
            {{ status.renewable ? t('tokenInspector.yes') : t('tokenInspector.no') }}
          </span>
        </div>

        <!-- Issue TTL -->
        <div v-if="status.creation_ttl" class="flex justify-between gap-2">
          <span class="text-gray-500 shrink-0 light:text-gray-500">{{ t('tokenInspector.creationTtl') }}</span>
          <span class="text-gray-400 font-mono light:text-gray-600">{{ formatTtl(status.creation_ttl) }}</span>
        </div>

        <!-- Entity ID -->
        <div v-if="status.entity_id" class="flex justify-between gap-2">
          <span class="text-gray-500 shrink-0 light:text-gray-500">{{ t('tokenInspector.entityId') }}</span>
          <span class="text-gray-400 font-mono truncate text-right light:text-gray-600" :title="status.entity_id">{{ status.entity_id }}</span>
        </div>

        <!-- Policies -->
        <div v-if="status.policies?.length">
          <span class="text-gray-500 block mb-1.5 light:text-gray-500">{{ t('tokenInspector.policies') }}</span>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="policy in status.policies"
              :key="policy"
              class="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-mono light:bg-gray-100 light:text-gray-700"
            >{{ policy }}</span>
          </div>
        </div>

      </div>

      <!-- Footer — renew -->
      <div class="px-4 py-3 border-t border-gray-700 space-y-2 light:border-gray-200">
        <p v-if="!status?.renewable" class="text-gray-600 italic light:text-gray-400">{{ t('tokenInspector.notRenewable') }}</p>
        <p v-if="renewError" class="text-red-400 light:text-red-600">⚠ {{ renewError }}</p>
        <button
          v-if="status?.renewable"
          class="w-full px-3 py-1.5 rounded text-xs font-semibold transition"
          :class="renewedOk
            ? 'bg-green-800 text-green-200 light:bg-green-100 light:text-green-800'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-200 light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700'"
          :disabled="renewing"
          @click="renew"
        >
          <span v-if="renewing" class="inline-flex items-center gap-1.5">
            <span class="w-3 h-3 border border-gray-400 border-t-white rounded-full animate-spin"></span>
            {{ t('tokenInspector.renewing') }}
          </span>
          <span v-else-if="renewedOk">{{ t('tokenInspector.renewed') }}</span>
          <span v-else>{{ t('tokenInspector.renew') }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

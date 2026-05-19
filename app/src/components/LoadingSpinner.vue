<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

interface Props {
  status: 'loading' | 'success' | 'error'
  message?: string
  error?: string
  onRetry?: () => void
  onManualLogin?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  message: '',
  error: '',
})

const showRetryBtn = computed(() => props.status === 'error' && props.onRetry)
const showManualBtn = computed(() => props.status === 'error' && props.onManualLogin)
</script>

<template>
  <div class="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-8 max-w-md w-full text-center space-y-6 light:bg-white light:border-gray-200">
      <!-- Loading state -->
      <div v-if="status === 'loading'" class="space-y-4">
        <div class="flex justify-center">
          <div class="relative w-16 h-16">
            <!-- Spinner animation -->
            <div class="absolute inset-0 border-4 border-gray-700 rounded-full"></div>
            <div
              class="absolute inset-0 border-4 border-transparent border-t-green-500 rounded-full animate-spin"
            ></div>
          </div>
        </div>
        <h2 class="text-white font-semibold text-lg light:text-gray-900">{{ message || t('loadingSpinner.verifyingToken') }}</h2>
        <p class="text-gray-400 text-sm light:text-gray-600">{{ t('loadingSpinner.pleaseWait') }}</p>
      </div>

      <!-- Success state -->
      <div v-else-if="status === 'success'" class="space-y-4">
        <div class="flex justify-center">
          <div
            class="w-16 h-16 bg-green-900 rounded-full flex items-center justify-center border-2 border-green-500 animate-pulse"
          >
            <span class="text-green-400 text-3xl">✓</span>
          </div>
        </div>
        <h2 class="text-white font-semibold text-lg light:text-gray-900">{{ t('loadingSpinner.authSuccess') }}</h2>
        <p class="text-green-400 text-sm">{{ t('loadingSpinner.connectionEstablished') }}</p>
        <p class="text-gray-500 text-xs">{{ t('loadingSpinner.redirecting') }}</p>
      </div>

      <!-- Error state -->
      <div v-else-if="status === 'error'" class="space-y-4">
        <div class="flex justify-center">
          <div class="w-16 h-16 bg-red-900 rounded-full flex items-center justify-center border-2 border-red-500">
            <span class="text-red-400 text-3xl">⚠</span>
          </div>
        </div>
        <h2 class="text-white font-semibold text-lg light:text-gray-900">{{ t('loadingSpinner.authError') }}</h2>
        <div class="bg-red-950 border border-red-800 rounded p-3 text-left">
          <p class="text-red-300 text-xs font-mono">{{ error || t('loadingSpinner.unknownError') }}</p>
        </div>
        <p class="text-gray-400 text-sm light:text-gray-600">
          {{ t('loadingSpinner.tokenExpiredOrInvalid') }}
        </p>
        <div class="flex gap-2 pt-2">
          <button
            v-if="showRetryBtn"
            class="flex-1 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold text-sm transition"
            @click="onRetry"
          >
            {{ t('loadingSpinner.retry') }}
          </button>
          <button
            v-if="showManualBtn"
            class="flex-1 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded font-semibold text-sm transition"
            @click="onManualLogin"
          >
            {{ t('loadingSpinner.login') }}
          </button>
        </div>
        <p class="text-gray-500 text-xs">{{ t('loadingSpinner.orRestart') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

.animate-pulse {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>

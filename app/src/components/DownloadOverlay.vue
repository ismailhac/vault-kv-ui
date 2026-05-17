<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div class="bg-gray-900 border border-gray-700 rounded-2xl p-8 flex flex-col items-center gap-5 w-80 shadow-2xl light:bg-gray-50 light:border-gray-300">
        <svg class="animate-spin w-12 h-12 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <div class="text-center">
          <p class="text-gray-100 text-sm font-semibold mb-1 light:text-gray-900">{{ t('downloadOverlay.downloading') }}</p>
          <p class="text-gray-500 text-xs">{{ t('downloadOverlay.fetchingSecrets') }}</p>
        </div>
        <div class="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden relative light:bg-gray-200">
          <div class="absolute inset-y-0 bg-blue-500 rounded-full indeterminate-bar" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

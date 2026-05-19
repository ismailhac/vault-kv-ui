<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import { siblingEnvPaths } from '../utils/envPathDetection'

const { t } = useI18n()
const props = defineProps<{ selectedData: Record<string, string> }>()
const emit = defineEmits<{ close: []; cloned: [targetPath: string] }>()
const vault = useVaultStore()

type ProgressItem = { key: string; status: 'pending' | 'ok' | 'error'; error?: string }

const targetPath = ref(vault.currentPath)
const phase = ref<'form' | 'progress' | 'done'>('form')
const progressItems = ref<ProgressItem[]>([])
const suggestions = computed(() => siblingEnvPaths(vault.currentPath))
const kvEntries = computed(() => Object.entries(props.selectedData))

const targetPathValid = computed(() =>
  targetPath.value.trim().length > 0 && targetPath.value.trim() !== vault.currentPath
)

function applySuggestion(path: string) {
  targetPath.value = path
}

const okCount = computed(() => progressItems.value.filter(i => i.status === 'ok').length)
const errCount = computed(() => progressItems.value.filter(i => i.status === 'error').length)
const allDone = computed(() => progressItems.value.length > 0 && progressItems.value.every(i => i.status !== 'pending'))

async function startClone() {
  phase.value = 'progress'
  const target = targetPath.value.trim()
  progressItems.value = [{ key: target, status: 'pending' }]
  try {
    await vault.writeSecret(target, props.selectedData)
    progressItems.value[0] = { key: target, status: 'ok' }
  } catch (e: unknown) {
    progressItems.value[0] = { key: target, status: 'error', error: e instanceof Error ? e.message : 'Error' }
  }
  phase.value = 'done'
}

function navigateToTarget() {
  const target = targetPath.value.trim()
  if (!target) return
  const segments = target.split('/').filter(Boolean)
  vault.currentPath = ''
  vault.pathHistory = []
  for (const seg of segments) {
    vault.pathHistory.push(vault.currentPath)
    vault.currentPath = vault.currentPath ? `${vault.currentPath}/${seg}` : seg
  }
  vault.listPath(vault.currentPath)
  emit('cloned', target)
  emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
    @click.self="phase === 'form' ? emit('close') : undefined"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] light:bg-white light:border-gray-200">

      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-gray-800 shrink-0 light:border-gray-200">
        <div class="w-8 h-8 rounded-full bg-blue-950 flex items-center justify-center shrink-0 light:bg-blue-100">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-blue-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-white font-semibold text-sm light:text-black">{{ t('cloneModal.title') }}</div>
          <div class="text-gray-500 text-xs mt-0.5 light:text-gray-600">{{ t('cloneModal.subtitle', { n: kvEntries.length }) }}</div>
        </div>
        <button class="text-gray-500 hover:text-gray-300 shrink-0 light:hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <!-- Body: form phase -->
      <div v-if="phase === 'form'" class="flex flex-col flex-1 overflow-y-auto px-5 py-4 gap-4">

        <!-- Source KV pairs -->
        <div>
          <div class="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-2 light:text-gray-600">{{ t('cloneModal.sourceKeys') }}</div>
          <div class="bg-gray-950 border border-gray-800 rounded px-3 py-2 space-y-1 max-h-40 overflow-y-auto light:bg-gray-50 light:border-gray-200">
            <div v-for="[k] in kvEntries" :key="k" class="flex items-center gap-2 text-xs font-mono">
              <span class="text-gray-500 shrink-0 light:text-gray-400">▸</span>
              <span class="text-gray-300 light:text-gray-700">{{ k }}</span>
              <span class="text-gray-700 ml-auto shrink-0 light:text-gray-400">••••••</span>
            </div>
          </div>
        </div>

        <!-- Target path -->
        <div>
          <label class="text-gray-400 text-xs uppercase tracking-wider font-semibold block mb-2 light:text-gray-600">{{ t('cloneModal.targetPath') }}</label>
          <input
            v-model="targetPath"
            type="text"
            class="w-full px-3 py-2 bg-gray-950 border border-gray-700 text-green-300 font-mono rounded text-sm focus:outline-none focus:border-blue-600 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-green-700 light:placeholder-gray-400"
            :placeholder="t('cloneModal.targetPlaceholder')"
            spellcheck="false"
          />
          <p v-if="targetPath.trim() === vault.currentPath && targetPath.trim().length > 0" class="text-amber-400 text-xs mt-1">
            {{ t('cloneModal.samePathWarning') }}
          </p>
        </div>

        <!-- Env suggestions -->
        <div v-if="suggestions.length > 0">
          <div class="text-gray-500 text-xs mb-2 light:text-gray-600">{{ t('cloneModal.suggestions') }}</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="s in suggestions"
              :key="s"
              class="px-2.5 py-1 rounded border text-xs font-mono transition-colors"
              :class="targetPath === s
                ? 'bg-blue-800 border-blue-600 text-blue-100'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-blue-700 hover:text-blue-300 light:bg-gray-100 light:border-gray-300 light:text-gray-700 light:hover:border-blue-400 light:hover:text-blue-700'"
              @click="applySuggestion(s)"
            >{{ s }}</button>
          </div>
        </div>

      </div>

      <!-- Body: progress/done phase -->
      <div v-else-if="phase === 'progress' || phase === 'done'" class="flex flex-col flex-1 overflow-y-auto px-5 py-4 gap-3">

        <!-- Summary when done -->
        <div v-if="phase === 'done'" class="flex flex-col items-center py-4 gap-3">
          <div class="w-12 h-12 rounded-full flex items-center justify-center text-xl border-2"
            :class="errCount === 0 ? 'border-green-500 bg-green-950 text-green-400' : 'border-amber-500 bg-amber-950 text-amber-400'">
            {{ errCount === 0 ? '✓' : '✗' }}
          </div>
          <div class="text-center">
            <div class="text-white font-semibold text-sm light:text-black">
              {{ errCount === 0 ? t('cloneModal.successTitle') : t('cloneModal.partialTitle') }}
            </div>
            <div v-if="errCount === 0" class="text-gray-400 text-xs mt-1 light:text-gray-600">
              → <span class="text-green-300 font-mono light:text-green-700">{{ targetPath.trim() }}</span>
            </div>
            <div v-else class="text-red-400 text-xs mt-1">{{ progressItems[0]?.error }}</div>
          </div>
        </div>

        <!-- Write progress item -->
        <div class="space-y-1">
          <div
            v-for="item in progressItems"
            :key="item.key"
            class="flex items-center gap-2 px-3 py-2 rounded text-xs"
            :class="item.status === 'ok' ? 'bg-green-950/40 light:bg-green-50' : item.status === 'error' ? 'bg-red-950/40 light:bg-red-50' : 'bg-gray-800/40 light:bg-gray-100'"
          >
            <svg v-if="item.status === 'pending'" class="animate-spin w-3.5 h-3.5 shrink-0 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span v-else-if="item.status === 'ok'" class="text-green-400 shrink-0">✓</span>
            <span v-else class="text-red-400 shrink-0">✗</span>
            <span class="font-mono flex-1 truncate" :class="item.status === 'ok' ? 'text-green-300 light:text-green-700' : item.status === 'error' ? 'text-red-300 light:text-red-700' : 'text-gray-400 light:text-gray-600'">{{ item.key }}</span>
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div class="flex gap-2 px-5 py-4 border-t border-gray-800 shrink-0 light:border-gray-200">
        <template v-if="phase === 'form'">
          <button
            class="flex-1 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded transition font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="!targetPathValid"
            @click="startClone"
          >{{ t('cloneModal.confirm') }}</button>
          <button
            class="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded transition light:text-gray-600 light:hover:text-gray-800 light:border-gray-300 light:hover:border-gray-400"
            @click="emit('close')"
          >{{ t('cloneModal.cancel') }}</button>
        </template>
        <template v-else>
          <button
            v-if="phase === 'done' && okCount > 0"
            class="flex-1 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded transition font-medium"
            @click="navigateToTarget"
          >{{ t('cloneModal.navigate') }}</button>
          <button
            class="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded transition light:text-gray-600 light:hover:text-gray-800 light:border-gray-300 light:hover:border-gray-400"
            :disabled="phase === 'progress' && !allDone"
            @click="emit('close')"
          >{{ t('cloneModal.close') }}</button>
        </template>
      </div>

    </div>
  </div>
</template>

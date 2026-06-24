<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  path: string
  before: Record<string, string>
  after: Record<string, string>
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

type DiffLine = {
  key: string
  before: string | undefined
  after: string | undefined
  status: 'unchanged' | 'modified' | 'added' | 'removed'
}

const showUnchanged = ref(false)

function flattenToDotPaths(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    let parsed: unknown = value
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value) } catch { /* keep as string */ }
    }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.assign(result, flattenToDotPaths(parsed as Record<string, unknown>, fullKey))
    } else {
      result[fullKey] = String(value ?? '')
    }
  }
  return result
}

const diffLines = computed<DiffLine[]>(() => {
  const flatBefore = flattenToDotPaths(props.before as Record<string, unknown>)
  const flatAfter = flattenToDotPaths(props.after as Record<string, unknown>)
  const allKeys = new Set([...Object.keys(flatBefore), ...Object.keys(flatAfter)])
  return [...allKeys].sort().map((key) => {
    const b = flatBefore[key]
    const a = flatAfter[key]
    let status: DiffLine['status'] = 'unchanged'
    if (b === undefined) status = 'added'
    else if (a === undefined) status = 'removed'
    else if (b !== a) status = 'modified'
    return { key, before: b, after: a, status }
  })
})

const hasChanges = computed(() => diffLines.value.some((l) => l.status !== 'unchanged'))

const changedCount = computed(() => diffLines.value.filter(l => l.status !== 'unchanged').length)
const unchangedCount = computed(() => diffLines.value.filter(l => l.status === 'unchanged').length)

const visibleLines = computed(() =>
  showUnchanged.value ? diffLines.value : diffLines.value.filter(l => l.status !== 'unchanged')
)

const rowClass = (status: DiffLine['status']) => ({
  'bg-green-950 text-green-300 light:bg-green-50 light:text-green-800': status === 'added',
  'bg-red-950 text-red-300 light:bg-red-50 light:text-red-800': status === 'removed',
  'bg-yellow-950 text-yellow-200 light:bg-yellow-50 light:text-yellow-800': status === 'modified',
  'text-gray-400 light:text-gray-600': status === 'unchanged',
})
</script>

<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('cancel')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl z-50 light:bg-white light:border-gray-200">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 light:border-gray-200">
        <div>
          <span class="text-white font-semibold text-sm light:text-black">{{ t('confirmDiffModal.title') }}</span>
          <span class="ml-2 text-gray-500 text-xs font-mono light:text-gray-500">{{ path }}</span>
        </div>
        <button class="text-gray-500 hover:text-gray-300 light:hover:text-gray-700" @click="emit('cancel')">✕</button>
      </div>

      <!-- Diff table -->
      <div class="overflow-auto flex-1 px-5 py-4">
        <div v-if="!hasChanges" class="text-gray-500 text-sm text-center py-8 light:text-gray-400">
          {{ t('confirmDiffModal.noChanges') }}
        </div>
        <template v-else>
          <!-- Summary + toggle -->
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs text-gray-500 light:text-gray-400">
              {{ changedCount }} {{ t('confirmDiffModal.changedRows') }}
              <span v-if="unchangedCount > 0" class="ml-1 text-gray-700">/ {{ unchangedCount }} {{ t('confirmDiffModal.unchangedRows') }}</span>
            </span>
            <button
              v-if="unchangedCount > 0"
              type="button"
              class="text-xs text-gray-600 hover:text-gray-300 underline light:text-gray-400 light:hover:text-gray-700"
              @click="showUnchanged = !showUnchanged"
            >{{ showUnchanged ? t('confirmDiffModal.hideUnchanged') : t('confirmDiffModal.showUnchanged', { n: unchangedCount }) }}</button>
          </div>
          <table class="w-full text-xs font-mono border-collapse">
            <thead>
              <tr class="text-gray-500 uppercase text-left border-b border-gray-700 light:border-gray-200 light:text-gray-400">
                <th class="pb-2 pr-4 w-1/4">{{ t('confirmDiffModal.keyHeader') }}</th>
                <th class="pb-2 pr-4 w-1/3">{{ t('confirmDiffModal.beforeHeader') }}</th>
                <th class="pb-2 w-1/3">{{ t('confirmDiffModal.afterHeader') }}</th>
                <th class="pb-2 text-right">{{ t('confirmDiffModal.statusHeader') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="line in visibleLines"
                :key="line.key"
                class="border-b border-gray-800 last:border-0 light:border-gray-200"
                :class="rowClass(line.status)"
              >
                <td class="py-1.5 pr-4 font-semibold break-all">{{ line.key }}</td>
                <td class="py-1.5 pr-4 break-all opacity-80">
                  <span v-if="line.before !== undefined">{{ line.before }}</span>
                  <span v-else class="text-gray-600 italic">—</span>
                </td>
                <td class="py-1.5 break-all">
                  <span v-if="line.after !== undefined">{{ line.after }}</span>
                  <span v-else class="text-gray-600 italic">{{ t('confirmDiffModal.deleted') }}</span>
                </td>
                <td class="py-1.5 text-right text-xs opacity-60">
                  {{ { unchanged: '=', modified: '~', added: '+', removed: '−' }[line.status] }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-700 light:border-gray-200">
        <button
          class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded light:text-gray-600 light:hover:text-gray-800 light:border-gray-300"
          @click="emit('cancel')"
        >{{ t('confirmDiffModal.cancel') }}</button>
        <button
          class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-40"
          :disabled="!hasChanges"
          @click="emit('confirm')"
        >{{ t('confirmDiffModal.apply') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  path: string
  versionNumber: number
  before: Record<string, string>
  after: Record<string, string>
  isDeleted?: boolean
  editingEnabled?: boolean
}>()

const emit = defineEmits<{
  restore: [data: Record<string, string>]
  close: []
}>()

type DiffLine = {
  key: string
  before: string | undefined
  after: string | undefined
  status: 'unchanged' | 'modified' | 'added' | 'removed'
}

const diffLines = computed<DiffLine[]>(() => {
  const allKeys = new Set([...Object.keys(props.before), ...Object.keys(props.after)])
  return [...allKeys].sort().map((key) => {
    const b = props.before[key]
    const a = props.after[key]
    let status: DiffLine['status'] = 'unchanged'
    if (b === undefined) status = 'added'
    else if (a === undefined) status = 'removed'
    else if (b !== a) status = 'modified'
    return { key, before: b, after: a, status }
  })
})

const rowClass = (status: DiffLine['status']) => ({
  'bg-green-950 text-green-300': status === 'added',
  'bg-red-950 text-red-300': status === 'removed',
  'bg-yellow-950 text-yellow-200': status === 'modified',
  'text-gray-400': status === 'unchanged',
})
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4 light:bg-black/40"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl z-50 light:bg-gray-50 light:border-gray-300">
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 light:border-gray-300">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-white font-semibold text-sm light:text-gray-900">Version {{ versionNumber }}</span>
          <span v-if="isDeleted" class="px-1.5 py-0.5 rounded text-orange-400 bg-orange-950 text-xs">(supprimé)</span>
          <span class="text-gray-500 text-xs font-mono">{{ path }}</span>
        </div>
        <button class="text-gray-500 hover:text-gray-300 light:hover:text-gray-700 ml-4 shrink-0" @click="emit('close')">✕</button>
      </div>

      <div class="overflow-auto flex-1 px-5 py-4">
        <table class="w-full text-xs font-mono border-collapse">
          <thead>
            <tr class="text-gray-500 uppercase text-left border-b border-gray-700 light:border-gray-300">
              <th class="pb-2 pr-4 w-1/4">Clé</th>
              <th class="pb-2 pr-4 w-1/3">Cette version</th>
              <th class="pb-2 w-1/3">Version actuelle</th>
              <th class="pb-2 text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="line in diffLines"
              :key="line.key"
              class="border-b border-gray-800 last:border-0 light:border-gray-200"
              :class="rowClass(line.status)"
            >
              <td class="py-1.5 pr-4 font-semibold">{{ line.key }}</td>
              <td class="py-1.5 pr-4 break-all opacity-80">
                <span v-if="line.before !== undefined">{{ line.before }}</span>
                <span v-else class="text-gray-600 italic">—</span>
              </td>
              <td class="py-1.5 break-all">
                <span v-if="line.after !== undefined">{{ line.after }}</span>
                <span v-else class="text-gray-600 italic">—</span>
              </td>
              <td class="py-1.5 text-right opacity-60">
                {{ { unchanged: '=', modified: '~', added: '+', removed: '−' }[line.status] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-700 light:border-gray-300">
        <button
          class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 light:hover:text-gray-700 border border-gray-700 light:border-gray-300 rounded"
          @click="emit('close')"
        >Annuler</button>
        <button
          v-if="editingEnabled"
          class="px-4 py-1.5 text-sm bg-blue-700 hover:bg-blue-600 text-white light:text-white rounded"
          @click="emit('restore', before)"
        >Restaurer la version {{ versionNumber }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

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

const hasChanges = computed(() => diffLines.value.some((l) => l.status !== 'unchanged'))

const rowClass = (status: DiffLine['status']) => ({
  'bg-green-950 text-green-300': status === 'added',
  'bg-red-950 text-red-300': status === 'removed',
  'bg-yellow-950 text-yellow-200': status === 'modified',
  'text-gray-400': status === 'unchanged',
})
</script>

<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('cancel')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl z-50">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700">
        <div>
          <span class="text-white font-semibold text-sm">Confirmer la mise à jour</span>
          <span class="ml-2 text-gray-500 text-xs font-mono">{{ path }}</span>
        </div>
        <button class="text-gray-500 hover:text-gray-300" @click="emit('cancel')">✕</button>
      </div>

      <!-- Diff table -->
      <div class="overflow-auto flex-1 px-5 py-4">
        <div v-if="!hasChanges" class="text-gray-500 text-sm text-center py-8">
          Aucune modification détectée.
        </div>
        <table v-else class="w-full text-xs font-mono border-collapse">
          <thead>
            <tr class="text-gray-500 uppercase text-left border-b border-gray-700">
              <th class="pb-2 pr-4 w-1/4">Clé</th>
              <th class="pb-2 pr-4 w-1/3">Avant</th>
              <th class="pb-2 w-1/3">Après</th>
              <th class="pb-2 text-right">Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="line in diffLines"
              :key="line.key"
              class="border-b border-gray-800 last:border-0"
              :class="rowClass(line.status)"
            >
              <td class="py-1.5 pr-4 font-semibold">{{ line.key }}</td>
              <td class="py-1.5 pr-4 break-all opacity-80">
                <span v-if="line.before !== undefined">{{ line.before }}</span>
                <span v-else class="text-gray-600 italic">—</span>
              </td>
              <td class="py-1.5 break-all">
                <span v-if="line.after !== undefined">{{ line.after }}</span>
                <span v-else class="text-gray-600 italic">supprimée</span>
              </td>
              <td class="py-1.5 text-right text-xs opacity-60">
                {{ { unchanged: '=', modified: '~', added: '+', removed: '−' }[line.status] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-700">
        <button
          class="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded"
          @click="emit('cancel')"
        >Annuler</button>
        <button
          class="px-4 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded disabled:opacity-40"
          :disabled="!hasChanges"
          @click="emit('confirm')"
        >Appliquer</button>
      </div>
    </div>
  </div>
</template>

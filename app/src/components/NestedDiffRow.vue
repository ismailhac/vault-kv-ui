<script setup lang="ts">
import { ref, computed } from 'vue'

defineOptions({ name: 'NestedDiffRow' })

type DiffStatus = 'unchanged' | 'modified' | 'added' | 'removed'

const props = defineProps<{
  diffKey: string
  before: string | undefined
  after: string | undefined
  status: DiffStatus
  depth: number
}>()

const expanded = ref(false)

// Parse a string value as a JSON object/array (returns undefined if not parseable)
function tryParseJson(val: string | undefined): Record<string, unknown> | unknown[] | undefined {
  if (val === undefined) return undefined
  const t = val.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      const p = JSON.parse(t)
      if (typeof p === 'object' && p !== null) return p as Record<string, unknown> | unknown[]
    } catch {}
  }
  return undefined
}

const parsedBefore = computed(() => tryParseJson(props.before))
const parsedAfter  = computed(() => tryParseJson(props.after))
const isNested = computed(() => parsedBefore.value !== undefined || parsedAfter.value !== undefined)

// Nested diff lines (recursively computed)
type NestedLine = { key: string; before: string | undefined; after: string | undefined; status: DiffStatus }

function toStr(v: unknown): string | undefined {
  if (v === undefined) return undefined
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
}

function keysOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((_, i) => String(i))
  if (typeof v === 'object' && v !== null) return Object.keys(v as object)
  return []
}

function getAt(v: unknown, key: string): unknown {
  if (Array.isArray(v)) return v[Number(key)]
  if (typeof v === 'object' && v !== null) return (v as Record<string, unknown>)[key]
  return undefined
}

const nestedLines = computed<NestedLine[]>(() => {
  if (!isNested.value) return []
  const b = parsedBefore.value
  const a = parsedAfter.value
  const allKeys = [...new Set([...keysOf(b), ...keysOf(a)])]
  // Preserve object key order (from `a` if present, else from `b`), sort arrays numerically
  const sorted = Array.isArray(a) || Array.isArray(b)
    ? allKeys.sort((x, y) => Number(x) - Number(y))
    : allKeys
  return sorted.map(key => {
    const bStr = toStr(getAt(b, key))
    const aStr = toStr(getAt(a, key))
    let status: DiffStatus = 'unchanged'
    if (bStr === undefined) status = 'added'
    else if (aStr === undefined) status = 'removed'
    else if (bStr !== aStr) status = 'modified'
    return { key, before: bStr, after: aStr, status }
  })
})

function makeBadge(v: unknown): string {
  if (Array.isArray(v)) {
    const n = v.length
    return `[${n} élément${n > 1 ? 's' : ''}]`
  }
  if (typeof v === 'object' && v !== null) {
    const n = Object.keys(v).length
    return `{${n} clé${n > 1 ? 's' : ''}}`
  }
  return ''
}

const badgeBefore = computed(() => parsedBefore.value !== undefined ? makeBadge(parsedBefore.value) : (props.before ?? ''))
const badgeAfter  = computed(() => parsedAfter.value  !== undefined ? makeBadge(parsedAfter.value)  : (props.after  ?? ''))

const pad = computed(() => `calc(12px + ${props.depth * 14}px)`)

const rowClass = computed(() => ({
  'bg-green-950 text-green-300': props.status === 'added',
  'bg-red-950 text-red-300':    props.status === 'removed',
  'bg-yellow-950 text-yellow-200': props.status === 'modified',
  'text-gray-400': props.status === 'unchanged',
}))

const diffSymbol: Record<DiffStatus, string> = { unchanged: '=', modified: '~', added: '+', removed: '−' }
</script>

<template>
  <!-- Nested JSON value: accordion header row -->
  <template v-if="isNested">
    <tr
      class="border-b border-gray-800 last:border-0 cursor-pointer select-none"
      :class="rowClass"
      @click.stop="expanded = !expanded"
    >
      <td class="py-1.5 font-semibold break-all" :style="{ paddingLeft: pad }">
        <div class="flex items-center gap-1">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
            class="w-3 h-3 shrink-0 transition-transform opacity-60"
            :class="expanded ? 'rotate-90' : ''">
            <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/>
          </svg>
          {{ diffKey }}
        </div>
      </td>
      <td class="py-1.5 pr-3 font-mono text-xs opacity-70 break-all">
        <span v-if="before !== undefined">{{ badgeBefore }}</span>
        <span v-else class="italic opacity-40">—</span>
      </td>
      <td class="py-1.5 pr-3 font-mono text-xs opacity-70 break-all">
        <span v-if="after !== undefined">{{ badgeAfter }}</span>
        <span v-else class="italic opacity-40">—</span>
      </td>
      <td class="py-1.5 pr-3 text-right opacity-50">{{ diffSymbol[status] }}</td>
    </tr>

    <!-- Recursive children -->
    <template v-if="expanded">
      <NestedDiffRow
        v-for="line in nestedLines"
        :key="line.key"
        :diff-key="line.key"
        :before="line.before"
        :after="line.after"
        :status="line.status"
        :depth="depth + 1"
      />
    </template>
  </template>

  <!-- Plain value: single row (existing behaviour) -->
  <tr v-else class="border-b border-gray-800 last:border-0" :class="rowClass">
    <td class="py-1.5 font-semibold break-all" :style="{ paddingLeft: pad }">{{ diffKey }}</td>
    <td class="py-1.5 pr-3 break-all opacity-80">
      <span v-if="before !== undefined">{{ before }}</span>
      <span v-else class="italic opacity-40">—</span>
    </td>
    <td class="py-1.5 pr-3 break-all">
      <span v-if="after !== undefined">{{ after }}</span>
      <span v-else class="italic opacity-40">—</span>
    </td>
    <td class="py-1.5 pr-3 text-right opacity-50">{{ diffSymbol[status] }}</td>
  </tr>
</template>

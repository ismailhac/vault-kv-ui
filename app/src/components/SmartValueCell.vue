<script setup lang="ts">
import { computed } from 'vue'
import cronstrue from 'cronstrue'
import 'cronstrue/locales/fr'

const props = defineProps<{ value: unknown; masked?: boolean }>()

function isCron(v: unknown): boolean {
  const parts = String(v ?? '').trim().split(/\s+/)
  if (parts.length < 5 || parts.length > 6) return false
  return parts.every(p => /^[\d*/,\-]+$/.test(p))
}

function isBoolean(v: unknown): boolean {
  return v === true || v === false || String(v) === 'true' || String(v) === 'false'
}

const boolVal = computed(() => props.value === true || String(props.value) === 'true')

const cronLabel = computed(() => {
  if (!isCron(props.value)) return ''
  try {
    return cronstrue.toString(String(props.value).trim(), { locale: 'fr', use24HourTimeFormat: true, throwExceptionOnParseError: true })
  } catch { return '' }
})
</script>

<template>
  <!-- Masked -->
  <template v-if="masked">
    <span class="text-gray-600 font-mono tracking-widest select-none light:text-gray-400">••••••••</span>
  </template>

  <!-- Boolean: non-clickable colored pill -->
  <template v-else-if="isBoolean(value)">
    <span
      class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border select-none"
      :class="boolVal ? 'bg-green-950 border-green-700 text-green-300 light:bg-green-50 light:border-green-300 light:text-green-700' : 'bg-gray-800 border-gray-700 text-gray-500 light:bg-gray-100 light:border-gray-300 light:text-gray-600'"
    >
      <span class="w-2 h-2 rounded-full shrink-0" :class="boolVal ? 'bg-green-400' : 'bg-gray-600'"></span>
      {{ boolVal ? 'true' : 'false' }}
    </span>
  </template>

  <!-- Cron: value + human-readable description -->
  <template v-else-if="!masked && isCron(value)">
    <span class="font-mono text-gray-300 break-all light:text-gray-700">{{ value }}</span>
    <span v-if="cronLabel" class="text-xs text-gray-500 italic ml-1 light:text-gray-500">— {{ cronLabel }}</span>
  </template>

  <!-- Everything else: plain text -->
  <template v-else-if="!masked">
    <span class="break-all text-gray-300 light:text-gray-700">{{ value }}</span>
  </template>
</template>

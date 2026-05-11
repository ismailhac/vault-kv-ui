<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import cronstrue from 'cronstrue'
import 'cronstrue/locales/fr'

const props = defineProps<{
  modelValue: string
  originalValue: unknown
  autofocus?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [v: string]
  'confirm': []
  'cancel': []
}>()

const { t } = useI18n()
const vFocus = { mounted: (el: HTMLElement) => { if (props.autofocus !== false) (el as HTMLInputElement).focus() } }

function isBooleanLike(v: unknown): boolean {
  return v === true || v === false || String(v) === 'true' || String(v) === 'false'
}

function isIntegerLike(v: unknown): boolean {
  const s = String(v ?? '').trim()
  if (!s) return false
  const n = Number(s)
  return !isNaN(n) && Number.isInteger(n)
}

function isCron(v: unknown): boolean {
  const parts = String(v ?? '').trim().split(/\s+/)
  if (parts.length < 5 || parts.length > 6) return false
  return parts.every(p => /^[\d*/,\-]+$/.test(p))
}

const isBoolean = computed(() => isBooleanLike(props.originalValue))
const isInteger = computed(() => !isBoolean.value && isIntegerLike(props.originalValue))

const boolVal = computed(() => props.modelValue === 'true')

function toggleBool() {
  emit('update:modelValue', boolVal.value ? 'false' : 'true')
}

function increment() {
  const n = parseInt(props.modelValue, 10)
  emit('update:modelValue', String(isNaN(n) ? 1 : n + 1))
}

function decrement() {
  const n = parseInt(props.modelValue, 10)
  emit('update:modelValue', String(isNaN(n) ? -1 : n - 1))
}

const cronLabel = computed(() => {
  if (!isCron(props.modelValue)) return ''
  try {
    return cronstrue.toString(props.modelValue.trim(), { locale: 'fr', use24HourTimeFormat: true, throwExceptionOnParseError: true })
  } catch { return '' }
})
</script>

<template>
  <!-- Boolean: clickable toggle pill + confirm/cancel -->
  <template v-if="isBoolean">
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border cursor-pointer transition-colors"
        :class="boolVal
          ? 'bg-green-800 border-green-600 text-green-200 hover:bg-green-700'
          : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'"
        @click.stop="toggleBool"
      >
        <span class="w-2 h-2 rounded-full shrink-0" :class="boolVal ? 'bg-green-400' : 'bg-gray-500'"></span>
        {{ boolVal ? 'true' : 'false' }}
      </button>
      <button type="button" class="text-green-400 hover:text-green-300 text-sm shrink-0" :title="t('smartEditValue.saveTip')" @click.stop="emit('confirm')">✓</button>
      <button type="button" class="text-gray-500 hover:text-gray-300 text-xs shrink-0" :title="t('smartEditValue.cancelTip')" @click.stop="emit('cancel')">✕</button>
    </div>
  </template>

  <!-- Integer: ±1 controls + confirm/cancel -->
  <template v-else-if="isInteger">
    <div class="flex items-center gap-1">
      <button type="button" class="px-1.5 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded shrink-0" @click.stop="decrement">−</button>
      <input
        v-focus
        :value="modelValue"
        class="w-20 text-center bg-gray-800 border border-blue-500 text-gray-100 font-mono text-xs rounded px-2 py-0.5 focus:outline-none focus:border-blue-400"
        @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keyup.enter="emit('confirm')"
        @keyup.escape="emit('cancel')"
        @click.stop
      />
      <button type="button" class="px-1.5 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded shrink-0" @click.stop="increment">+</button>
      <button type="button" class="text-green-400 hover:text-green-300 text-sm shrink-0 ml-0.5" :title="t('smartEditValue.saveTip')" @click.stop="emit('confirm')">✓</button>
      <button type="button" class="text-gray-500 hover:text-gray-300 text-xs shrink-0" :title="t('smartEditValue.cancelTip')" @click.stop="emit('cancel')">✕</button>
    </div>
  </template>

  <!-- Cron / text: standard input with optional live description -->
  <template v-else>
    <div class="flex flex-col gap-0.5 flex-1 min-w-0">
      <div class="flex items-center gap-1">
        <input
          v-focus
          :value="modelValue"
          class="flex-1 min-w-0 bg-gray-800 border border-blue-500 text-gray-100 font-mono text-xs rounded px-2 py-0.5 focus:outline-none focus:border-blue-400"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
          @keyup.enter="emit('confirm')"
          @keyup.escape="emit('cancel')"
          @click.stop
        />
        <button type="button" class="text-green-400 hover:text-green-300 text-sm shrink-0" :title="t('smartEditValue.saveTip')" @click.stop="emit('confirm')">✓</button>
        <button type="button" class="text-gray-500 hover:text-gray-300 text-xs shrink-0" :title="t('smartEditValue.cancelTip')" @click.stop="emit('cancel')">✕</button>
      </div>
      <span v-if="cronLabel" class="text-xs text-gray-500 italic">— {{ cronLabel }}</span>
    </div>
  </template>
</template>

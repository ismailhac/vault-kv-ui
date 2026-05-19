<script setup lang="ts">
import { ref, computed, inject, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SmartValueCell from './SmartValueCell.vue'
import SmartEditValue from './SmartEditValue.vue'

defineOptions({ name: 'NestedJsonField' })

const { t } = useI18n()
const vFocus = { mounted: (el: HTMLElement) => (el as HTMLInputElement).focus() }

const props = defineProps<{
  value: unknown
  keyName: string
  depth: number
  editingAllowed: boolean
}>()

const emit = defineEmits<{
  'leaf-edit': [path: string[], newValue: string]
  'key-rename': [path: string[], newKey: string]
}>()

// Unique identity for this instance — used to claim the shared edit slot
const myId = Symbol()
const activeNestedEdit = inject<Ref<symbol | null>>('activeNestedEdit', ref(null))

// When another instance claims the slot, cancel our local edits
watch(activeNestedEdit, (id) => {
  if (id !== myId) {
    editingKey.value = false
    editingLeaf.value = false
  }
})

const expanded = ref(false)
const editingLeaf = ref(false)
const editingLeafValue = ref('')
const editingKey = ref(false)
const editingKeyValue = ref('')

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

const isArray = (v: unknown): v is unknown[] => Array.isArray(v)

const isNested = computed(() => isObject(props.value) || isArray(props.value))

const childEntries = computed<[string, unknown][]>(() => {
  if (isObject(props.value)) return Object.entries(props.value)
  if (isArray(props.value)) return (props.value as unknown[]).map((v, i) => [String(i), v])
  return []
})

const badge = computed(() => {
  if (isObject(props.value)) {
    const n = Object.keys(props.value).length
    return `{${t('nestedJsonField.objectBadge', { n }, n)}}`
  }
  if (isArray(props.value)) {
    const n = (props.value as unknown[]).length
    return `[${t('nestedJsonField.arrayBadge', { n }, n)}]`
  }
  return ''
})

const indent = computed(() => `${props.depth * 16}px`)

function toggleExpand() {
  if (editingKey.value) return
  expanded.value = !expanded.value
}

// ---- Key rename ----
function startEditKey(e: Event) {
  e.stopPropagation()
  activeNestedEdit.value = myId  // cancel all other nested edits
  editingLeaf.value = false
  editingKeyValue.value = props.keyName
  editingKey.value = true
}

function cancelEditKey() {
  editingKey.value = false
}

function commitKeyEdit() {
  const newKey = editingKeyValue.value.trim()
  editingKey.value = false
  if (!newKey || newKey === props.keyName) return
  emit('key-rename', [props.keyName], newKey)
}

// ---- Leaf value edit (scalar only) ----
function startEditLeaf() {
  if (!props.editingAllowed || editingKey.value) return
  activeNestedEdit.value = myId  // cancel all other nested edits
  editingLeafValue.value = String(props.value ?? '')
  editingLeaf.value = true
}

function cancelEditLeaf() {
  editingLeaf.value = false
}

function commitLeafEdit() {
  if (!editingLeaf.value) return
  editingLeaf.value = false
  emit('leaf-edit', [props.keyName], editingLeafValue.value)
}

// Cancel edit when focus leaves the editing wrapper (click outside = cancel)
function cancelOnBlur(e: FocusEvent, cancel: () => void) {
  const rel = e.relatedTarget as HTMLElement | null
  if (rel && (e.currentTarget as HTMLElement).contains(rel)) return
  cancel()
}

// ---- Bubble up from children ----
function onChildLeafEdit(path: string[], newValue: string) {
  emit('leaf-edit', [props.keyName, ...path], newValue)
}

function onChildKeyRename(path: string[], newKey: string) {
  emit('key-rename', [props.keyName, ...path], newKey)
}
</script>

<template>
  <!-- Object / Array: accordion -->
  <template v-if="isNested">
    <tr
      class="group border-b border-gray-800 last:border-0 cursor-pointer select-none light:border-gray-200"
      :title="editingAllowed ? t('nestedJsonField.expandCollapseRename') : t('nestedJsonField.expandCollapse')"
      @click.stop="toggleExpand"
      @dblclick.stop="toggleExpand"
    >
      <!-- Key cell -->
      <td class="py-1.5 pr-4 align-middle" :style="{ paddingLeft: indent }">
        <!-- Key edit mode -->
        <div v-if="editingKey" class="flex items-center gap-1" @click.stop @dblclick.stop @focusout="(e) => cancelOnBlur(e, cancelEditKey)">
          <input
            v-focus
            v-model="editingKeyValue"
            class="flex-1 min-w-0 bg-gray-800 border border-yellow-500 text-yellow-200 font-mono text-xs rounded px-2 py-0.5 focus:outline-none focus:border-yellow-400 light:bg-white light:text-yellow-700 light:border-yellow-400"
            :placeholder="t('nestedJsonField.keyNamePlaceholder')"
            @keyup.enter="commitKeyEdit"
            @keyup.escape="cancelEditKey"
          />
          <button class="text-green-400 hover:text-green-300 text-sm shrink-0" :title="t('nestedJsonField.renameConfirmTip')" @click.stop="commitKeyEdit">✓</button>
          <button class="text-gray-500 hover:text-gray-300 text-xs shrink-0" :title="t('nestedJsonField.cancelTip')" @click.stop="cancelEditKey">✕</button>
        </div>
        <!-- Read mode -->
        <div v-else class="flex items-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="w-3 h-3 text-gray-500 shrink-0 transition-transform light:text-gray-400"
            :class="expanded ? 'rotate-90' : ''"
          >
            <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd" />
          </svg>
          <span class="font-mono text-xs text-blue-300 break-all light:text-blue-700">{{ keyName }}</span>
          <button
            v-if="editingAllowed"
            class="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-400 hover:text-yellow-300 text-xs shrink-0 ml-0.5 leading-none"
            :title="t('nestedJsonField.renameKeyTip')"
            @click.stop="startEditKey"
            @dblclick.stop
          >✏</button>
        </div>
      </td>
      <!-- Badge cell -->
      <td class="py-1.5 font-mono text-xs align-middle" colspan="2">
        <span class="text-gray-500 light:text-gray-400">{{ badge }}</span>
      </td>
    </tr>

    <!-- Children (expanded) -->
    <template v-if="expanded">
      <NestedJsonField
        v-for="([childKey, childVal]) in childEntries"
        :key="childKey"
        :value="childVal"
        :key-name="childKey"
        :depth="depth + 1"
        :editing-allowed="editingAllowed"
        @leaf-edit="onChildLeafEdit"
        @key-rename="onChildKeyRename"
      />
    </template>
  </template>

  <!-- Scalar: inline-editable row -->
  <tr
    v-else
    class="group border-b border-gray-800 last:border-0 light:border-gray-200"
    :class="editingAllowed && !editingLeaf && !editingKey ? 'cursor-pointer' : ''"
    :title="editingAllowed && !editingLeaf && !editingKey ? t('nestedJsonField.dblClickEditRename') : undefined"
    @dblclick.stop="startEditLeaf"
  >
    <!-- Key cell -->
    <td class="py-1.5 pr-4 align-middle" :style="{ paddingLeft: indent }">
      <!-- Key edit mode -->
      <div v-if="editingKey" class="flex items-center gap-1" @click.stop @dblclick.stop>
        <input
          v-focus
          v-model="editingKeyValue"
          class="w-full bg-gray-800 border border-yellow-500 text-yellow-200 font-mono text-xs rounded px-2 py-0.5 focus:outline-none focus:border-yellow-400 light:bg-white light:text-yellow-700 light:border-yellow-400"
          :placeholder="t('nestedJsonField.keyNamePlaceholder')"
          @keyup.enter="commitKeyEdit"
          @keyup.escape="cancelEditKey"
        />
        <button class="text-green-400 hover:text-green-300 text-sm shrink-0" :title="t('nestedJsonField.renameConfirmTip')" @click.stop="commitKeyEdit">✓</button>
        <button class="text-gray-500 hover:text-gray-300 text-xs shrink-0" :title="t('nestedJsonField.cancelTip')" @click.stop="cancelEditKey">✕</button>
      </div>
      <!-- Read mode -->
      <div v-else class="flex items-center gap-1">
        <span class="font-mono text-xs text-blue-300 break-all">{{ keyName }}</span>
        <button
          v-if="editingAllowed"
          class="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-gray-400 hover:text-yellow-300 text-xs shrink-0 ml-0.5 leading-none"
          :title="t('nestedJsonField.renameKeyTip')"
          @click.stop="startEditKey"
          @dblclick.stop
        >✏</button>
      </div>
    </td>

    <!-- Value cell -->
    <td class="py-1.5 font-mono text-xs align-middle">
      <div v-if="!editingLeaf" class="flex items-center gap-1.5">
        <SmartValueCell :value="value" />
      </div>
      <div v-else class="flex items-center gap-1" @click.stop @dblclick.stop @focusout="(e) => cancelOnBlur(e, cancelEditLeaf)">
        <SmartEditValue
          v-model="editingLeafValue"
          :original-value="value"
          @confirm="commitLeafEdit"
          @cancel="cancelEditLeaf"
        />
      </div>
    </td>

    <td v-if="editingAllowed" class="py-2 align-middle"></td>
  </tr>
</template>

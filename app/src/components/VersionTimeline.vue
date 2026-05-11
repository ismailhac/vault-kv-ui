<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { VersionMeta } from '../stores/vault'
import { useVaultStore } from '../stores/vault'
import NestedDiffRow from './NestedDiffRow.vue'

function parseJsonValue(val: unknown): { isNested: boolean; parsed: unknown } {
  if (val !== null && typeof val === 'object') return { isNested: true, parsed: val }
  if (typeof val === 'string') {
    const t = val.trim()
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try {
        const p = JSON.parse(t)
        if (typeof p === 'object' && p !== null) return { isNested: true, parsed: p }
      } catch {}
    }
  }
  return { isNested: false, parsed: val }
}

const props = defineProps<{
  path: string
  currentData: Record<string, string>
}>()
const emit = defineEmits<{ restore: [data: Record<string, string>] }>()

const vault = useVaultStore()
const expanded = ref(false)
const hasLoaded = ref(false)

const expandedVersion = ref<number | null>(null)
const expandedVersionData = ref<Record<string, string>>({})
const expandedVersionLoading = ref(false)
const expandedVersionError = ref<string | null>(null)

watch(() => props.path, () => {
  expanded.value = false
  hasLoaded.value = false
  expandedVersion.value = null
  expandedVersionData.value = {}
})

async function toggleHistory() {
  expanded.value = !expanded.value
  if (expanded.value && !hasLoaded.value) {
    hasLoaded.value = true
    await vault.fetchVersions(props.path)
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.substring(0, 16).replace('T', ' ')
}

async function clickRow(v: VersionMeta) {
  if (v.destroyed) return

  if (expandedVersion.value === v.version) {
    expandedVersion.value = null
    return
  }

  expandedVersion.value = v.version
  expandedVersionError.value = null

  if (v.version === vault.versionCurrentVersion) {
    expandedVersionData.value = props.currentData
    expandedVersionLoading.value = false
  } else {
    expandedVersionLoading.value = true
    expandedVersionData.value = {}
    try {
      expandedVersionData.value = await vault.readSecretVersion(props.path, v.version)
    } catch (e: unknown) {
      expandedVersionError.value = e instanceof Error ? e.message : 'Erreur de chargement'
    } finally {
      expandedVersionLoading.value = false
    }
  }
}

function restore() {
  emit('restore', expandedVersionData.value)
  expandedVersion.value = null
}

// Diff between the expanded historical version and current
type DiffStatus = 'unchanged' | 'modified' | 'added' | 'removed'
type DiffLine = { key: string; historical: string | undefined; current: string | undefined; status: DiffStatus }

const diffLines = computed<DiffLine[]>(() => {
  const allKeys = new Set([...Object.keys(expandedVersionData.value), ...Object.keys(props.currentData)])
  return [...allKeys].sort().map(key => {
    const h = expandedVersionData.value[key]
    const c = props.currentData[key]
    let status: DiffStatus = 'unchanged'
    if (h === undefined) status = 'added'        // appeared in current, absent in this version
    else if (c === undefined) status = 'removed'  // was in this version, gone from current
    else if (h !== c) status = 'modified'
    return { key, historical: h, current: c, status }
  })
})

// Expanded nested-value keys in the "current version" plain KV display
const expandedCurrentKeys = ref<Set<string>>(new Set())
function toggleCurrentKey(key: string) {
  const s = new Set(expandedCurrentKeys.value)
  s.has(key) ? s.delete(key) : s.add(key)
  expandedCurrentKeys.value = s
}
watch(() => expandedVersion.value, () => { expandedCurrentKeys.value = new Set() })

function nestedBadge(parsed: unknown): string {
  if (Array.isArray(parsed)) {
    const n = parsed.length
    return `[${n} élément${n > 1 ? 's' : ''}]`
  }
  if (typeof parsed === 'object' && parsed !== null) {
    const n = Object.keys(parsed).length
    return `{${n} clé${n > 1 ? 's' : ''}}`
  }
  return ''
}

function nestedEntries(parsed: unknown): [string, unknown][] {
  if (Array.isArray(parsed)) return parsed.map((v, i) => [String(i), v])
  if (typeof parsed === 'object' && parsed !== null) return Object.entries(parsed as Record<string, unknown>)
  return []
}

function toNestedStr(v: unknown): string {
  return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '')
}
</script>

<template>
  <!-- Panel header / toggle -->
  <button
    class="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-400 hover:text-gray-200 transition-colors"
    :class="expanded ? 'border-b border-gray-800' : ''"
    @click="toggleHistory"
  >
    <span class="font-semibold uppercase tracking-wide">Historique des versions</span>
    <span class="text-gray-600">{{ expanded ? '▲' : '▼' }}</span>
  </button>

  <div v-if="expanded" class="px-4 py-3">
    <div v-if="vault.versionLoading" class="text-gray-500 text-xs animate-pulse py-4 text-center">
      Chargement…
    </div>
    <div v-else-if="vault.versionError" class="text-red-400 text-xs py-2">
      ⚠ {{ vault.versionError }}
    </div>
    <div v-else-if="vault.versionList.length === 0" class="text-gray-600 text-xs py-2">
      Aucune version trouvée.
    </div>

    <table v-else class="w-full text-xs">
      <thead>
        <tr class="text-gray-600 uppercase border-b border-gray-800">
          <th class="text-left pb-1.5 pr-4 font-medium w-16">Ver.</th>
          <th class="text-left pb-1.5 pr-4 font-medium">Date</th>
          <th class="text-left pb-1.5 pr-4 font-medium">Par</th>
          <th class="text-left pb-1.5 font-medium">Statut</th>
          <th class="w-4"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="v in vault.versionList" :key="v.version">

          <!-- Version row -->
          <tr
            class="transition-colors"
            :class="[
              v.destroyed ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-800',
              expandedVersion === v.version ? 'bg-gray-800' : ''
            ]"
            @click="clickRow(v)"
          >
            <td
              class="py-2 pr-4 font-mono font-semibold"
              :class="v.version === vault.versionCurrentVersion ? 'text-green-400' : 'text-blue-300'"
              :title="v.version === vault.versionCurrentVersion ? 'Version actuelle' : `Version ${v.version}`"
            >
              v{{ v.version }}
            </td>
            <td class="py-2 pr-4 text-gray-400 font-mono">{{ formatDate(v.created_time) }}</td>
            <td class="py-2 pr-4 text-gray-500 font-mono">{{ v.created_by || '—' }}</td>
            <td class="py-2">
              <span v-if="v.destroyed" class="px-1.5 py-0.5 rounded text-red-400 bg-red-950">Détruit</span>
              <span v-else-if="v.deletion_time" class="px-1.5 py-0.5 rounded text-orange-400 bg-orange-950">Supprimé</span>
              <span v-else-if="v.version === vault.versionCurrentVersion" class="text-green-500">Actuelle</span>
            </td>
            <td class="py-2 text-right text-gray-600 pr-1">
              {{ !v.destroyed ? (expandedVersion === v.version ? '▲' : '▼') : '' }}
            </td>
          </tr>

          <!-- Inline accordion -->
          <tr v-if="expandedVersion === v.version">
            <td colspan="5" class="pb-3 pt-0.5">
              <div class="bg-gray-950 rounded border border-gray-700">

                <!-- Loading -->
                <div v-if="expandedVersionLoading" class="px-3 py-3 text-gray-500 text-xs animate-pulse">
                  Chargement…
                </div>

                <!-- Error -->
                <div v-else-if="expandedVersionError" class="px-3 py-3 text-red-400 text-xs">
                  ⚠ {{ expandedVersionError }}
                </div>

                <!-- Current version: plain KV with nested JSON accordion -->
                <template v-else-if="v.version === vault.versionCurrentVersion">
                  <table class="w-full text-xs font-mono">
                    <tbody>
                      <template v-for="(val, key) in expandedVersionData" :key="key">
                        <!-- Nested JSON value: accordion -->
                        <tr
                          v-if="parseJsonValue(val).isNested"
                          class="border-b border-gray-800 last:border-0 cursor-pointer select-none"
                          @click="toggleCurrentKey(String(key))"
                        >
                          <td class="py-1.5 px-3 text-blue-300 w-1/3">
                            <div class="flex items-center gap-1">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"
                                class="w-3 h-3 shrink-0 transition-transform text-gray-500"
                                :class="expandedCurrentKeys.has(String(key)) ? 'rotate-90' : ''">
                                <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z" clip-rule="evenodd"/>
                              </svg>
                              {{ key }}
                            </div>
                          </td>
                          <td class="py-1.5 px-3 text-gray-500">
                            {{ nestedBadge(parseJsonValue(val).parsed) }}
                          </td>
                        </tr>
                        <!-- Expanded nested content rendered via NestedDiffRow (status=unchanged shows the tree) -->
                        <template v-if="parseJsonValue(val).isNested && expandedCurrentKeys.has(String(key))">
                          <NestedDiffRow
                            v-for="([ck, cv]) in nestedEntries(parseJsonValue(val).parsed)"
                            :key="ck"
                            :diff-key="ck"
                            :before="toNestedStr(cv)"
                            :after="toNestedStr(cv)"
                            status="unchanged"
                            :depth="1"
                          />
                        </template>
                        <!-- Plain scalar value -->
                        <tr v-else-if="!parseJsonValue(val).isNested" class="border-b border-gray-800 last:border-0">
                          <td class="py-1.5 px-3 text-blue-300 w-1/3">{{ key }}</td>
                          <td class="py-1.5 px-3 text-gray-300 break-all">{{ val }}</td>
                        </tr>
                      </template>
                      <tr v-if="Object.keys(expandedVersionData).length === 0">
                        <td class="py-2 px-3 text-gray-600 italic">Secret vide</td>
                      </tr>
                    </tbody>
                  </table>
                </template>

                <!-- Historical version: diff table -->
                <template v-else>
                  <table class="w-full text-xs font-mono border-collapse">
                    <thead>
                      <tr class="text-gray-600 uppercase text-left border-b border-gray-700">
                        <th class="pb-1.5 px-3 w-1/4 font-medium">Clé</th>
                        <th class="pb-1.5 pr-3 font-medium">Cette version</th>
                        <th class="pb-1.5 pr-3 font-medium">Version actuelle</th>
                        <th class="pb-1.5 px-3 text-right font-medium">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <NestedDiffRow
                        v-for="line in diffLines"
                        :key="line.key"
                        :diff-key="line.key"
                        :before="line.historical"
                        :after="line.current"
                        :status="line.status"
                        :depth="0"
                      />
                    </tbody>
                  </table>

                  <!-- Restore button -->
                  <div class="flex justify-end px-3 py-2 border-t border-gray-800">
                    <button
                      class="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded"
                      @click.stop="restore()"
                    >
                      Restaurer la version {{ v.version }}
                    </button>
                  </div>
                </template>

              </div>
            </td>
          </tr>

        </template>
      </tbody>
    </table>
  </div>
</template>

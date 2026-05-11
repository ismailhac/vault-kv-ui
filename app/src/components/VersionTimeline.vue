<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { VersionMeta } from '../stores/vault'
import { useVaultStore } from '../stores/vault'

const { t } = useI18n()

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
      expandedVersionError.value = e instanceof Error ? e.message : t('versionTimeline.error')
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
    if (h === undefined) status = 'added'
    else if (c === undefined) status = 'removed'
    else if (h !== c) status = 'modified'
    return { key, historical: h, current: c, status }
  })
})

const diffSymbol: Record<DiffStatus, string> = { unchanged: '=', modified: '~', added: '+', removed: '−' }

function rowClass(status: DiffStatus) {
  return {
    'bg-green-950 text-green-300': status === 'added',
    'bg-red-950 text-red-300': status === 'removed',
    'bg-yellow-950 text-yellow-200': status === 'modified',
    'text-gray-500': status === 'unchanged',
  }
}
</script>

<template>
  <!-- Panel header / toggle -->
  <button
    class="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-400 hover:text-gray-200 transition-colors"
    :class="expanded ? 'border-b border-gray-800' : ''"
    @click="toggleHistory"
  >
    <span class="font-semibold uppercase tracking-wide">{{ t('versionTimeline.historyTitle') }}</span>
    <span class="text-gray-600">{{ expanded ? '▲' : '▼' }}</span>
  </button>

  <div v-if="expanded" class="px-4 py-3">
    <div v-if="vault.versionLoading" class="text-gray-500 text-xs animate-pulse py-4 text-center">
      {{ t('versionTimeline.loading') }}
    </div>
    <div v-else-if="vault.versionError" class="text-red-400 text-xs py-2">
      ⚠ {{ vault.versionError }}
    </div>
    <div v-else-if="vault.versionList.length === 0" class="text-gray-600 text-xs py-2">
      {{ t('versionTimeline.noVersions') }}
    </div>

    <table v-else class="w-full text-xs">
      <thead>
        <tr class="text-gray-600 uppercase border-b border-gray-800">
          <th class="text-left pb-1.5 pr-4 font-medium w-16">{{ t('versionTimeline.versionHeader') }}</th>
          <th class="text-left pb-1.5 pr-4 font-medium">{{ t('versionTimeline.dateHeader') }}</th>
          <th class="text-left pb-1.5 pr-4 font-medium">{{ t('versionTimeline.byHeader') }}</th>
          <th class="text-left pb-1.5 font-medium">{{ t('versionTimeline.statusHeader') }}</th>
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
              :title="v.version === vault.versionCurrentVersion ? t('versionTimeline.currentVersionTitle') : t('versionTimeline.versionTitle', { n: v.version })"
            >
              v{{ v.version }}
            </td>
            <td class="py-2 pr-4 text-gray-400 font-mono">{{ formatDate(v.created_time) }}</td>
            <td class="py-2 pr-4 text-gray-500 font-mono">{{ v.created_by || '—' }}</td>
            <td class="py-2">
              <span v-if="v.destroyed" class="px-1.5 py-0.5 rounded text-red-400 bg-red-950">{{ t('versionTimeline.destroyed') }}</span>
              <span v-else-if="v.deletion_time" class="px-1.5 py-0.5 rounded text-orange-400 bg-orange-950">{{ t('versionTimeline.deleted') }}</span>
              <span v-else-if="v.version === vault.versionCurrentVersion" class="text-green-500">{{ t('versionTimeline.current') }}</span>
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
                  {{ t('versionTimeline.loading') }}
                </div>

                <!-- Error -->
                <div v-else-if="expandedVersionError" class="px-3 py-3 text-red-400 text-xs">
                  ⚠ {{ expandedVersionError }}
                </div>

                <!-- Current version: plain KV (no diff needed) -->
                <template v-else-if="v.version === vault.versionCurrentVersion">
                  <table class="w-full text-xs font-mono">
                    <tbody>
                      <tr v-for="(val, key) in expandedVersionData" :key="key" class="border-b border-gray-800 last:border-0">
                        <td class="py-1.5 px-3 text-blue-300 w-1/3">{{ key }}</td>
                        <td class="py-1.5 px-3 text-gray-300 break-all">{{ val }}</td>
                      </tr>
                      <tr v-if="Object.keys(expandedVersionData).length === 0">
                        <td class="py-2 px-3 text-gray-600 italic">{{ t('versionTimeline.emptySecret') }}</td>
                      </tr>
                    </tbody>
                  </table>
                </template>

                <!-- Historical version: diff table -->
                <template v-else>
                  <table class="w-full text-xs font-mono border-collapse">
                    <thead>
                      <tr class="text-gray-600 uppercase text-left border-b border-gray-700">
                        <th class="pb-1.5 px-3 w-1/4 font-medium">{{ t('versionTimeline.keyHeader') }}</th>
                        <th class="pb-1.5 pr-3 font-medium">{{ t('versionTimeline.thisVersionHeader') }}</th>
                        <th class="pb-1.5 pr-3 font-medium">{{ t('versionTimeline.currentVersionHeader') }}</th>
                        <th class="pb-1.5 px-3 text-right font-medium">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="line in diffLines"
                        :key="line.key"
                        class="border-b border-gray-800 last:border-0"
                        :class="rowClass(line.status)"
                      >
                        <td class="py-1.5 px-3 font-semibold break-all">{{ line.key }}</td>
                        <td class="py-1.5 pr-3 break-all opacity-90">
                          <span v-if="line.historical !== undefined">{{ line.historical }}</span>
                          <span v-else class="italic opacity-40">—</span>
                        </td>
                        <td class="py-1.5 pr-3 break-all opacity-90">
                          <span v-if="line.current !== undefined">{{ line.current }}</span>
                          <span v-else class="italic opacity-40">—</span>
                        </td>
                        <td class="py-1.5 px-3 text-right opacity-50">{{ diffSymbol[line.status] }}</td>
                      </tr>
                    </tbody>
                  </table>

                  <!-- Restore button -->
                  <div class="flex justify-end px-3 py-2 border-t border-gray-800">
                    <button
                      class="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded"
                      @click.stop="restore()"
                    >
                      {{ t('versionTimeline.restoreVersion', { n: v.version }) }}
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

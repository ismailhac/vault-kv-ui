<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'
import { findKeyPaths, getNestedValue, setNestedValue, toStringRecord } from '../utils/nestedKeys'
import { pathToDisplay, type SecretPath, type SecretData } from '../types/secret'

const { t } = useI18n()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

type Step = 1 | 2 | 3
const step = ref<Step>(1)

// ── Prod filter ──
const PROD_NAMES = new Set(['prod', 'production', 'prd'])
function pathIsProd(path: string): boolean {
  return path.split('/').slice(1).some(s => PROD_NAMES.has(s.toLowerCase()))
}
const includeProd = ref(false)

// ── Step 1 — Scan + per-path inline editing ──
const keyName = ref('')
const scanning = ref(false)
const scanError = ref<string | null>(null)
const scanned = ref(false)
const dumpData = ref<Record<string, Record<string, unknown>>>({})

const matchingPaths = computed(() =>
  Object.keys(dumpData.value)
    .filter(p => {
      if (!findKeyPaths(dumpData.value[p], keyName.value.trim()).length) return false
      if (!includeProd.value && pathIsProd(p)) return false
      return true
    })
    .sort()
)

function matchesFor(secretPath: string): SecretPath[] {
  return findKeyPaths(dumpData.value[secretPath] ?? {}, keyName.value.trim())
}

const selectedMatch = ref<Record<string, SecretPath>>({})

function getFoundPath(secretPath: string): SecretPath {
  return selectedMatch.value[secretPath] ?? matchesFor(secretPath)[0] ?? [keyName.value.trim()]
}

function pickMatch(secretPath: string, path: SecretPath) {
  selectedMatch.value = { ...selectedMatch.value, [secretPath]: path }
  resetValue(secretPath)
}

// Per-path edited values (pre-filled with current value)
const pathValues = ref<Record<string, string>>({})

// Per-path selection
const selectedPaths = ref<Set<string>>(new Set())

watch(matchingPaths, paths => {
  const vals: Record<string, string> = {}
  for (const p of paths) vals[p] = String(getNestedValue(dumpData.value[p] ?? {}, getFoundPath(p)) ?? '')
  pathValues.value = vals
  selectedPaths.value = new Set(paths)
})

function togglePath(path: string) {
  if (selectedPaths.value.has(path)) selectedPaths.value.delete(path)
  else selectedPaths.value.add(path)
  selectedPaths.value = new Set(selectedPaths.value)
}

function selectAll() { selectedPaths.value = new Set(matchingPaths.value) }
function selectNone() { selectedPaths.value = new Set() }

function resetValue(path: string) {
  pathValues.value[path] = String(getNestedValue(dumpData.value[path] ?? {}, getFoundPath(path)) ?? '')
}

function isModified(path: string): boolean {
  return (pathValues.value[path] ?? '') !== String(getNestedValue(dumpData.value[path] ?? {}, getFoundPath(path)) ?? '')
}

// ── Step 2 — Diff: only selected paths where value actually changed ──
type PathDiff = { path: string; before: Record<string, unknown>; after: Record<string, unknown>; matchPath: SecretPath; oldVal: string; newVal: string }

const previews = computed<PathDiff[]>(() =>
  [...selectedPaths.value]
    .filter(p => matchingPaths.value.includes(p) && isModified(p))
    .sort()
    .map(path => {
      const matchPath = getFoundPath(path)
      const before = dumpData.value[path] ?? {}
      const after = setNestedValue(dumpData.value[path] ?? {}, matchPath, pathValues.value[path] ?? '')
      const oldVal = String(getNestedValue(dumpData.value[path] ?? {}, matchPath) ?? '')
      const newVal = pathValues.value[path] ?? ''
      return { path, before, after, matchPath, oldVal, newVal }
    })
)

const showConfirmAll = ref(false)

const confirmAllBefore = computed(() =>
  previews.value.reduce((acc, p) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(toStringRecord(p.before)).map(([k, v]) => [`${p.path} / ${k}`, v])),
  }), {} as Record<string, string>)
)
const confirmAllAfter = computed(() =>
  previews.value.reduce((acc, p) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(toStringRecord(p.after)).map(([k, v]) => [`${p.path} / ${k}`, v])),
  }), {} as Record<string, string>)
)

// Paths that are selected but unchanged (informational)
const unchangedCount = computed(() =>
  [...selectedPaths.value].filter(p => matchingPaths.value.includes(p) && !isModified(p)).length
)

// ── Step 3 — Results ──
const applyResults = ref<{ path: string; ok: boolean; error?: string }[]>([])
const applying = ref(false)
const applyOkCount = computed(() => applyResults.value.filter(r => r.ok).length)
const applyErrCount = computed(() => applyResults.value.filter(r => !r.ok).length)

// ── Validation ──
const step1Valid = computed(() => scanned.value && previews.value.length > 0)

// ── Actions ──
async function scan() {
  if (!keyName.value.trim()) return
  scanning.value = true
  scanError.value = null
  scanned.value = false
  dumpData.value = {}
  selectedMatch.value = {}
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    const payload = await res.json()
    const raw = payload?.data ?? payload
    if (typeof raw !== 'object' || raw === null) throw new Error(t('keyAdjustModal.invalidResponse'))
    dumpData.value = raw as Record<string, Record<string, string>>
    scanned.value = true
  } catch (e: unknown) {
    scanError.value = e instanceof Error ? e.message : t('keyAdjustModal.networkError')
  } finally {
    scanning.value = false
  }
}

async function applyAll() {
  showConfirmAll.value = false
  applying.value = true
  applyResults.value = []
  for (const preview of previews.value) {
    try {
      await vault.writeSecret(preview.path, preview.after as SecretData)
      applyResults.value.push({ path: preview.path, ok: true })
    } catch (e: unknown) {
      applyResults.value.push({ path: preview.path, ok: false, error: e instanceof Error ? e.message : t('keyAdjustModal.networkError') })
    }
  }
  applying.value = false
  step.value = 3
}

const STEP_LABELS = computed<Record<number, string>>(() => ({
  1: t('keyAdjustModal.step1'),
  2: t('keyAdjustModal.step2'),
  3: t('keyAdjustModal.step3'),
}))
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl light:bg-white light:border-gray-200">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0 light:border-gray-200">
        <div class="flex items-center gap-3">
          <span class="text-white font-semibold text-sm light:text-gray-900">{{ t('keyAdjustModal.title') }}</span>
          <span class="text-gray-600 text-xs">·</span>
          <span class="text-gray-500 text-xs">{{ t('keyAdjustModal.mount') }} <span class="text-green-400">{{ vault.currentMount }}</span></span>
        </div>
        <div class="flex items-center gap-1">
          <template v-for="s in [1, 2, 3]" :key="s">
            <div
              class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
              :class="step === s ? 'bg-violet-700 text-white' : s < step ? 'bg-gray-700 text-gray-300 light:bg-gray-200 light:text-gray-700' : 'text-gray-600 light:text-gray-400'"
            >
              <span>{{ s }}</span>
              <span class="hidden sm:inline">{{ STEP_LABELS[s] }}</span>
            </div>
            <span v-if="s < 3" class="text-gray-700 text-xs">›</span>
          </template>
        </div>
        <button class="text-gray-500 hover:text-gray-300 ml-3 shrink-0 light:hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <!-- Body -->
      <div class="overflow-auto flex-1 px-5 py-4">

        <!-- ── STEP 1 — Scan + per-path inline editing ── -->
        <div v-if="step === 1" class="space-y-4">
          <p class="text-gray-400 text-sm light:text-gray-600">
            {{ t('keyAdjustModal.step1Desc') }}
          </p>

          <!-- Search bar -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-gray-400 text-xs light:text-gray-600">{{ t('keyAdjustModal.keyLabel') }}</label>
              <button
                class="px-2 py-0.5 rounded border text-xs font-mono font-semibold transition pointer"
                :class="includeProd ? 'bg-red-900 border-red-700 text-red-200' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500 light:bg-gray-100 light:border-gray-300 light:text-gray-600'"
                @click="includeProd = !includeProd"
              >{{ includeProd ? t('keyAdjustModal.prodIncluded') : t('keyAdjustModal.prodExcluded') }}</button>
            </div>
            <div class="flex gap-2">
              <input
                v-model="keyName"
                type="text"
                placeholder="FF_OPEN_MODAL"
                class="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 text-violet-300 font-mono rounded text-sm focus:outline-none focus:border-violet-600 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-violet-700 light:placeholder-gray-400"
                spellcheck="false"
                @keydown.enter="scan"
              />
              <button
                class="px-4 py-2 bg-violet-700 hover:bg-violet-600 text-white rounded text-sm font-semibold disabled:opacity-40 transition"
                :disabled="!keyName.trim() || scanning"
                @click="scan"
              >{{ scanning ? t('keyAdjustModal.scanning') : t('keyAdjustModal.search') }}</button>
            </div>
          </div>

          <!-- Scanning -->
          <div v-if="scanning" class="flex flex-col items-center py-8 gap-3">
            <div class="w-10 h-10 border-2 border-gray-700 border-t-violet-400 rounded-full animate-spin light:border-gray-200 light:border-t-violet-500"></div>
            <p class="text-gray-400 text-sm light:text-gray-600">{{ t('keyAdjustModal.scanningMount') }}</p>
          </div>

          <!-- Error -->
          <div v-if="scanError" class="text-red-400 text-sm px-3 py-2 bg-red-950 border border-red-800 rounded">⚠ {{ scanError }}</div>

          <!-- No results -->
          <div v-if="scanned && !scanning && matchingPaths.length === 0" class="p-4 bg-gray-800 border border-gray-700 rounded text-center light:bg-gray-100 light:border-gray-200">
            <div class="text-gray-300 font-semibold mb-1 light:text-gray-800">{{ t('keyAdjustModal.keyNotFound') }}</div>
            <div class="text-gray-500 text-xs font-mono light:text-gray-600">
              « {{ keyName }} »{{ t('keyAdjustModal.keyNotFoundDesc') }} <span class="text-green-400">{{ vault.currentMount }}</span>.
            </div>
          </div>

          <!-- Results + inline editing -->
          <template v-if="scanned && !scanning && matchingPaths.length > 0">

            <!-- Stats bar -->
            <div class="flex items-center gap-3 px-4 py-2.5 bg-violet-950 border border-violet-800 rounded">
              <span class="text-violet-400 shrink-0">✏</span>
              <div class="flex-1">
                <span class="text-violet-200 font-semibold text-sm font-mono">{{ keyName }}</span>
                <span class="text-violet-300 text-sm">{{ t('keyAdjustModal.foundOccurrences', { n: matchingPaths.length }) }}</span>
                <div class="text-violet-500 text-xs mt-0.5">
                  {{ t('keyAdjustModal.pendingModifications', { n: previews.length }) }}
                </div>
              </div>
            </div>

            <!-- Path list with inline editable values -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-gray-400 text-xs light:text-gray-600">
                  {{ t('keyAdjustModal.selectedPaths', { selected: selectedPaths.size, total: matchingPaths.length }) }}
                  <span v-if="previews.length > 0" class="ml-2 text-yellow-400">· {{ t('keyAdjustModal.modified', { n: previews.length }) }}</span>
                </span>
                <div class="flex gap-2">
                  <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectAll">{{ t('keyAdjustModal.all') }}</button>
                  <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectNone">{{ t('keyAdjustModal.none') }}</button>
                </div>
              </div>

              <div class="border border-gray-700 rounded divide-y divide-gray-800 light:border-gray-200 light:divide-gray-200">
                <div
                  v-for="path in matchingPaths"
                  :key="path"
                  class="px-3 py-2 transition"
                  :class="selectedPaths.has(path) ? '' : 'opacity-35'"
                >
                  <div class="flex items-center gap-3">
                    <!-- Checkbox -->
                    <span
                      class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs cursor-pointer transition"
                      :class="selectedPaths.has(path) ? 'bg-violet-500 border-violet-400' : 'border-gray-600 bg-gray-800 light:border-gray-400 light:bg-gray-100'"
                      @click="togglePath(path)"
                    >
                      <span v-if="selectedPaths.has(path)">✓</span>
                    </span>

                    <!-- Path -->
                    <span
                      class="font-mono text-xs text-gray-300 cursor-pointer shrink-0 min-w-0 truncate light:text-gray-700"
                      style="max-width: 220px"
                      :title="path"
                      @click="togglePath(path)"
                    >{{ path }}</span>

                    <!-- Editable value -->
                    <div class="flex-1 flex items-center gap-1.5 min-w-0">
                      <input
                        v-model="pathValues[path]"
                        type="text"
                        class="flex-1 px-2 py-1 bg-gray-950 font-mono rounded text-xs focus:outline-none transition min-w-0 light:bg-white"
                        :class="isModified(path)
                          ? 'border border-yellow-600 text-yellow-200 focus:border-yellow-400'
                          : 'border border-gray-700 text-gray-400 focus:border-gray-500 light:border-gray-300 light:text-gray-600'"
                        :disabled="!selectedPaths.has(path)"
                        spellcheck="false"
                      />
                      <!-- Reset button — only show when value is modified -->
                      <button
                        v-if="isModified(path)"
                        class="shrink-0 text-gray-600 hover:text-gray-300 text-xs px-1.5 py-1 rounded hover:bg-gray-700 transition light:hover:text-gray-700 light:hover:bg-gray-100"
                        :title="t('keyAdjustModal.resetValue')"
                        @click="resetValue(path)"
                      >↺</button>
                    </div>

                    <!-- Modified badge -->
                    <span
                      v-if="isModified(path) && selectedPaths.has(path)"
                      class="shrink-0 text-xs px-1.5 py-0.5 bg-yellow-900 text-yellow-300 rounded border border-yellow-800"
                    >{{ t('keyAdjustModal.modifiedBadge') }}</span>
                  </div>

                  <!-- Multi-match picker: this key exists at more than one nested location in this secret -->
                  <div v-if="matchesFor(path).length > 1" class="mt-1.5 pl-7 flex items-center gap-2">
                    <span class="text-amber-500 text-xs shrink-0">⚠ {{ t('keyAdjustModal.multiMatch', { n: matchesFor(path).length }) }}</span>
                    <select
                      class="flex-1 min-w-0 px-1.5 py-0.5 bg-gray-950 border border-amber-700 text-amber-300 font-mono text-xs rounded focus:outline-none"
                      :value="pathToDisplay(getFoundPath(path))"
                      @change="pickMatch(path, matchesFor(path)[($event.target as HTMLSelectElement).selectedIndex])"
                    >
                      <option v-for="m in matchesFor(path)" :key="pathToDisplay(m)" :value="pathToDisplay(m)">{{ pathToDisplay(m) }}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="unchangedCount > 0 && previews.length > 0" class="text-gray-600 text-xs light:text-gray-500">
              {{ t('keyAdjustModal.unchangedInfo', { n: unchangedCount }) }}
            </div>
            <div v-if="scanned && previews.length === 0" class="text-gray-500 text-xs">
              {{ t('keyAdjustModal.editAtLeastOne') }}
            </div>
          </template>
        </div>

        <!-- ── STEP 2 — Diff ── -->
        <div v-else-if="step === 2" class="space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-gray-400 text-sm light:text-gray-600">
              {{ t('keyAdjustModal.diffTitle', { n: previews.length }) }} <span class="font-mono text-violet-300">{{ keyName }}</span>
            </span>
            <div class="flex gap-2">
              <button class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700" @click="step = 1">{{ t('keyAdjustModal.adjust') }}</button>
              <button
                class="text-xs px-3 py-1 bg-violet-700 hover:bg-violet-600 text-white rounded font-semibold disabled:opacity-40"
                :disabled="previews.length === 0"
                @click="showConfirmAll = true"
              >{{ t('keyAdjustModal.apply', { n: previews.length }) }}</button>
            </div>
          </div>

          <div class="border border-gray-700 rounded divide-y divide-gray-800 light:border-gray-200 light:divide-gray-200">
            <div v-for="entry in previews" :key="entry.path" class="px-4 py-2.5">
              <div class="font-mono text-xs text-gray-400 mb-1.5 light:text-gray-600">{{ entry.path }}</div>
              <table class="w-full text-xs font-mono">
                <tbody>
                  <tr class="text-yellow-200 bg-yellow-950">
                    <td class="py-1 pr-4 w-1/3 font-semibold">{{ pathToDisplay(entry.matchPath) }}</td>
                    <td class="py-1 pr-4 w-1/3 opacity-60 line-through">{{ entry.oldVal }}</td>
                    <td class="py-1 w-1/3 font-bold text-green-300">{{ entry.newVal }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="previews.length === 0" class="text-gray-500 text-sm text-center py-4">{{ t('keyAdjustModal.noModifications') }}</div>
        </div>

        <!-- ── STEP 3 — Résultat ── -->
        <div v-else-if="step === 3" class="space-y-4">
          <div class="flex flex-col items-center py-10 gap-4">
            <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2"
              :class="applyErrCount === 0 ? 'border-green-500 bg-green-950 text-green-400' : 'border-amber-500 bg-amber-950 text-amber-400'">
              {{ applyErrCount === 0 ? '✓' : '⚠' }}
            </div>
            <div class="text-center">
              <div class="text-white font-semibold text-base mb-1 light:text-gray-900">
                {{ applyErrCount === 0 ? t('keyAdjustModal.step3Success') : t('keyAdjustModal.step3Errors') }}
              </div>
              <div class="text-gray-400 text-sm light:text-gray-600">
                <span class="font-mono text-violet-300">{{ keyName }}</span> {{ t('keyAdjustModal.adjustedIn') }}
                {{ t('keyAdjustModal.successAdjustments', { n: applyOkCount }) }}
                <template v-if="applyErrCount > 0"> · <span class="text-red-400 font-bold">{{ applyErrCount }}</span></template>
              </div>
            </div>
          </div>

          <div v-if="applyErrCount > 0" class="space-y-1">
            <div v-for="r in applyResults.filter(r => !r.ok)" :key="r.path"
              class="flex items-center gap-2 px-3 py-1.5 bg-red-950 border border-red-800 rounded text-xs">
              <span class="text-red-400 shrink-0">✗</span>
              <span class="font-mono text-red-300 flex-1">{{ r.path }}</span>
              <span class="text-red-400">{{ r.error }}</span>
            </div>
          </div>

          <details v-if="applyOkCount > 0" class="text-xs text-gray-600 light:text-gray-500">
            <summary class="cursor-pointer hover:text-gray-400 transition light:hover:text-gray-600">{{ t('keyAdjustModal.successAdjustments', { n: applyOkCount }) }}</summary>
            <div class="mt-2 space-y-0.5 font-mono">
              <div v-for="r in applyResults.filter(r => r.ok)" :key="r.path" class="text-green-700">✓ {{ r.path }}</div>
            </div>
          </details>
        </div>

      </div><!-- end body -->

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-gray-700 flex items-center justify-between shrink-0 light:border-gray-200">
        <button
          v-if="step > 1 && step < 3"
          class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-40 light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
          :disabled="applying"
          @click="step = (step - 1) as Step"
        >{{ t('keyAdjustModal.back') }}</button>
        <div v-else></div>

        <div class="flex gap-2">
          <button v-if="step === 3" class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700" @click="emit('close')">{{ t('keyAdjustModal.close') }}</button>

          <button
            v-if="step === 1"
            class="text-sm px-4 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="!step1Valid"
            @click="step = 2"
          >{{ t('keyAdjustModal.viewDiff', { n: previews.length }) }}</button>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDiffModal
    v-if="showConfirmAll"
    :path="t('keyAdjustModal.diffTitle', { n: previews.length })"
    :before="confirmAllBefore"
    :after="confirmAllAfter"
    @confirm="applyAll"
    @cancel="showConfirmAll = false"
  />
</template>

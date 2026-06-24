<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'
import { findKeyPaths, getNestedValue, removeNestedKey, toStringRecord } from '../utils/nestedKeys'

const { t } = useI18n()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

type Step = 1 | 2 | 3 | 4
const step = ref<Step>(1)

// ── Step 1 — Scan ──
const keyName = ref('')
const scanning = ref(false)
const scanError = ref<string | null>(null)
const scanned = ref(false)
// Full dump: path → secret data
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

function getFoundPath(secretPath: string): string {
  return findKeyPaths(dumpData.value[secretPath] ?? {}, keyName.value.trim())[0] ?? keyName.value.trim()
}

// ── Step 2 — Selection ──
const selectedProjects = ref<string[]>([])
const selectedBUs = ref<string[]>([])
const selectedEnvs = ref<string[]>([])
const includeSubPaths = ref(true)

// ── Path helpers (same model: project[0] / BU[1] / env[2] / sub[3+]) ──
const seg = (p: string, i: number) => p.split('/')[i] ?? ''
const pathDepth = (p: string) => p.split('/').length

const PROD_NAMES = new Set(['prod', 'production', 'prd'])
const isProd = (env: string) => PROD_NAMES.has(env.toLowerCase())
function pathIsProd(path: string): boolean {
  return path.split('/').slice(1).some(s => PROD_NAMES.has(s.toLowerCase()))
}
const includeProd = ref(false)

const availableProjects = computed(() =>
  [...new Set(matchingPaths.value.map(p => seg(p, 0)).filter(Boolean))].sort()
)
const availableBUs = computed(() =>
  [...new Set(
    matchingPaths.value
      .filter(p => selectedProjects.value.includes(seg(p, 0)) && seg(p, 1))
      .map(p => seg(p, 1)),
  )].sort()
)
const availableEnvs = computed(() =>
  [...new Set(
    matchingPaths.value
      .filter(p =>
        selectedProjects.value.includes(seg(p, 0)) &&
        selectedBUs.value.includes(seg(p, 1)) &&
        seg(p, 2),
      )
      .map(p => seg(p, 2)),
  )].sort()
)

const pathsPerProject = computed(() => {
  const map: Record<string, number> = {}
  for (const p of matchingPaths.value) { const s = seg(p, 0); if (s) map[s] = (map[s] ?? 0) + 1 }
  return map
})
const pathsPerBU = computed(() => {
  const map: Record<string, number> = {}
  for (const p of matchingPaths.value) {
    if (!selectedProjects.value.includes(seg(p, 0))) continue
    const b = seg(p, 1); if (b) map[b] = (map[b] ?? 0) + 1
  }
  return map
})
const pathsPerEnv = computed(() => {
  const map: Record<string, number> = {}
  for (const p of matchingPaths.value) {
    if (!selectedProjects.value.includes(seg(p, 0))) continue
    if (!selectedBUs.value.includes(seg(p, 1))) continue
    const e = seg(p, 2); if (e) map[e] = (map[e] ?? 0) + 1
  }
  return map
})

const targetPaths = computed(() =>
  matchingPaths.value.filter(p => {
    if (!selectedProjects.value.includes(seg(p, 0))) return false
    if (seg(p, 1) && !selectedBUs.value.includes(seg(p, 1))) return false
    if (seg(p, 2) && !selectedEnvs.value.includes(seg(p, 2))) return false
    if (!includeSubPaths.value && pathDepth(p) > 3) return false
    return true
  })
)

// ── Step 3 — Diff (computed from dump, no extra fetch) ──
type PathDiff = { path: string; before: Record<string, string>; after: Record<string, string>; dotPath: string; oldVal: string }

const previews = computed<PathDiff[]>(() =>
  targetPaths.value.map(path => {
    const dotPath = getFoundPath(path)
    const before = toStringRecord(dumpData.value[path] ?? {})
    const after = removeNestedKey(dumpData.value[path] ?? {}, dotPath)
    const oldVal = String(getNestedValue(dumpData.value[path] ?? {}, dotPath) ?? '')
    return { path, before, after, dotPath, oldVal }
  })
)

const showConfirmAll = ref(false)

const confirmAllBefore = computed(() =>
  previews.value.reduce((acc, p) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(p.before).map(([k, v]) => [`${p.path} / ${k}`, v])),
  }), {} as Record<string, string>)
)
const confirmAllAfter = computed(() =>
  previews.value.reduce((acc, p) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(p.after).map(([k, v]) => [`${p.path} / ${k}`, v])),
  }), {} as Record<string, string>)
)

const previewsByGroup = computed(() => {
  const groups: Record<string, PathDiff[]> = {}
  for (const p of previews.value) {
    const group = [seg(p.path, 0), seg(p.path, 1), seg(p.path, 2)].filter(Boolean).join('/')
    if (!groups[group]) groups[group] = []
    groups[group].push(p)
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
})

// ── Step 4 — Results ──
const applyResults = ref<{ path: string; ok: boolean; error?: string }[]>([])
const applying = ref(false)
const applyOkCount = computed(() => applyResults.value.filter(r => r.ok).length)
const applyErrCount = computed(() => applyResults.value.filter(r => !r.ok).length)

// ── Watchers — auto-select all when available lists change ──
watch(availableProjects, projs => { selectedProjects.value = [...projs] })
watch(availableBUs, bus => { selectedBUs.value = [...bus] })
watch(availableEnvs, envs => { selectedEnvs.value = [...envs] })

// ── Actions ──
async function scan() {
  if (!keyName.value.trim()) return
  scanning.value = true
  scanError.value = null
  scanned.value = false
  dumpData.value = {}
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    const payload = await res.json()
    const raw = payload?.data ?? payload
    if (typeof raw !== 'object' || raw === null) throw new Error(t('keyRemovalModal.invalidResponse'))
    dumpData.value = raw as Record<string, Record<string, string>>
    scanned.value = true
  } catch (e: unknown) {
    scanError.value = e instanceof Error ? e.message : t('keyRemovalModal.networkError')
  } finally {
    scanning.value = false
  }
}

function toggleProject(p: string) {
  const idx = selectedProjects.value.indexOf(p)
  if (idx === -1) selectedProjects.value.push(p)
  else selectedProjects.value.splice(idx, 1)
}
function toggleBU(bu: string) {
  const idx = selectedBUs.value.indexOf(bu)
  if (idx === -1) selectedBUs.value.push(bu)
  else selectedBUs.value.splice(idx, 1)
}
function toggleEnv(env: string) {
  const idx = selectedEnvs.value.indexOf(env)
  if (idx === -1) selectedEnvs.value.push(env)
  else selectedEnvs.value.splice(idx, 1)
}
function quickSelectEnvs(preset: 'all' | 'no-prod' | 'prod-only') {
  if (preset === 'all') selectedEnvs.value = [...availableEnvs.value]
  else if (preset === 'no-prod') selectedEnvs.value = availableEnvs.value.filter(e => !isProd(e))
  else selectedEnvs.value = availableEnvs.value.filter(e => isProd(e))
}

async function applyAll() {
  showConfirmAll.value = false
  applying.value = true
  applyResults.value = []
  for (const preview of previews.value) {
    try {
      await vault.writeSecret(preview.path, preview.after)
      applyResults.value.push({ path: preview.path, ok: true })
    } catch (e: unknown) {
      applyResults.value.push({ path: preview.path, ok: false, error: e instanceof Error ? e.message : t('keyRemovalModal.networkError') })
    }
  }
  applying.value = false
  step.value = 4
}

const STEP_LABELS = computed<Record<number, string>>(() => ({
  1: t('keyRemovalModal.step1'),
  2: t('keyRemovalModal.step2'),
  3: t('keyRemovalModal.step3'),
  4: t('keyRemovalModal.step4'),
}))
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl light:bg-white light:border-gray-200">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0 light:border-gray-200">
        <div class="flex items-center gap-3">
          <span class="text-white font-semibold text-sm light:text-gray-900">{{ t('keyRemovalModal.title') }}</span>
          <span class="text-gray-600 text-xs">·</span>
          <span class="text-gray-500 text-xs">{{ t('keyRemovalModal.mount') }} <span class="text-green-400">{{ vault.currentMount }}</span></span>
        </div>
        <div class="flex items-center gap-1">
          <template v-for="s in [1, 2, 3, 4]" :key="s">
            <div
              class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
              :class="step === s ? 'bg-red-700 text-white' : s < step ? 'bg-gray-700 text-gray-300 light:bg-gray-200 light:text-gray-700' : 'text-gray-600 light:text-gray-400'"
            >
              <span>{{ s }}</span>
              <span class="hidden sm:inline">{{ STEP_LABELS[s] }}</span>
            </div>
            <span v-if="s < 4" class="text-gray-700 text-xs">›</span>
          </template>
        </div>
        <button class="text-gray-500 hover:text-gray-300 ml-3 shrink-0 light:hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <!-- Body -->
      <div class="overflow-auto flex-1 px-5 py-4">

        <!-- ── STEP 1 — Recherche ── -->
        <div v-if="step === 1" class="space-y-5">
          <p class="text-gray-400 text-sm light:text-gray-600">
            {{ t('keyRemovalModal.step1Desc') }}
          </p>

          <!-- Key input + scan -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-gray-400 text-xs light:text-gray-600">{{ t('keyRemovalModal.keyLabel') }}</label>
              <button
                class="px-2 py-0.5 rounded border text-xs font-mono font-semibold transition pointer"
                :class="includeProd ? 'bg-red-900 border-red-700 text-red-200' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500 light:bg-gray-100 light:border-gray-300 light:text-gray-600'"
                @click="includeProd = !includeProd"
              >{{ includeProd ? t('keyRemovalModal.prodIncluded') : t('keyRemovalModal.prodExcluded') }}</button>
            </div>
            <div class="flex gap-2">
              <input
                v-model="keyName"
                type="text"
                placeholder="FF_OPEN_MODAL"
                class="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 text-red-300 font-mono rounded text-sm focus:outline-none focus:border-red-600 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-red-700 light:placeholder-gray-400"
                spellcheck="false"
                @keydown.enter="scan"
              />
              <button
                class="px-4 py-2 bg-red-800 hover:bg-red-700 text-white rounded text-sm font-semibold disabled:opacity-40 transition"
                :disabled="!keyName.trim() || scanning"
                @click="scan"
              >
                {{ scanning ? t('keyRemovalModal.scanning') : t('keyRemovalModal.search') }}
              </button>
            </div>
          </div>

          <!-- Scanning spinner -->
          <div v-if="scanning" class="flex flex-col items-center py-8 gap-3">
            <div class="w-10 h-10 border-2 border-gray-700 border-t-red-400 rounded-full animate-spin light:border-gray-200 light:border-t-red-500"></div>
            <p class="text-gray-400 text-sm light:text-gray-600">{{ t('keyRemovalModal.scanningAll') }}</p>
            <p class="text-gray-600 text-xs light:text-gray-500">{{ t('keyRemovalModal.mountLabel') }} <span class="text-green-500">{{ vault.currentMount }}</span></p>
          </div>

          <!-- Scan error -->
          <div v-if="scanError" class="text-red-400 text-sm px-3 py-2 bg-red-950 border border-red-800 rounded">
            ⚠ {{ scanError }}
          </div>

          <!-- Scan result -->
          <template v-if="scanned && !scanning">
            <div v-if="matchingPaths.length === 0" class="p-4 bg-gray-800 border border-gray-700 rounded text-center light:bg-gray-100 light:border-gray-200">
              <div class="text-gray-300 font-semibold mb-1 light:text-gray-800">{{ t('keyRemovalModal.keyNotFound') }}</div>
              <div class="text-gray-500 text-xs font-mono light:text-gray-600">
                « {{ keyName }} »{{ t('keyRemovalModal.keyNotFoundDesc') }} <span class="text-green-400">{{ vault.currentMount }}</span>.
              </div>
            </div>

            <div v-else class="space-y-3">
              <div class="flex items-center gap-3 p-3 bg-red-950 border border-red-800 rounded">
                <span class="text-red-400 text-lg">⚠</span>
                <div>
                  <div class="text-red-200 font-semibold text-sm">
                    <span class="font-mono">{{ keyName }}</span>{{ t('keyRemovalModal.foundIn') }}
                    <span class="text-white font-bold">{{ matchingPaths.length }}</span> {{ t('keyRemovalModal.secrets') }}
                  </div>
                  <div class="text-red-400 text-xs mt-0.5">
                    {{ t('keyRemovalModal.distribution', { n: availableProjects.length, total: Object.keys(dumpData).length }) }}
                  </div>
                </div>
              </div>

              <!-- Preview of matching paths (first 10) -->
              <div class="bg-gray-800 border border-gray-700 rounded divide-y divide-gray-700 light:bg-gray-50 light:border-gray-200 light:divide-gray-200">
                <div
                  v-for="path in matchingPaths.slice(0, 10)"
                  :key="path"
                  class="px-4 py-2 flex items-center gap-3 text-xs font-mono"
                >
                  <span class="text-red-500 shrink-0">✗</span>
                  <span class="text-gray-300 flex-1 light:text-gray-700">{{ path }}</span>
                  <span class="text-gray-600">{{ getFoundPath(path) }} = <span class="text-amber-400">{{ String(getNestedValue(dumpData[path] ?? {}, getFoundPath(path)) ?? '') }}</span></span>
                </div>
                <div v-if="matchingPaths.length > 10" class="px-4 py-2 text-xs text-gray-500 text-center light:text-gray-600">
                  {{ t('keyRemovalModal.moreItems', { n: matchingPaths.length - 10 }) }}
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ── STEP 2 — Sélection ── -->
        <div v-else-if="step === 2" class="space-y-5">
          <p class="text-gray-400 text-sm light:text-gray-600">
            {{ t('keyRemovalModal.step2Desc') }} <span class="font-mono text-red-300">{{ keyName }}</span> {{ t('keyRemovalModal.step2DescSuffix') }}
          </p>

          <!-- Project filter -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-gray-400 text-xs uppercase tracking-wider font-semibold light:text-gray-600">{{ t('keyRemovalModal.projectsLabel') }}</label>
              <div class="flex gap-1.5">
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedProjects = [...availableProjects]">{{ t('keyRemovalModal.all') }}</button>
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedProjects = []">{{ t('keyRemovalModal.none') }}</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="proj in availableProjects" :key="proj"
                class="flex items-center gap-2 px-3 py-1.5 rounded border cursor-pointer text-xs font-mono transition select-none"
                :class="selectedProjects.includes(proj)
                  ? 'bg-indigo-950 border-indigo-700 text-indigo-200'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'"
                @click="toggleProject(proj)"
              >
                <span class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-white" style="font-size:9px"
                  :class="selectedProjects.includes(proj) ? 'bg-indigo-500 border-indigo-400' : 'border-gray-600'">
                  <span v-if="selectedProjects.includes(proj)">✓</span>
                </span>
                {{ proj }}
                <span class="opacity-50">{{ pathsPerProject[proj] ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- BU filter -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-gray-400 text-xs uppercase tracking-wider font-semibold light:text-gray-600">{{ t('keyRemovalModal.busLabel') }}</label>
              <div class="flex gap-1.5">
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedBUs = [...availableBUs]">{{ t('keyRemovalModal.all') }}</button>
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedBUs = []">{{ t('keyRemovalModal.none') }}</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="bu in availableBUs" :key="bu"
                class="flex items-center gap-2 px-3 py-1.5 rounded border cursor-pointer text-xs font-mono transition select-none"
                :class="selectedBUs.includes(bu)
                  ? 'bg-blue-950 border-blue-700 text-blue-200'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'"
                @click="toggleBU(bu)"
              >
                <span class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 text-white" style="font-size:9px"
                  :class="selectedBUs.includes(bu) ? 'bg-blue-500 border-blue-400' : 'border-gray-600'">
                  <span v-if="selectedBUs.includes(bu)">✓</span>
                </span>
                {{ bu }}
                <span class="opacity-50">{{ pathsPerBU[bu] ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- Env filter -->
          <div>
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <label class="text-gray-400 text-xs uppercase tracking-wider font-semibold light:text-gray-600">{{ t('keyRemovalModal.envsLabel') }}</label>
              <div class="flex gap-1.5 ml-auto">
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="quickSelectEnvs('all')">{{ t('keyRemovalModal.all') }}</button>
                <button class="text-xs px-2 py-0.5 bg-emerald-900 hover:bg-emerald-800 text-emerald-300 border border-emerald-800 rounded" @click="quickSelectEnvs('no-prod')">{{ t('keyRemovalModal.noProd') }}</button>
                <button class="text-xs px-2 py-0.5 bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 rounded" @click="quickSelectEnvs('prod-only')">{{ t('keyRemovalModal.prodOnly') }}</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="env in availableEnvs" :key="env"
                class="flex items-center gap-2 px-3 py-1.5 rounded border cursor-pointer text-xs font-mono font-semibold transition select-none"
                :class="selectedEnvs.includes(env)
                  ? isProd(env) ? 'bg-red-950 border-red-600 text-red-200' : 'bg-emerald-950 border-emerald-600 text-emerald-200'
                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600'"
                @click="toggleEnv(env)"
              >
                <span class="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0" style="font-size:9px"
                  :class="selectedEnvs.includes(env)
                    ? isProd(env) ? 'bg-red-500 border-red-400 text-white' : 'bg-emerald-500 border-emerald-400 text-white'
                    : 'border-gray-600'">
                  <span v-if="selectedEnvs.includes(env)">✓</span>
                </span>
                {{ env }}
                <span v-if="isProd(env)" class="text-red-500 opacity-70 font-normal">{{ t('keyRemovalModal.prod') }}</span>
                <span class="opacity-50 font-normal">{{ pathsPerEnv[env] ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- Sub-paths toggle -->
          <div
            class="flex items-start gap-3 p-3 rounded border cursor-pointer transition select-none"
            :class="includeSubPaths ? 'bg-amber-950 border-amber-800' : 'bg-gray-800 border-gray-700 hover:border-gray-600'"
            @click="includeSubPaths = !includeSubPaths"
          >
            <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 text-white text-xs"
              :class="includeSubPaths ? 'bg-amber-500 border-amber-400' : 'border-gray-600'">
              <span v-if="includeSubPaths">✓</span>
            </span>
            <div>
              <div class="text-xs font-semibold" :class="includeSubPaths ? 'text-amber-200' : 'text-gray-300'">{{ t('keyRemovalModal.includeSubPaths') }}</div>
              <div class="text-xs text-gray-500 mt-0.5">
                {{ t('keyRemovalModal.includeSubPathsDesc') }}
              </div>
            </div>
          </div>

          <!-- Summary -->
          <div class="p-3 bg-gray-800 border border-gray-700 rounded text-xs space-y-1.5 light:bg-gray-100 light:border-gray-200">
            <div class="text-gray-300 font-semibold mb-1 light:text-gray-800">{{ t('keyRemovalModal.summaryTitle') }}</div>
            <div class="text-gray-400 light:text-gray-600">{{ t('keyRemovalModal.summaryKey') }} <span class="font-mono text-red-300">{{ keyName }}</span></div>
            <div class="text-gray-400 light:text-gray-600">{{ t('keyRemovalModal.summaryProjects') }} <span class="text-white font-mono light:text-gray-900">{{ selectedProjects.join(', ') || '—' }}</span></div>
            <div class="text-gray-400 light:text-gray-600">{{ t('keyRemovalModal.summaryBUs') }} <span class="text-blue-300 font-mono">{{ selectedBUs.join(', ') || '—' }}</span></div>
            <div class="text-gray-400 light:text-gray-600">{{ t('keyRemovalModal.summaryEnvs') }} <span class="font-mono">
              <span v-for="(e, i) in selectedEnvs" :key="e">
                <span :class="isProd(e) ? 'text-red-300' : 'text-emerald-300'">{{ e }}</span>
                <span v-if="i < selectedEnvs.length - 1" class="text-gray-600">, </span>
              </span>
              <span v-if="!selectedEnvs.length" class="text-gray-600">—</span>
            </span></div>
            <div class="text-gray-400 light:text-gray-600">{{ t('keyRemovalModal.summarySubPaths') }} <span :class="includeSubPaths ? 'text-amber-300' : 'text-gray-300 light:text-gray-700'">{{ includeSubPaths ? t('keyRemovalModal.included') : t('keyRemovalModal.excluded') }}</span></div>
            <div class="pt-1 border-t border-gray-700 light:border-gray-300">
              {{ t('keyRemovalModal.targetedPaths') }} <span class="text-red-400 font-bold text-sm">{{ targetPaths.length }}</span>
              {{ t('keyRemovalModal.ofPathsWithKey') }}
            </div>
          </div>
        </div>

        <!-- ── STEP 3 — Diff ── -->
        <div v-else-if="step === 3" class="space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-gray-400 text-sm light:text-gray-600">
              {{ t('keyRemovalModal.step3Title', { n: previews.length }) }} <span class="font-mono text-red-300">{{ keyName }}</span> {{ t('keyRemovalModal.willBeDeleted') }}
            </span>
            <div class="flex gap-2">
              <button class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700" @click="step = 2">{{ t('keyRemovalModal.adjust') }}</button>
              <button
                class="text-xs px-3 py-1 bg-red-700 hover:bg-red-600 text-white rounded font-semibold disabled:opacity-40"
                :disabled="previews.length === 0"
                @click="showConfirmAll = true"
              >{{ t('keyRemovalModal.deleteIn', { n: previews.length }) }}</button>
            </div>
          </div>

          <!-- Diffs grouped by project/BU/env -->
          <div v-for="([group, entries]) in previewsByGroup" :key="group" class="border border-gray-700 rounded light:border-gray-200">
            <div class="px-4 py-2 bg-gray-800 rounded-t flex items-center gap-1.5 text-xs font-mono flex-wrap light:bg-gray-100">
              <span class="text-purple-300 font-semibold">{{ group.split('/')[0] }}</span>
              <span class="text-gray-600">/</span>
              <span class="text-blue-300 font-semibold">{{ group.split('/')[1] }}</span>
              <span v-if="group.split('/')[2]" class="text-gray-600">/</span>
              <span v-if="group.split('/')[2]" class="font-semibold"
                :class="isProd(group.split('/')[2]) ? 'text-red-300' : 'text-emerald-300'">
                {{ group.split('/')[2] }}
              </span>
              <span v-if="isProd(group.split('/')[2] ?? '')" class="text-red-500 text-xs">{{ t('keyRemovalModal.prod') }}</span>
              <span class="ml-auto text-gray-500">{{ entries.length }} path(s)</span>
            </div>

            <div v-for="entry in entries" :key="entry.path" class="border-t border-gray-800 first:border-0 light:border-gray-200">
              <div class="px-4 py-1 flex items-center gap-2">
                <span class="font-mono text-xs text-gray-400 light:text-gray-600">{{ entry.path }}</span>
                <span v-if="pathDepth(entry.path) > 3" class="text-amber-600 text-xs">{{ t('keyRemovalModal.subPath') }}</span>
              </div>
              <table class="w-full text-xs font-mono">
                <tbody>
                  <tr class="border-t border-gray-800 bg-red-950 text-red-300">
                    <td class="px-4 py-1 w-1/3 line-through opacity-70">{{ entry.dotPath }}</td>
                    <td class="px-2 py-1 w-1/3 line-through opacity-70">{{ entry.oldVal }}</td>
                    <td class="px-2 py-1 w-1/3 italic text-red-500">{{ t('keyRemovalModal.deletedLabel') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="previews.length === 0" class="text-gray-500 text-sm text-center py-4">
            {{ t('keyRemovalModal.noPaths') }}
          </div>
        </div>

        <!-- ── STEP 4 — Résultat ── -->
        <div v-else-if="step === 4" class="space-y-4">
          <div class="flex flex-col items-center py-10 gap-4">
            <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2"
              :class="applyErrCount === 0 ? 'border-green-500 bg-green-950 text-green-400' : 'border-amber-500 bg-amber-950 text-amber-400'">
              {{ applyErrCount === 0 ? '✓' : '⚠' }}
            </div>
            <div class="text-center">
              <div class="text-white font-semibold text-base mb-1 light:text-gray-900">
                {{ applyErrCount === 0 ? t('keyRemovalModal.step4Success') : t('keyRemovalModal.step4Errors') }}
              </div>
              <div class="text-gray-400 text-sm light:text-gray-600">
                <span class="font-mono text-red-300">{{ keyName }}</span> {{ t('keyRemovalModal.deletedFrom') }}
                <span class="text-green-400 font-bold">{{ applyOkCount }}</span> {{ t('keyRemovalModal.secretsLabel') }}
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
            <summary class="cursor-pointer hover:text-gray-400 transition light:hover:text-gray-600">{{ t('keyRemovalModal.successDeletions', { n: applyOkCount }) }}</summary>
            <div class="mt-2 space-y-0.5 font-mono">
              <div v-for="r in applyResults.filter(r => r.ok)" :key="r.path" class="text-green-700">✓ {{ r.path }}</div>
            </div>
          </details>
        </div>

      </div><!-- end body -->

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-gray-700 flex items-center justify-between shrink-0 light:border-gray-200">
        <button
          v-if="step > 1 && step < 4"
          class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
          :disabled="applying"
          @click="step = (step - 1) as Step"
        >{{ t('keyRemovalModal.back') }}</button>
        <div v-else></div>

        <div class="flex gap-2">
          <button v-if="step === 4" class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700" @click="emit('close')">{{ t('keyRemovalModal.close') }}</button>

          <button
            v-if="step === 1"
            class="text-sm px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="matchingPaths.length === 0 || !scanned"
            @click="step = 2"
          >{{ t('keyRemovalModal.selectPaths') }}</button>

          <button
            v-else-if="step === 2"
            class="text-sm px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="targetPaths.length === 0"
            @click="step = 3"
          >{{ t('keyRemovalModal.viewDiff') }}</button>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDiffModal
    v-if="showConfirmAll"
    :path="t('keyRemovalModal.step3Title', { n: previews.length })"
    :before="confirmAllBefore"
    :after="confirmAllAfter"
    @confirm="applyAll"
    @cancel="showConfirmAll = false"
  />
</template>

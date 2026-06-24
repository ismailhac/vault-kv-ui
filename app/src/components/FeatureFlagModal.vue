<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'
import { setNestedValue, getNestedValue, toStringRecord } from '../utils/nestedKeys'

const { t } = useI18n()
const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

type Step = 1 | 2 | 3 | 4 | 5
const step = ref<Step>(1)

// ── Step 1 — FF definition ──
const ffKey = ref('')
const ffValueType = ref<'boolean' | 'string' | 'number'>('boolean')
const ffValue = ref('true')
const ffProdValue = ref('false')

// ── Step 2 — Project selection ──
const allPaths = ref<string[]>([])
const loadingPaths = ref(true)
const loadError = ref<string | null>(null)
const selectedProjects = ref<string[]>([])

// ── Step 3 — BU + Env ──
// Path structure: {project[0]} / {BU[1]} / {env[2]} / {sub-path[3+]}
const selectedBUs = ref<string[]>([])
const selectedEnvs = ref<string[]>([])
const includeSubPaths = ref(false)
const activeProdMode = ref(false)
const perEnvValues = ref(false)
const envValueMap = ref<Record<string, string>>({})

// ── Step 4 — Diff ──
type PathDiff = {
  path: string
  before: Record<string, string>
  after: Record<string, string>
  fetchError?: string
}
const previews = ref<PathDiff[]>([])
const previewLoading = ref(false)
const showConfirmAll = ref(false)

// ── Step 5 — Results ──
const applyResults = ref<{ path: string; ok: boolean; error?: string }[]>([])

// ── Path helpers ──
const seg = (p: string, i: number) => p.split('/')[i] ?? ''
const depth = (p: string) => p.split('/').length

const PROD_NAMES = new Set(['prod', 'production', 'prd'])
const isProd = (env: string) => PROD_NAMES.has(env.toLowerCase())

function isRelated(project: string, nsLabel: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[-_]/g, '')
  return n(project).includes(n(nsLabel)) || n(nsLabel).includes(n(project))
}

// ── Step 2 computed ──
const projectSegments = computed(() =>
  [...new Set(allPaths.value.map(p => seg(p, 0)).filter(Boolean))].sort()
)
const suggestedProjects = computed(() =>
  projectSegments.value.filter(p => isRelated(p, vault.currentNamespaceLabel))
)
const otherProjects = computed(() =>
  projectSegments.value.filter(p => !isRelated(p, vault.currentNamespaceLabel))
)
const pathsPerProject = computed(() => {
  const map: Record<string, number> = {}
  for (const p of allPaths.value) { const s = seg(p, 0); if (s) map[s] = (map[s] ?? 0) + 1 }
  return map
})

// ── Step 3 computed ──
const availableBUs = computed(() =>
  [...new Set(
    allPaths.value
      .filter(p => selectedProjects.value.includes(seg(p, 0)) && seg(p, 1))
      .map(p => seg(p, 1)),
  )].sort()
)

const availableEnvs = computed(() =>
  [...new Set(
    allPaths.value
      .filter(p =>
        selectedProjects.value.includes(seg(p, 0)) &&
        selectedBUs.value.includes(seg(p, 1)) &&
        seg(p, 2),
      )
      .map(p => seg(p, 2)),
  )].sort()
)

const pathsPerBU = computed(() => {
  const map: Record<string, number> = {}
  for (const p of allPaths.value) {
    if (!selectedProjects.value.includes(seg(p, 0))) continue
    const b = seg(p, 1); if (b) map[b] = (map[b] ?? 0) + 1
  }
  return map
})

const pathsPerEnv = computed(() => {
  const map: Record<string, number> = {}
  for (const p of allPaths.value) {
    if (!selectedProjects.value.includes(seg(p, 0))) continue
    if (!selectedBUs.value.includes(seg(p, 1))) continue
    const e = seg(p, 2); if (e) map[e] = (map[e] ?? 0) + 1
  }
  return map
})

const targetPaths = computed(() =>
  allPaths.value.filter(p => {
    if (!selectedProjects.value.includes(seg(p, 0))) return false
    if (!selectedBUs.value.includes(seg(p, 1))) return false
    if (!selectedEnvs.value.includes(seg(p, 2))) return false
    if (!includeSubPaths.value && depth(p) > 3) return false
    return true
  })
)

// ── Step 4 computed ──
const previewsByGroup = computed(() => {
  const groups: Record<string, PathDiff[]> = {}
  for (const p of previews.value) {
    const group = [seg(p.path, 0), seg(p.path, 1), seg(p.path, 2)].filter(Boolean).join('/')
    if (!groups[group]) groups[group] = []
    groups[group].push(p)
  }
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
})

const totalPathsChanged = computed(() =>
  previews.value.filter(p => {
    const key = ffKey.value.trim()
    return String(getNestedValue(p.before, key) ?? '') !== String(getNestedValue(p.after, key) ?? '')
  }).length
)

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

// ── Step 5 computed ──
const applyOkCount = computed(() => applyResults.value.filter(r => r.ok).length)
const applyErrCount = computed(() => applyResults.value.filter(r => !r.ok).length)

// ── Value resolution (uses seg[2] = actual env, not BU) ──
function getEffectiveValue(path: string): string {
  const env = seg(path, 2)
  if (activeProdMode.value) return isProd(env) ? ffProdValue.value : ffValue.value
  if (perEnvValues.value) return envValueMap.value[env] ?? ffValue.value
  return ffValue.value
}

// ── Validation ──
const step1Valid = computed(() => ffKey.value.trim().length > 0)
const step2Valid = computed(() => selectedProjects.value.length > 0)
const step3Valid = computed(() => selectedBUs.value.length > 0 && selectedEnvs.value.length > 0 && targetPaths.value.length > 0)

// ── Watchers ──
watch(availableBUs, (bus) => { selectedBUs.value = [...bus] })

watch(availableEnvs, (envs) => {
  selectedEnvs.value = envs.filter(e => !isProd(e))
  for (const e of envs) { if (!(e in envValueMap.value)) envValueMap.value[e] = ffValue.value }
})

watch(ffValue, (val) => {
  for (const e of availableEnvs.value) envValueMap.value[e] = val
})

watch(ffValueType, (type) => {
  if (type === 'boolean') { ffValue.value = 'true'; ffProdValue.value = 'false' }
  else if (type === 'number') { ffValue.value = '1'; ffProdValue.value = '0' }
  else { ffValue.value = 'enabled'; ffProdValue.value = 'disabled' }
})

watch(activeProdMode, (on) => { if (on) perEnvValues.value = false })
watch(perEnvValues, (on) => { if (on) activeProdMode.value = false })

// ── Lifecycle ──
onMounted(loadPaths)

// ── Actions ──
async function loadPaths() {
  loadingPaths.value = true
  loadError.value = null
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    const payload = await res.json()
    const data = payload?.data ?? payload
    allPaths.value = typeof data === 'object' && data !== null ? Object.keys(data).sort() : []
    const sug = suggestedProjects.value
    selectedProjects.value = sug.length > 0 ? [...sug] : [...projectSegments.value]
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : t('featureFlagModal.step5Errors')
  } finally {
    loadingPaths.value = false
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

async function buildPreviews() {
  previewLoading.value = true
  previews.value = []
  const results: PathDiff[] = []
  const key = ffKey.value.trim()
  for (const path of targetPaths.value) {
    const val = getEffectiveValue(path)
    try {
      const params = new URLSearchParams({ path, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/read?${params}`)
      if (res.ok) {
        const json = await res.json()
        const rawBefore: Record<string, unknown> = json.data ?? {}
        const before = toStringRecord(rawBefore)
        const after = setNestedValue(rawBefore, key, val)
        results.push({ path, before, after })
      } else if (res.status === 404) {
        results.push({ path, before: {}, after: setNestedValue({}, key, val) })
      } else {
        const err = await res.json().catch(() => ({}))
        results.push({ path, before: {}, after: setNestedValue({}, key, val), fetchError: (err as { error?: string }).error ?? `HTTP ${res.status}` })
      }
    } catch (e: unknown) {
      results.push({ path, before: {}, after: setNestedValue({}, key, val), fetchError: e instanceof Error ? e.message : t('featureFlagModal.step5Errors') })
    }
  }
  previews.value = results
  previewLoading.value = false
  step.value = 4
}

async function applyAll() {
  showConfirmAll.value = false
  applyResults.value = []
  for (const preview of previews.value) {
    try {
      await vault.writeSecret(preview.path, preview.after)
      applyResults.value.push({ path: preview.path, ok: true })
    } catch (e: unknown) {
      applyResults.value.push({ path: preview.path, ok: false, error: e instanceof Error ? e.message : t('featureFlagModal.step5Errors') })
    }
  }
  step.value = 5
}

const STEP_LABELS = computed<Record<number, string>>(() => ({
  1: t('featureFlagModal.step1'),
  2: t('featureFlagModal.step2'),
  3: t('featureFlagModal.step3'),
  4: t('featureFlagModal.step4'),
  5: t('featureFlagModal.step5'),
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
          <span class="text-white font-semibold text-sm light:text-gray-900">{{ t('featureFlagModal.title') }}</span>
          <span class="text-gray-600 text-xs">·</span>
          <span class="text-gray-500 text-xs">{{ t('featureFlagModal.mount') }} <span class="text-green-400">{{ vault.currentMount }}</span></span>
        </div>
        <!-- Step indicator -->
        <div class="flex items-center gap-1">
          <template v-for="s in [1,2,3,4,5]" :key="s">
            <div
              class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
              :class="step === s ? 'bg-green-700 text-white' : s < step ? 'bg-gray-700 text-gray-300 light:bg-gray-200 light:text-gray-700' : 'text-gray-600 light:text-gray-400'"
            >
              <span>{{ s }}</span>
              <span class="hidden sm:inline">{{ STEP_LABELS[s] }}</span>
            </div>
            <span v-if="s < 5" class="text-gray-700 text-xs">›</span>
          </template>
        </div>
        <button class="text-gray-500 hover:text-gray-300 ml-3 shrink-0 light:hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <!-- Body -->
      <div class="overflow-auto flex-1 px-5 py-4">

        <!-- ── STEP 1 — Définir la feature flag ── -->
        <div v-if="step === 1" class="space-y-5">
          <p class="text-gray-400 text-sm light:text-gray-600">{{ t('featureFlagModal.step1Desc') }}</p>

          <div>
            <label class="text-gray-400 text-xs block mb-1.5 light:text-gray-600">{{ t('featureFlagModal.keyLabel') }}</label>
            <input
              v-model="ffKey"
              type="text"
              placeholder="FF_OPEN_MODAL or configuration.service.enabled"
              class="w-full px-3 py-2 bg-gray-950 border border-gray-700 text-green-300 font-mono rounded text-sm focus:outline-none focus:border-green-600 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-green-700 light:placeholder-gray-400"
              spellcheck="false"
            />
            <!-- Nested path hint -->
            <div v-if="ffKey.trim().includes('.')" class="mt-1.5 flex items-center gap-1 text-xs font-mono text-gray-500 light:text-gray-500">
              <span class="text-gray-600">↳</span>
              <template v-for="(part, i) in ffKey.trim().split('.')" :key="i">
                <span :class="i === ffKey.trim().split('.').length - 1 ? 'text-green-400 font-semibold' : 'text-blue-400'">{{ part }}</span>
                <span v-if="i < ffKey.trim().split('.').length - 1" class="text-gray-600">.</span>
              </template>
              <span class="text-gray-600 ml-1">({{ t('featureFlagModal.nestedPath') }})</span>
            </div>
          </div>

          <div>
            <label class="text-gray-400 text-xs block mb-1.5 light:text-gray-600">{{ t('featureFlagModal.valueTypeLabel') }}</label>
            <div class="flex gap-2 mb-3">
              <button
                v-for="t in ['boolean', 'string', 'number'] as const"
                :key="t"
                type="button"
                class="px-3 py-1 rounded border text-xs font-semibold transition"
                :class="ffValueType === t ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 light:bg-gray-100 light:text-gray-700 light:border-gray-300 light:hover:bg-gray-200'"
                @click="ffValueType = t"
              >{{ t }}</button>
            </div>

            <div v-if="ffValueType === 'boolean'" class="flex gap-2">
              <button type="button" class="px-4 py-1.5 rounded border text-xs font-bold transition"
                :class="ffValue === 'true' ? 'bg-green-700 text-white border-green-500' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'"
                @click="ffValue = 'true'">true</button>
              <button type="button" class="px-4 py-1.5 rounded border text-xs font-bold transition"
                :class="ffValue === 'false' ? 'bg-red-800 text-white border-red-600' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'"
                @click="ffValue = 'false'">false</button>
            </div>
            <input v-else v-model="ffValue" :type="ffValueType === 'number' ? 'number' : 'text'"
              class="w-full px-3 py-2 bg-gray-950 border border-gray-700 text-green-300 font-mono rounded text-sm focus:outline-none focus:border-green-600"
              spellcheck="false" />
          </div>

          <div v-if="ffKey.trim()" class="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs font-mono light:bg-gray-100 light:border-gray-200">
            <span class="text-gray-400 light:text-gray-600">{{ ffKey }}</span>
            <span class="text-gray-600">=</span>
            <span class="text-green-300 light:text-green-700">{{ ffValue }}</span>
          </div>
        </div>

        <!-- ── STEP 2 — Projets ── -->
        <div v-else-if="step === 2" class="space-y-4">
          <div class="flex items-center justify-between">
            <p class="text-gray-400 text-sm light:text-gray-600">{{ t('featureFlagModal.step2Desc') }}</p>
            <div class="flex gap-2">
              <button class="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedProjects = [...projectSegments]">{{ t('featureFlagModal.all') }}</button>
              <button class="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedProjects = []">{{ t('featureFlagModal.none') }}</button>
            </div>
          </div>

          <div v-if="loadingPaths" class="flex flex-col items-center py-10 gap-3">
            <div class="w-10 h-10 border-2 border-gray-700 border-t-green-400 rounded-full animate-spin light:border-gray-200 light:border-t-green-500"></div>
            <p class="text-gray-400 text-sm light:text-gray-600">{{ t('featureFlagModal.scanningMount') }}</p>
          </div>
          <div v-else-if="loadError" class="text-red-400 text-sm px-3 py-2 bg-red-950 border border-red-800 rounded">⚠ {{ loadError }}</div>

          <template v-else>
            <div v-if="suggestedProjects.length > 0">
              <div class="text-gray-500 text-xs mb-2 uppercase tracking-wider">{{ t('featureFlagModal.suggested') }} {{ vault.currentNamespaceLabel }}</div>
              <div class="space-y-1">
                <div
                  v-for="proj in suggestedProjects" :key="proj"
                  class="flex items-center gap-3 px-3 py-2 rounded border cursor-pointer transition select-none"
                  :class="selectedProjects.includes(proj) ? 'bg-indigo-950 border-indigo-700' : 'bg-gray-800 border-gray-700 hover:border-gray-600 light:bg-gray-50 light:border-gray-200 light:hover:border-gray-300'"
                  @click="toggleProject(proj)"
                >
                  <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs"
                    :class="selectedProjects.includes(proj) ? 'bg-indigo-500 border-indigo-400' : 'border-gray-600 light:border-gray-400'">
                    <span v-if="selectedProjects.includes(proj)">✓</span>
                  </span>
                  <span class="font-mono text-xs flex-1" :class="selectedProjects.includes(proj) ? 'text-indigo-200' : 'text-gray-300 light:text-gray-700'">{{ proj }}</span>
                  <span class="text-gray-500 text-xs">{{ pathsPerProject[proj] ?? 0 }} paths</span>
                </div>
              </div>
            </div>

            <div v-if="otherProjects.length > 0">
              <div class="text-gray-500 text-xs mb-2 mt-3 uppercase tracking-wider">{{ t('featureFlagModal.otherProjects') }}</div>
              <div class="space-y-1">
                <div
                  v-for="proj in otherProjects" :key="proj"
                  class="flex items-center gap-3 px-3 py-2 rounded border cursor-pointer transition select-none"
                  :class="selectedProjects.includes(proj) ? 'bg-gray-700 border-gray-500' : 'bg-gray-800 border-gray-700 hover:border-gray-600 light:bg-gray-50 light:border-gray-200 light:hover:border-gray-300'"
                  @click="toggleProject(proj)"
                >
                  <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs"
                    :class="selectedProjects.includes(proj) ? 'bg-gray-500 border-gray-400' : 'border-gray-600 light:border-gray-400'">
                    <span v-if="selectedProjects.includes(proj)">✓</span>
                  </span>
                  <span class="font-mono text-xs flex-1" :class="selectedProjects.includes(proj) ? 'text-gray-100' : 'text-gray-400 light:text-gray-600'">{{ proj }}</span>
                  <span class="text-gray-600 text-xs">{{ pathsPerProject[proj] ?? 0 }} paths</span>
                </div>
              </div>
            </div>

            <div v-if="projectSegments.length === 0" class="text-gray-500 text-sm text-center py-8">{{ t('featureFlagModal.noProjects') }}</div>

            <div class="text-gray-600 text-xs pt-2 border-t border-gray-800 light:border-gray-200 light:text-gray-500">
              {{ t('featureFlagModal.projectCount', { n: selectedProjects.length, paths: allPaths.filter(p => selectedProjects.includes(seg(p, 0))).length }) }}
            </div>
          </template>
        </div>

        <!-- ── STEP 3 — BU & Environnements ── -->
        <div v-else-if="step === 3" class="space-y-5">

          <!-- BU selection -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-gray-400 text-xs uppercase tracking-wider font-semibold light:text-gray-600">{{ t('featureFlagModal.step3BU') }}</label>
              <div class="flex gap-1.5">
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedBUs = [...availableBUs]">{{ t('featureFlagModal.allEnvs') }}</button>
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="selectedBUs = []">{{ t('featureFlagModal.none') }}</button>
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <div
                v-for="bu in availableBUs" :key="bu"
                class="flex items-center gap-2 px-3 py-1.5 rounded border cursor-pointer text-xs font-mono transition select-none"
                :class="selectedBUs.includes(bu) ? 'bg-blue-950 border-blue-700 text-blue-200' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'"
                @click="toggleBU(bu)"
              >
                <span class="w-3.5 h-3.5 rounded border flex items-center justify-center text-white shrink-0" style="font-size:9px"
                  :class="selectedBUs.includes(bu) ? 'bg-blue-500 border-blue-400' : 'border-gray-600'">
                  <span v-if="selectedBUs.includes(bu)">✓</span>
                </span>
                {{ bu }}
                <span class="opacity-60">{{ pathsPerBU[bu] ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- Env selection -->
          <div>
            <div class="flex items-center gap-3 mb-2 flex-wrap">
              <label class="text-gray-400 text-xs uppercase tracking-wider font-semibold light:text-gray-600">{{ t('featureFlagModal.step3Envs') }}</label>
              <!-- Quick-select presets -->
              <div class="flex gap-1.5 ml-auto">
                <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded light:bg-gray-100 light:hover:bg-gray-200 light:text-gray-700 light:border-gray-300" @click="quickSelectEnvs('all')">{{ t('featureFlagModal.allEnvs') }}</button>
                <button class="text-xs px-2 py-0.5 bg-emerald-900 hover:bg-emerald-800 text-emerald-300 border border-emerald-800 rounded" @click="quickSelectEnvs('no-prod')">{{ t('featureFlagModal.noProdsLabel') }}</button>
                <button class="text-xs px-2 py-0.5 bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 rounded" @click="quickSelectEnvs('prod-only')">{{ t('featureFlagModal.prodOnlyLabel') }}</button>
              </div>
            </div>

            <div v-if="availableEnvs.length === 0" class="text-gray-600 text-xs light:text-gray-500">
              {{ t('featureFlagModal.noBUSelected') }}
            </div>
            <div v-else class="flex flex-wrap gap-2">
              <div
                v-for="env in availableEnvs" :key="env"
                class="flex items-center gap-2 px-3 py-1.5 rounded border cursor-pointer text-xs font-mono font-semibold transition select-none"
                :class="selectedEnvs.includes(env)
                  ? isProd(env)
                    ? 'bg-red-950 border-red-600 text-red-200'
                    : 'bg-emerald-950 border-emerald-600 text-emerald-200'
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
                <span v-if="isProd(env)" class="text-red-500 opacity-80 font-normal">{{ t('featureFlagModal.prod') }}</span>
                <span class="opacity-50 font-normal">{{ pathsPerEnv[env] ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- Sub-paths toggle -->
          <div
            class="flex items-start gap-3 p-3 rounded border cursor-pointer transition"
            :class="includeSubPaths ? 'bg-amber-950 border-amber-800' : 'bg-gray-800 border-gray-700 hover:border-gray-600'"
            @click="includeSubPaths = !includeSubPaths"
          >
            <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 text-white text-xs"
              :class="includeSubPaths ? 'bg-amber-500 border-amber-400' : 'border-gray-600'">
              <span v-if="includeSubPaths">✓</span>
            </span>
            <div>
              <div class="text-xs font-semibold" :class="includeSubPaths ? 'text-amber-200' : 'text-gray-300'">
                {{ t('featureFlagModal.includeSubPaths') }}
              </div>
              <div class="text-xs text-gray-500 mt-0.5">
                {{ t('featureFlagModal.includeSubPathsDesc') }}
              </div>
            </div>
          </div>

          <!-- Value options -->
          <div class="space-y-3">
            <!-- Option A: prod disabled mode -->
            <div
              class="flex items-start gap-3 p-3 rounded border cursor-pointer transition"
              :class="activeProdMode ? 'bg-orange-950 border-orange-700' : 'bg-gray-800 border-gray-700 hover:border-gray-600'"
              @click="activeProdMode = !activeProdMode"
            >
              <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 text-white text-xs"
                :class="activeProdMode ? 'bg-orange-500 border-orange-400' : 'border-gray-600'">
                <span v-if="activeProdMode">✓</span>
              </span>
              <div class="flex-1">
                <div class="text-xs font-semibold" :class="activeProdMode ? 'text-orange-200' : 'text-gray-300'">
                  {{ t('featureFlagModal.diffProdMode') }}
                </div>
                <div class="text-xs text-gray-500 mt-0.5">{{ t('featureFlagModal.diffProdModeDesc') }}</div>
              </div>
            </div>

            <!-- Prod value inputs -->
            <div v-if="activeProdMode" class="ml-7 flex gap-4 p-3 bg-gray-800 border border-gray-700 rounded" @click.stop>
              <div class="flex-1">
                <label class="text-gray-400 text-xs block mb-1">{{ t('featureFlagModal.nonProdValue') }}</label>
                <div v-if="ffValueType === 'boolean'" class="flex gap-2">
                  <button type="button" class="px-3 py-1 rounded border text-xs font-bold"
                    :class="ffValue === 'true' ? 'bg-green-700 text-white border-green-500' : 'bg-gray-700 text-gray-400 border-gray-600'"
                    @click="ffValue = 'true'">true</button>
                  <button type="button" class="px-3 py-1 rounded border text-xs font-bold"
                    :class="ffValue === 'false' ? 'bg-red-800 text-white border-red-600' : 'bg-gray-700 text-gray-400 border-gray-600'"
                    @click="ffValue = 'false'">false</button>
                </div>
                <input v-else v-model="ffValue" class="px-2 py-1 bg-gray-950 border border-gray-700 text-green-300 font-mono rounded text-xs w-full" />
              </div>
              <div class="flex-1">
                <label class="text-amber-400 text-xs block mb-1">{{ t('featureFlagModal.prodValue') }}</label>
                <div v-if="ffValueType === 'boolean'" class="flex gap-2">
                  <button type="button" class="px-3 py-1 rounded border text-xs font-bold"
                    :class="ffProdValue === 'true' ? 'bg-green-700 text-white border-green-500' : 'bg-gray-700 text-gray-400 border-gray-600'"
                    @click="ffProdValue = 'true'">true</button>
                  <button type="button" class="px-3 py-1 rounded border text-xs font-bold"
                    :class="ffProdValue === 'false' ? 'bg-red-800 text-white border-red-600' : 'bg-gray-700 text-gray-400 border-gray-600'"
                    @click="ffProdValue = 'false'">false</button>
                </div>
                <input v-else v-model="ffProdValue" class="px-2 py-1 bg-gray-950 border border-gray-700 text-amber-300 font-mono rounded text-xs w-full" />
              </div>
            </div>

            <!-- Option B: per-env values -->
            <div
              v-if="!activeProdMode"
              class="flex items-start gap-3 p-3 rounded border cursor-pointer transition"
              :class="perEnvValues ? 'bg-violet-950 border-violet-700' : 'bg-gray-800 border-gray-700 hover:border-gray-600'"
              @click="perEnvValues = !perEnvValues"
            >
              <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 text-white text-xs"
                :class="perEnvValues ? 'bg-violet-500 border-violet-400' : 'border-gray-600'">
                <span v-if="perEnvValues">✓</span>
              </span>
              <div>
                <div class="text-xs font-semibold" :class="perEnvValues ? 'text-violet-200' : 'text-gray-300'">{{ t('featureFlagModal.perEnvValues') }}</div>
                <div class="text-xs text-gray-500 mt-0.5">{{ t('featureFlagModal.perEnvValuesDesc') }}</div>
              </div>
            </div>

            <div v-if="perEnvValues && !activeProdMode" class="ml-7 space-y-2 p-3 bg-gray-800 border border-gray-700 rounded" @click.stop>
              <div v-for="env in selectedEnvs" :key="env" class="flex items-center gap-3">
                <span class="font-mono text-xs w-20 shrink-0" :class="isProd(env) ? 'text-red-300' : 'text-green-300'">{{ env }}</span>
                <span v-if="isProd(env)" class="text-red-500 text-xs shrink-0">{{ t('featureFlagModal.prod') }}</span>
                <div v-if="ffValueType === 'boolean'" class="flex gap-2" @click.stop>
                  <button type="button" class="px-2 py-0.5 rounded border text-xs font-bold"
                    :class="(envValueMap[env] ?? ffValue) === 'true' ? 'bg-green-700 text-white border-green-500' : 'bg-gray-700 text-gray-400 border-gray-600'"
                    @click="envValueMap[env] = 'true'">true</button>
                  <button type="button" class="px-2 py-0.5 rounded border text-xs font-bold"
                    :class="(envValueMap[env] ?? ffValue) === 'false' ? 'bg-red-800 text-white border-red-600' : 'bg-gray-700 text-gray-400 border-gray-600'"
                    @click="envValueMap[env] = 'false'">false</button>
                </div>
                <input v-else v-model="envValueMap[env]"
                  class="flex-1 px-2 py-0.5 bg-gray-950 border border-gray-700 text-green-300 font-mono rounded text-xs focus:outline-none focus:border-green-600"
                  @click.stop />
              </div>
            </div>
          </div>

          <!-- Summary -->
          <div class="p-3 bg-gray-800 border border-gray-700 rounded text-xs space-y-1.5 light:bg-gray-100 light:border-gray-200">
            <div class="text-gray-300 font-semibold mb-1 light:text-gray-800">{{ t('featureFlagModal.summary') }}</div>
            <div class="text-gray-400 light:text-gray-600">{{ t('featureFlagModal.summaryProjects') }} <span class="text-white font-mono light:text-gray-900">{{ selectedProjects.join(', ') || '—' }}</span></div>
            <div class="text-gray-400 light:text-gray-600">{{ t('featureFlagModal.summaryBUs') }} <span class="text-blue-300 font-mono">{{ selectedBUs.join(', ') || '—' }}</span></div>
            <div class="text-gray-400 light:text-gray-600">{{ t('featureFlagModal.summaryEnvs') }} <span class="font-mono">
              <span v-for="(e, i) in selectedEnvs" :key="e">
                <span :class="isProd(e) ? 'text-red-300' : 'text-emerald-300'">{{ e }}</span>
                <span v-if="i < selectedEnvs.length - 1" class="text-gray-600">, </span>
              </span>
              <span v-if="!selectedEnvs.length" class="text-gray-600">—</span>
            </span></div>
            <div class="text-gray-400 light:text-gray-600">{{ t('featureFlagModal.summarySubPaths') }} <span :class="includeSubPaths ? 'text-amber-300' : 'text-gray-300 light:text-gray-700'">{{ includeSubPaths ? t('featureFlagModal.included') : t('featureFlagModal.excluded') }}</span></div>
            <div class="text-gray-400 light:text-gray-600">
              {{ t('featureFlagModal.summaryKey') }} <span class="font-mono text-green-300">{{ ffKey }}</span> =
              <template v-if="activeProdMode">
                <span class="text-emerald-300">{{ ffValue }}</span>{{ t('featureFlagModal.summaryProdMode') }}
                <span class="text-amber-300">{{ ffProdValue }}</span>
              </template>
              <template v-else-if="perEnvValues">
                <span class="text-violet-300">{{ t('featureFlagModal.summaryPerEnv') }}</span>
              </template>
              <template v-else>
                <span class="text-green-300">{{ ffValue }}</span>
              </template>
            </div>
            <div class="pt-1 border-t border-gray-700 light:border-gray-300">
              {{ t('featureFlagModal.targetedPaths') }} <span class="text-green-400 font-bold text-sm">{{ targetPaths.length }}</span>
            </div>
            <div v-if="!step3Valid && selectedBUs.length > 0" class="text-amber-400">{{ t('featureFlagModal.noPathsWarning') }}</div>
          </div>
        </div>

        <!-- ── STEP 4 — Diff ── -->
        <div v-else-if="step === 4" class="space-y-4">
          <div v-if="previewLoading" class="flex flex-col items-center py-10 gap-3">
            <div class="w-10 h-10 border-2 border-gray-700 border-t-green-400 rounded-full animate-spin light:border-gray-200 light:border-t-green-500"></div>
            <p class="text-gray-400 text-sm light:text-gray-600">{{ t('featureFlagModal.loadingDiffs') }}</p>
            <p class="text-gray-600 text-xs light:text-gray-500">{{ previews.length }} / {{ targetPaths.length }} paths</p>
          </div>

          <template v-else>
            <div class="flex items-center justify-between flex-wrap gap-2">
              <span class="text-gray-400 text-sm light:text-gray-600">
                {{ t('featureFlagModal.step4PathsModified', { paths: previews.length, modified: totalPathsChanged }) }}
              </span>
              <div class="flex gap-2">
                <button class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700" @click="step = 3">{{ t('featureFlagModal.adjust') }}</button>
                <button
                  class="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded font-semibold disabled:opacity-40"
                  :disabled="totalPathsChanged === 0"
                  @click="showConfirmAll = true"
                >{{ t('featureFlagModal.applyAll', { n: totalPathsChanged }) }}</button>
              </div>
            </div>

            <div v-for="([group, entries]) in previewsByGroup" :key="group" class="border border-gray-700 rounded light:border-gray-200">
              <!-- Group header: project / BU / env -->
              <div class="px-4 py-2 bg-gray-800 rounded-t flex items-center gap-1.5 text-xs font-mono flex-wrap light:bg-gray-100">
                <span class="text-purple-300 font-semibold">{{ group.split('/')[0] }}</span>
                <span class="text-gray-600">/</span>
                <span class="text-blue-300 font-semibold">{{ group.split('/')[1] }}</span>
                <span class="text-gray-600">/</span>
                <span class="font-semibold" :class="isProd(group.split('/')[2] ?? '') ? 'text-red-300' : 'text-emerald-300'">{{ group.split('/')[2] }}</span>
                <span v-if="isProd(group.split('/')[2] ?? '')" class="text-red-500 text-xs">(prod)</span>
                <span class="ml-auto text-gray-500">{{ entries.length }} path(s)</span>
              </div>

              <div v-for="entry in entries" :key="entry.path" class="border-t border-gray-800 first:border-0 light:border-gray-200">
                <div class="px-4 py-1 flex items-center gap-2">
                  <span class="font-mono text-xs text-gray-400 light:text-gray-600">{{ entry.path }}</span>
                  <span v-if="depth(entry.path) > 3" class="text-amber-600 text-xs ml-1">{{ t('featureFlagModal.subPath') }}</span>
                  <span v-if="entry.fetchError" class="text-red-400 text-xs ml-auto">⚠ {{ entry.fetchError }}</span>
                </div>
                <table class="w-full text-xs font-mono">
                  <tbody>
                    <tr
                      class="border-t border-gray-800 light:border-gray-200"
                      :class="{
                        'text-green-300 bg-green-950': getNestedValue(entry.before, ffKey.trim()) === undefined,
                        'text-yellow-200 bg-yellow-950': getNestedValue(entry.before, ffKey.trim()) !== undefined && String(getNestedValue(entry.before, ffKey.trim()) ?? '') !== String(getNestedValue(entry.after, ffKey.trim()) ?? ''),
                        'text-gray-500': getNestedValue(entry.before, ffKey.trim()) !== undefined && String(getNestedValue(entry.before, ffKey.trim()) ?? '') === String(getNestedValue(entry.after, ffKey.trim()) ?? ''),
                      }"
                    >
                      <td class="px-4 py-1 w-1/3">{{ ffKey }}</td>
                      <td class="px-2 py-1 w-1/3 opacity-60 line-through">{{ String(getNestedValue(entry.before, ffKey.trim()) ?? '') }}</td>
                      <td class="px-2 py-1 w-1/3 font-bold">{{ String(getNestedValue(entry.after, ffKey.trim()) ?? '') }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-if="totalPathsChanged === 0" class="text-gray-500 text-sm text-center py-4">
              <span class="font-mono text-gray-300 light:text-gray-700">{{ ffKey }}</span>{{ t('featureFlagModal.alreadyCorrect') }}
            </div>
          </template>
        </div>

        <!-- ── STEP 5 — Résultat ── -->
        <div v-else-if="step === 5" class="space-y-4">
          <div class="flex flex-col items-center py-10 gap-4">
            <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2"
              :class="applyErrCount === 0 ? 'border-green-500 bg-green-950 text-green-400' : 'border-amber-500 bg-amber-950 text-amber-400'">
              {{ applyErrCount === 0 ? '✓' : '⚠' }}
            </div>
            <div class="text-center">
              <div class="text-white font-semibold text-base mb-1 light:text-gray-900">
                {{ applyErrCount === 0 ? t('featureFlagModal.step5Success') : t('featureFlagModal.step5Errors') }}
              </div>
              <div class="text-gray-400 text-sm light:text-gray-600">
                <span class="text-green-400 font-bold">{{ applyOkCount }}</span> {{ t('featureFlagModal.pathsUpdated', { n: applyOkCount }) }}
                <template v-if="applyErrCount > 0"> · <span class="text-red-400 font-bold">{{ applyErrCount }}</span> {{ t('featureFlagModal.errors', { n: applyErrCount }) }}</template>
              </div>
              <div class="mt-1 text-gray-500 text-xs font-mono light:text-gray-600">
                {{ ffKey }} = {{ ffValue }}<template v-if="activeProdMode">{{ t('featureFlagModal.prodValueSuffix') }} {{ ffProdValue }}</template>
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
            <summary class="cursor-pointer hover:text-gray-400 transition light:hover:text-gray-600">{{ t('featureFlagModal.successPathsUpdated', { n: applyOkCount }) }}</summary>
            <div class="mt-2 space-y-0.5 font-mono">
              <div v-for="r in applyResults.filter(r => r.ok)" :key="r.path" class="text-green-700">✓ {{ r.path }}</div>
            </div>
          </details>
        </div>

      </div><!-- end body -->

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-gray-700 flex items-center justify-between shrink-0 light:border-gray-200">
        <button
          v-if="step > 1 && step < 5"
          class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-40 light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700"
          :disabled="previewLoading"
          @click="step = (step - 1) as Step"
        >{{ t('featureFlagModal.back') }}</button>
        <div v-else></div>

        <div class="flex gap-2">
          <button v-if="step === 5" class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded light:bg-gray-200 light:hover:bg-gray-300 light:text-gray-700" @click="emit('close')">{{ t('featureFlagModal.close') }}</button>

          <button v-if="step === 1"
            class="text-sm px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="!step1Valid" @click="step = 2">{{ t('featureFlagModal.nextProjects') }}</button>

          <button v-else-if="step === 2"
            class="text-sm px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="!step2Valid || loadingPaths" @click="step = 3">{{ t('featureFlagModal.nextBU') }}</button>

          <button v-else-if="step === 3"
            class="text-sm px-4 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="!step3Valid" @click="buildPreviews">{{ t('featureFlagModal.loadDiffs') }}</button>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDiffModal
    v-if="showConfirmAll"
    :path="t('featureFlagModal.step4PathsModified', { paths: previews.length, modified: totalPathsChanged })"
    :before="confirmAllBefore"
    :after="confirmAllAfter"
    @confirm="applyAll"
    @cancel="showConfirmAll = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'

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

// ── Step 1 — Scan + new key name input ──
const oldKeyName = ref('')
const newKeyName = ref('')
const scanning = ref(false)
const scanError = ref<string | null>(null)
const scanned = ref(false)
const dumpData = ref<Record<string, Record<string, string>>>({})

const matchingPaths = computed(() =>
  Object.keys(dumpData.value)
    .filter(p => {
      if (!(oldKeyName.value.trim() in dumpData.value[p])) return false
      if (!includeProd.value && pathIsProd(p)) return false
      return true
    })
    .sort()
)

const selectedPaths = ref<Set<string>>(new Set())

watch(matchingPaths, paths => {
  selectedPaths.value = new Set(paths)
})

function togglePath(path: string) {
  if (selectedPaths.value.has(path)) selectedPaths.value.delete(path)
  else selectedPaths.value.add(path)
  selectedPaths.value = new Set(selectedPaths.value)
}
function selectAll() { selectedPaths.value = new Set(matchingPaths.value) }
function selectNone() { selectedPaths.value = new Set() }

// Paths where the new key already exists (will be overwritten — warn)
function newKeyConflicts(path: string): boolean {
  return newKeyName.value.trim().length > 0 && newKeyName.value.trim() in (dumpData.value[path] ?? {})
}

// ── Step 2 — Diff ──
type PathDiff = { path: string; before: Record<string, string>; after: Record<string, string> }

const previews = computed<PathDiff[]>(() => {
  const ok = oldKeyName.value.trim()
  const nk = newKeyName.value.trim()
  if (!ok || !nk || ok === nk) return []
  return [...selectedPaths.value]
    .filter(p => matchingPaths.value.includes(p))
    .sort()
    .map(path => {
      const before = dumpData.value[path] ?? {}
      const after = { ...before }
      const value = after[ok] ?? ''
      delete after[ok]
      after[nk] = value
      return { path, before, after }
    })
})

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

// ── Step 3 — Results ──
const applyResults = ref<{ path: string; ok: boolean; error?: string }[]>([])
const applying = ref(false)
const applyOkCount = computed(() => applyResults.value.filter(r => r.ok).length)
const applyErrCount = computed(() => applyResults.value.filter(r => !r.ok).length)

// ── Validation ──
const step1Valid = computed(() =>
  scanned.value &&
  selectedPaths.value.size > 0 &&
  newKeyName.value.trim().length > 0 &&
  newKeyName.value.trim() !== oldKeyName.value.trim()
)

// ── Actions ──
async function scan() {
  if (!oldKeyName.value.trim()) return
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
    if (typeof raw !== 'object' || raw === null) throw new Error(t('keyRenameModal.invalidResponse'))
    dumpData.value = raw as Record<string, Record<string, string>>
    scanned.value = true
  } catch (e: unknown) {
    scanError.value = e instanceof Error ? e.message : t('keyRenameModal.networkError')
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
      await vault.writeSecret(preview.path, preview.after)
      applyResults.value.push({ path: preview.path, ok: true })
    } catch (e: unknown) {
      applyResults.value.push({ path: preview.path, ok: false, error: e instanceof Error ? e.message : t('keyRenameModal.networkError') })
    }
  }
  applying.value = false
  step.value = 3
}

const STEP_LABELS = computed<Record<number, string>>(() => ({
  1: t('keyRenameModal.step1'),
  2: t('keyRenameModal.step2'),
  3: t('keyRenameModal.step3'),
}))
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 light:bg-gray-50 border border-gray-700 light:border-gray-200 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 light:border-gray-200 shrink-0">
        <div class="flex items-center gap-3">
          <span class="text-white light:text-gray-900 font-semibold text-sm">{{ t('keyRenameModal.title') }}</span>
          <span class="text-gray-600 text-xs">·</span>
          <span class="text-gray-500 text-xs">{{ t('keyRenameModal.mount') }} <span class="text-green-400 light:text-green-700">{{ vault.currentMount }}</span></span>
        </div>
        <div class="flex items-center gap-1">
          <template v-for="s in [1, 2, 3]" :key="s">
            <div
              class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
              :class="step === s ? 'bg-orange-700 text-white' : s < step ? 'bg-gray-700 text-gray-300' : 'text-gray-600'"
            >
              <span>{{ s }}</span>
              <span class="hidden sm:inline">{{ STEP_LABELS[s] }}</span>
            </div>
            <span v-if="s < 3" class="text-gray-700 text-xs">›</span>
          </template>
        </div>
        <button class="text-gray-500 hover:text-gray-300 light:hover:text-gray-700 ml-3 shrink-0" @click="emit('close')">✕</button>
      </div>

      <!-- Body -->
      <div class="overflow-auto flex-1 px-5 py-4">

        <!-- ── STEP 1 — Scan + rename input ── -->
        <div v-if="step === 1" class="space-y-4">
          <p class="text-gray-400 light:text-gray-600 text-sm">
            {{ t('keyRenameModal.step1Desc') }}
          </p>

          <!-- Old → new key names -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-gray-400 light:text-gray-600 text-xs">{{ t('keyRenameModal.oldKeyLabel') }}</label>
                <button
                  class="px-2 py-0.5 rounded border text-xs font-mono font-semibold transition pointer"
                  :class="includeProd ? 'bg-red-900 border-red-700 text-red-200 light:bg-red-100 light:border-red-300 light:text-red-800' : 'bg-gray-800 light:bg-gray-100 border-gray-700 light:border-gray-200 text-gray-500 hover:border-gray-500'"
                  @click="includeProd = !includeProd"
                >{{ includeProd ? t('keyRenameModal.prodIncluded') : t('keyRenameModal.prodExcluded') }}</button>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="oldKeyName"
                  type="text"
                  placeholder="KOBI_WORKSPACE_DI"
                  class="flex-1 px-3 py-2 bg-gray-950 light:bg-white border border-red-900 light:border-red-300 text-red-300 light:text-red-700 font-mono rounded text-sm focus:outline-none focus:border-red-600 placeholder-gray-700 light:placeholder-gray-500"
                  spellcheck="false"
                  @keydown.enter="scan"
                />
                <button
                  class="px-3 py-2 bg-orange-700 hover:bg-orange-600 text-white rounded text-sm font-semibold disabled:opacity-40 transition shrink-0"
                  :disabled="!oldKeyName.trim() || scanning"
                  @click="scan"
                >{{ scanning ? t('keyRenameModal.scanning') : t('keyRenameModal.scan') }}</button>
              </div>
            </div>
            <div>
              <label class="text-gray-400 light:text-gray-600 text-xs block mb-1.5">{{ t('keyRenameModal.newKeyLabel') }}</label>
              <input
                v-model="newKeyName"
                type="text"
                placeholder="KOBI_WORKSPACE_ID"
                class="w-full px-3 py-2 bg-gray-950 light:bg-white border border-green-900 light:border-green-300 text-green-300 light:text-green-700 font-mono rounded text-sm focus:outline-none focus:border-green-600 placeholder-gray-700 light:placeholder-gray-500"
                :class="{ 'opacity-40': !scanned }"
                :disabled="!scanned"
                spellcheck="false"
              />
            </div>
          </div>

          <!-- Rename arrow preview -->
          <div
            v-if="oldKeyName.trim() && newKeyName.trim() && newKeyName.trim() !== oldKeyName.trim()"
            class="flex items-center gap-3 px-4 py-2 bg-gray-800 light:bg-gray-100 border border-gray-700 light:border-gray-200 rounded text-xs font-mono"
          >
            <span class="text-red-400 line-through">{{ oldKeyName.trim() }}</span>
            <span class="text-gray-500">→</span>
            <span class="text-green-400">{{ newKeyName.trim() }}</span>
            <span class="text-gray-600 ml-2">{{ t('keyRenameModal.valueKept') }}</span>
          </div>
          <div
            v-else-if="newKeyName.trim() && newKeyName.trim() === oldKeyName.trim()"
            class="text-amber-400 light:text-amber-700 text-xs"
          >
            {{ t('keyRenameModal.sameNameWarning') }}
          </div>

          <!-- Scanning -->
          <div v-if="scanning" class="flex flex-col items-center py-8 gap-3">
            <div class="w-10 h-10 border-2 border-gray-700 light:border-gray-200 border-t-orange-400 rounded-full animate-spin"></div>
            <p class="text-gray-400 light:text-gray-600 text-sm">{{ t('keyRenameModal.scanningMount') }}</p>
          </div>

          <!-- Error -->
          <div v-if="scanError" class="text-red-400 light:text-red-700 text-sm px-3 py-2 bg-red-950 light:bg-red-100 border border-red-800 light:border-red-300 rounded">⚠ {{ scanError }}</div>

          <!-- No results -->
          <div v-if="scanned && !scanning && matchingPaths.length === 0" class="p-4 bg-gray-800 light:bg-gray-100 border border-gray-700 light:border-gray-200 rounded text-center">
            <div class="text-gray-300 light:text-gray-700 font-semibold mb-1">{{ t('keyRenameModal.keyNotFound') }}</div>
            <div class="text-gray-500 text-xs font-mono">
              « {{ oldKeyName }} »{{ t('keyRenameModal.keyNotFoundDesc') }} <span class="text-green-400 light:text-green-700">{{ vault.currentMount }}</span>.
            </div>
          </div>

          <!-- Results -->
          <template v-if="scanned && !scanning && matchingPaths.length > 0">

            <!-- Found banner -->
            <div class="flex items-center gap-3 px-4 py-2.5 bg-orange-950 border border-orange-800 rounded">
              <span class="text-orange-400 shrink-0 text-base">🏷</span>
              <div>
                <span class="text-orange-200 font-semibold text-sm font-mono">{{ oldKeyName }}</span>
                <span class="text-orange-300 text-sm">{{ t('keyRenameModal.foundIn') }}
                  <span class="text-white font-bold">{{ matchingPaths.length }}</span> {{ t('keyRenameModal.secrets') }}
                </span>
                <div class="text-orange-500 text-xs mt-0.5">{{ Object.keys(dumpData).length }} {{ t('keyRenameModal.totalScanned') }}</div>
              </div>
            </div>

            <!-- Path list with checkboxes + current value display -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-gray-400 light:text-gray-600 text-xs">
                  {{ t('keyRenameModal.selectedPaths', { selected: selectedPaths.size, total: matchingPaths.length }) }}
                </span>
                <div class="flex gap-2">
                  <button class="text-xs px-2 py-0.5 bg-gray-800 light:bg-gray-100 hover:bg-gray-700 light:hover:bg-gray-200 text-gray-300 light:text-gray-700 border border-gray-700 light:border-gray-200 rounded" @click="selectAll">{{ t('keyRenameModal.all') }}</button>
                  <button class="text-xs px-2 py-0.5 bg-gray-800 light:bg-gray-100 hover:bg-gray-700 light:hover:bg-gray-200 text-gray-300 light:text-gray-700 border border-gray-700 light:border-gray-200 rounded" @click="selectNone">{{ t('keyRenameModal.none') }}</button>
                </div>
              </div>

              <div class="border border-gray-700 light:border-gray-200 rounded divide-y divide-gray-800 light:divide-gray-200">
                <div
                  v-for="path in matchingPaths"
                  :key="path"
                  class="flex items-center gap-3 px-3 py-2 cursor-pointer transition select-none"
                  :class="selectedPaths.has(path) ? 'hover:bg-gray-800 light:hover:bg-gray-100' : 'opacity-35'"
                  @click="togglePath(path)"
                >
                  <!-- Checkbox -->
                  <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs transition"
                    :class="selectedPaths.has(path) ? 'bg-orange-500 border-orange-400' : 'border-gray-600 light:border-gray-300 bg-gray-800 light:bg-gray-100'">
                    <span v-if="selectedPaths.has(path)">✓</span>
                  </span>

                  <!-- Path -->
                  <span class="font-mono text-xs text-gray-300 light:text-gray-700 shrink-0 min-w-0 truncate" style="max-width:220px" :title="path">
                    {{ path }}
                  </span>

                  <!-- Key rename preview -->
                  <div class="flex items-center gap-1.5 flex-1 min-w-0 text-xs font-mono">
                    <span class="text-red-400 line-through truncate max-w-24" :title="oldKeyName">{{ oldKeyName }}</span>
                    <span class="text-gray-600 shrink-0">=</span>
                    <span class="text-amber-300 light:text-amber-700 truncate max-w-28" :title="dumpData[path]?.[oldKeyName]">
                      {{ dumpData[path]?.[oldKeyName] ?? '' }}
                    </span>
                    <span v-if="newKeyName.trim() && newKeyName.trim() !== oldKeyName.trim()" class="text-gray-600 shrink-0">→</span>
                    <span v-if="newKeyName.trim() && newKeyName.trim() !== oldKeyName.trim()" class="text-green-400 truncate max-w-24" :title="newKeyName">
                      {{ newKeyName }}
                    </span>
                  </div>

                  <!-- Conflict warning -->
                  <span
                    v-if="newKeyConflicts(path) && selectedPaths.has(path)"
                    class="shrink-0 text-xs px-1.5 py-0.5 bg-amber-900 text-amber-300 rounded border border-amber-700"
                    :title="t('keyRenameModal.conflictTitle')"
                  >{{ t('keyRenameModal.conflictWarning') }}</span>
                </div>
              </div>

              <!-- Conflict global warning -->
              <div
                v-if="matchingPaths.some(p => newKeyConflicts(p) && selectedPaths.has(p))"
                class="mt-2 px-3 py-2 bg-amber-950 border border-amber-800 rounded text-xs text-amber-300"
              >
                {{ t('keyRenameModal.globalConflictWarning') }} <span class="font-mono">{{ oldKeyName }}</span>.
              </div>
            </div>
          </template>
        </div>

        <!-- ── STEP 2 — Diff ── -->
        <div v-else-if="step === 2" class="space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-gray-400 text-sm">
              {{ t('keyRenameModal.diffTitle', { n: previews.length }) }}
              <span class="font-mono text-red-400 line-through">{{ oldKeyName }}</span>
              <span class="text-gray-500 mx-1">→</span>
              <span class="font-mono text-green-400">{{ newKeyName }}</span>
            </span>
            <div class="flex gap-2">
              <button class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" @click="step = 1">{{ t('keyRenameModal.adjust') }}</button>
              <button
                class="text-xs px-3 py-1 bg-orange-700 hover:bg-orange-600 text-white rounded font-semibold disabled:opacity-40"
                :disabled="previews.length === 0"
                @click="showConfirmAll = true"
              >{{ t('keyRenameModal.apply', { n: previews.length }) }}</button>
            </div>
          </div>

          <div class="border border-gray-700 rounded divide-y divide-gray-800">
            <div v-for="entry in previews" :key="entry.path" class="px-4 py-2.5">
              <div class="font-mono text-xs text-gray-400 mb-1.5">{{ entry.path }}</div>
              <table class="w-full text-xs font-mono">
                <tbody>
                  <!-- Old key removed -->
                  <tr class="bg-red-950 text-red-300">
                    <td class="py-1 pr-4 w-1/3 line-through opacity-70">{{ oldKeyName }}</td>
                    <td class="py-1 pr-4 w-1/3 opacity-70">{{ entry.before[oldKeyName] }}</td>
                    <td class="py-1 w-1/3 italic text-red-500">{{ t('keyRenameModal.deletedLabel') }}</td>
                  </tr>
                  <!-- New key added -->
                  <tr class="bg-green-950 text-green-300">
                    <td class="py-1 pr-4 w-1/3 font-bold">{{ newKeyName }}</td>
                    <td class="py-1 pr-4 w-1/3 text-gray-600 italic">—</td>
                    <td class="py-1 w-1/3 font-bold">{{ entry.after[newKeyName] }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- ── STEP 3 — Résultat ── -->
        <div v-else-if="step === 3" class="space-y-4">
          <div class="flex flex-col items-center py-10 gap-4">
            <div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl border-2"
              :class="applyErrCount === 0 ? 'border-green-500 bg-green-950 text-green-400' : 'border-amber-500 bg-amber-950 text-amber-400'">
              {{ applyErrCount === 0 ? '✓' : '⚠' }}
            </div>
            <div class="text-center">
              <div class="text-white font-semibold text-base mb-1">
                {{ applyErrCount === 0 ? t('keyRenameModal.step3Success') : t('keyRenameModal.step3Errors') }}
              </div>
              <div class="text-gray-400 text-sm">
                <span class="font-mono text-red-400 line-through">{{ oldKeyName }}</span>
                <span class="text-gray-500 mx-1">→</span>
                <span class="font-mono text-green-400">{{ newKeyName }}</span>
                {{ t('keyRenameModal.renamedIn') }} {{ t('keyRenameModal.successRenames', { n: applyOkCount }) }}
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

          <details v-if="applyOkCount > 0" class="text-xs text-gray-600">
            <summary class="cursor-pointer hover:text-gray-400 transition">{{ t('keyRenameModal.successRenames', { n: applyOkCount }) }}</summary>
            <div class="mt-2 space-y-0.5 font-mono">
              <div v-for="r in applyResults.filter(r => r.ok)" :key="r.path" class="text-green-700">✓ {{ r.path }}</div>
            </div>
          </details>
        </div>

      </div><!-- end body -->

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-gray-700 flex items-center justify-between shrink-0">
        <button
          v-if="step > 1 && step < 3"
          class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-40"
          :disabled="applying"
          @click="step = (step - 1) as Step"
        >{{ t('keyRenameModal.back') }}</button>
        <div v-else></div>

        <div class="flex gap-2">
          <button v-if="step === 3" class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" @click="emit('close')">{{ t('keyRenameModal.close') }}</button>

          <button
            v-if="step === 1"
            class="text-sm px-4 py-1.5 bg-orange-700 hover:bg-orange-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="!step1Valid"
            @click="step = 2"
          >{{ t('keyRenameModal.viewDiff', { n: previews.length }) }}</button>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDiffModal
    v-if="showConfirmAll"
    :path="t('keyRenameModal.diffTitle', { n: previews.length })"
    :before="confirmAllBefore"
    :after="confirmAllAfter"
    @confirm="applyAll"
    @cancel="showConfirmAll = false"
  />
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useVaultStore } from '../stores/vault'
import ConfirmDiffModal from './ConfirmDiffModal.vue'

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
const dumpData = ref<Record<string, Record<string, string>>>({})

const matchingPaths = computed(() =>
  Object.keys(dumpData.value)
    .filter(p => {
      if (!(keyName.value.trim() in dumpData.value[p])) return false
      if (!includeProd.value && pathIsProd(p)) return false
      return true
    })
    .sort()
)

// Per-path edited values (pre-filled with current value)
const pathValues = ref<Record<string, string>>({})

// Per-path selection
const selectedPaths = ref<Set<string>>(new Set())

watch(matchingPaths, paths => {
  const vals: Record<string, string> = {}
  for (const p of paths) vals[p] = dumpData.value[p]?.[keyName.value] ?? ''
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
  pathValues.value[path] = dumpData.value[path]?.[keyName.value] ?? ''
}

function isModified(path: string): boolean {
  return (pathValues.value[path] ?? '') !== (dumpData.value[path]?.[keyName.value] ?? '')
}

// ── Step 2 — Diff: only selected paths where value actually changed ──
type PathDiff = { path: string; before: Record<string, string>; after: Record<string, string> }

const previews = computed<PathDiff[]>(() =>
  [...selectedPaths.value]
    .filter(p => matchingPaths.value.includes(p) && isModified(p))
    .sort()
    .map(path => {
      const before = dumpData.value[path] ?? {}
      const after = { ...before, [keyName.value]: pathValues.value[path] ?? '' }
      return { path, before, after }
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
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    const payload = await res.json()
    const raw = payload?.data ?? payload
    if (typeof raw !== 'object' || raw === null) throw new Error('Réponse invalide')
    dumpData.value = raw as Record<string, Record<string, string>>
    scanned.value = true
  } catch (e: unknown) {
    scanError.value = e instanceof Error ? e.message : 'Erreur réseau'
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
      applyResults.value.push({ path: preview.path, ok: false, error: e instanceof Error ? e.message : 'Erreur' })
    }
  }
  applying.value = false
  step.value = 3
}

const STEP_LABELS: Record<number, string> = { 1: 'Recherche & édition', 2: 'Diff', 3: 'Résultat' }
</script>

<template>
  <div
    class="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
    @click.self="emit('close')"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">

      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
        <div class="flex items-center gap-3">
          <span class="text-white font-semibold text-sm">Ajuster par path</span>
          <span class="text-gray-600 text-xs">·</span>
          <span class="text-gray-500 text-xs">mount : <span class="text-green-400">{{ vault.currentMount }}</span></span>
        </div>
        <div class="flex items-center gap-1">
          <template v-for="s in [1, 2, 3]" :key="s">
            <div
              class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
              :class="step === s ? 'bg-violet-700 text-white' : s < step ? 'bg-gray-700 text-gray-300' : 'text-gray-600'"
            >
              <span>{{ s }}</span>
              <span class="hidden sm:inline">{{ STEP_LABELS[s] }}</span>
            </div>
            <span v-if="s < 3" class="text-gray-700 text-xs">›</span>
          </template>
        </div>
        <button class="text-gray-500 hover:text-gray-300 ml-3 shrink-0" @click="emit('close')">✕</button>
      </div>

      <!-- Body -->
      <div class="overflow-auto flex-1 px-5 py-4">

        <!-- ── STEP 1 — Scan + per-path inline editing ── -->
        <div v-if="step === 1" class="space-y-4">
          <p class="text-gray-400 text-sm">
            Recherchez une clé pour voir toutes ses occurrences. Éditez la valeur directement sur chaque ligne — seuls les paths modifiés seront mis à jour.
          </p>

          <!-- Search bar -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-gray-400 text-xs">Clé à rechercher</label>
              <button
                class="px-2 py-0.5 rounded border text-xs font-mono font-semibold transition pointer"
                :class="includeProd ? 'bg-red-900 border-red-700 text-red-200' : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500'"
                @click="includeProd = !includeProd"
                title="Inclure les paths prod dans la recherche"
              >{{ includeProd ? '🔴 prod inclus' : 'prod exclu' }}</button>
            </div>
            <div class="flex gap-2">
              <input
                v-model="keyName"
                type="text"
                placeholder="FF_OPEN_MODAL"
                class="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 text-violet-300 font-mono rounded text-sm focus:outline-none focus:border-violet-600 placeholder-gray-700"
                spellcheck="false"
                @keydown.enter="scan"
              />
              <button
                class="px-4 py-2 bg-violet-700 hover:bg-violet-600 text-white rounded text-sm font-semibold disabled:opacity-40 transition"
                :disabled="!keyName.trim() || scanning"
                @click="scan"
              >{{ scanning ? 'Scan…' : 'Rechercher' }}</button>
            </div>
          </div>

          <!-- Scanning -->
          <div v-if="scanning" class="flex flex-col items-center py-8 gap-3">
            <div class="w-10 h-10 border-2 border-gray-700 border-t-violet-400 rounded-full animate-spin"></div>
            <p class="text-gray-400 text-sm">Scan du mount…</p>
          </div>

          <!-- Error -->
          <div v-if="scanError" class="text-red-400 text-sm px-3 py-2 bg-red-950 border border-red-800 rounded">⚠ {{ scanError }}</div>

          <!-- No results -->
          <div v-if="scanned && !scanning && matchingPaths.length === 0" class="p-4 bg-gray-800 border border-gray-700 rounded text-center">
            <div class="text-gray-300 font-semibold mb-1">Clé introuvable</div>
            <div class="text-gray-500 text-xs font-mono">
              « {{ keyName }} » n'existe dans aucun secret du mount <span class="text-green-400">{{ vault.currentMount }}</span>.
            </div>
          </div>

          <!-- Results + inline editing -->
          <template v-if="scanned && !scanning && matchingPaths.length > 0">

            <!-- Stats bar -->
            <div class="flex items-center gap-3 px-4 py-2.5 bg-violet-950 border border-violet-800 rounded">
              <span class="text-violet-400 shrink-0">✏</span>
              <div class="flex-1">
                <span class="text-violet-200 font-semibold text-sm font-mono">{{ keyName }}</span>
                <span class="text-violet-300 text-sm"> — <span class="text-white font-bold">{{ matchingPaths.length }}</span> occurrence(s)</span>
                <div class="text-violet-500 text-xs mt-0.5">
                  Éditez la valeur sur chaque ligne · <span class="text-yellow-400 font-semibold">{{ previews.length }}</span> modification(s) en attente
                </div>
              </div>
            </div>

            <!-- Path list with inline editable values -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-gray-400 text-xs">
                  <span class="text-white font-semibold">{{ selectedPaths.size }}</span> / {{ matchingPaths.length }} paths sélectionnés
                  <span v-if="previews.length > 0" class="ml-2 text-yellow-400">· {{ previews.length }} modifié(s)</span>
                </span>
                <div class="flex gap-2">
                  <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded" @click="selectAll">Tout</button>
                  <button class="text-xs px-2 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded" @click="selectNone">Aucun</button>
                </div>
              </div>

              <div class="border border-gray-700 rounded divide-y divide-gray-800">
                <div
                  v-for="path in matchingPaths"
                  :key="path"
                  class="flex items-center gap-3 px-3 py-2 transition"
                  :class="selectedPaths.has(path) ? '' : 'opacity-35'"
                >
                  <!-- Checkbox -->
                  <span
                    class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs cursor-pointer transition"
                    :class="selectedPaths.has(path) ? 'bg-violet-500 border-violet-400' : 'border-gray-600 bg-gray-800'"
                    @click="togglePath(path)"
                  >
                    <span v-if="selectedPaths.has(path)">✓</span>
                  </span>

                  <!-- Path -->
                  <span
                    class="font-mono text-xs text-gray-300 cursor-pointer shrink-0 min-w-0 truncate"
                    style="max-width: 220px"
                    :title="path"
                    @click="togglePath(path)"
                  >{{ path }}</span>

                  <!-- Editable value -->
                  <div class="flex-1 flex items-center gap-1.5 min-w-0">
                    <input
                      v-model="pathValues[path]"
                      type="text"
                      class="flex-1 px-2 py-1 bg-gray-950 font-mono rounded text-xs focus:outline-none transition min-w-0"
                      :class="isModified(path)
                        ? 'border border-yellow-600 text-yellow-200 focus:border-yellow-400'
                        : 'border border-gray-700 text-gray-400 focus:border-gray-500'"
                      :disabled="!selectedPaths.has(path)"
                      spellcheck="false"
                    />
                    <!-- Reset button — only show when value is modified -->
                    <button
                      v-if="isModified(path)"
                      class="shrink-0 text-gray-600 hover:text-gray-300 text-xs px-1.5 py-1 rounded hover:bg-gray-700 transition"
                      title="Remettre la valeur originale"
                      @click="resetValue(path)"
                    >↺</button>
                  </div>

                  <!-- Modified badge -->
                  <span
                    v-if="isModified(path) && selectedPaths.has(path)"
                    class="shrink-0 text-xs px-1.5 py-0.5 bg-yellow-900 text-yellow-300 rounded border border-yellow-800"
                  >modifié</span>
                </div>
              </div>
            </div>

            <div v-if="unchangedCount > 0 && previews.length > 0" class="text-gray-600 text-xs">
              ℹ {{ unchangedCount }} path(s) sélectionné(s) sans modification — ils ne seront pas mis à jour.
            </div>
            <div v-if="scanned && previews.length === 0" class="text-gray-500 text-xs">
              Éditez au moins une valeur ci-dessus pour continuer.
            </div>
          </template>
        </div>

        <!-- ── STEP 2 — Diff ── -->
        <div v-else-if="step === 2" class="space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-gray-400 text-sm">
              <span class="text-white font-bold">{{ previews.length }}</span> path(s) modifié(s) ·
              clé <span class="font-mono text-violet-300">{{ keyName }}</span>
            </span>
            <div class="flex gap-2">
              <button class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" @click="step = 1">← Ajuster</button>
              <button
                class="text-xs px-3 py-1 bg-violet-700 hover:bg-violet-600 text-white rounded font-semibold disabled:opacity-40"
                :disabled="previews.length === 0"
                @click="showConfirmAll = true"
              >Appliquer ({{ previews.length }})</button>
            </div>
          </div>

          <div class="border border-gray-700 rounded divide-y divide-gray-800">
            <div v-for="entry in previews" :key="entry.path" class="px-4 py-2.5">
              <div class="font-mono text-xs text-gray-400 mb-1.5">{{ entry.path }}</div>
              <table class="w-full text-xs font-mono">
                <tbody>
                  <tr class="text-yellow-200 bg-yellow-950">
                    <td class="py-1 pr-4 w-1/3 font-semibold">{{ keyName }}</td>
                    <td class="py-1 pr-4 w-1/3 opacity-60 line-through">{{ entry.before[keyName] }}</td>
                    <td class="py-1 w-1/3 font-bold text-green-300">{{ entry.after[keyName] }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="previews.length === 0" class="text-gray-500 text-sm text-center py-4">Aucune modification.</div>
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
                {{ applyErrCount === 0 ? 'Valeurs ajustées !' : 'Mise à jour terminée avec erreurs' }}
              </div>
              <div class="text-gray-400 text-sm">
                <span class="font-mono text-violet-300">{{ keyName }}</span> ajusté dans
                <span class="text-green-400 font-bold">{{ applyOkCount }}</span> secret(s)
                <template v-if="applyErrCount > 0"> · <span class="text-red-400 font-bold">{{ applyErrCount }}</span> erreur(s)</template>
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
            <summary class="cursor-pointer hover:text-gray-400 transition">{{ applyOkCount }} ajustement(s) réussi(s)</summary>
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
        >← Retour</button>
        <div v-else></div>

        <div class="flex gap-2">
          <button v-if="step === 3" class="text-sm px-4 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" @click="emit('close')">Fermer</button>

          <button
            v-if="step === 1"
            class="text-sm px-4 py-1.5 bg-violet-700 hover:bg-violet-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="!step1Valid"
            @click="step = 2"
          >Voir le diff ({{ previews.length }}) →</button>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDiffModal
    v-if="showConfirmAll"
    path="(ajustement — paths modifiés)"
    :before="confirmAllBefore"
    :after="confirmAllAfter"
    @confirm="applyAll"
    @cancel="showConfirmAll = false"
  />
</template>

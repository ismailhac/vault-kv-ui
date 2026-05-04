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

// ── Step 1 — Scan + selection ──
const keyName = ref('')
const newValue = ref('')
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

// Individual path selection (all pre-checked after scan)
const selectedPaths = ref<Set<string>>(new Set())

watch(matchingPaths, paths => {
  selectedPaths.value = new Set(paths)
})

// Summary of current values across matching paths
const uniqueCurrentValues = computed(() =>
  [...new Set(matchingPaths.value.map(p => dumpData.value[p]?.[keyName.value] ?? ''))],
)
const allSameCurrentValue = computed(() =>
  uniqueCurrentValues.value.length === 1 ? uniqueCurrentValues.value[0] : null,
)

function togglePath(path: string) {
  if (selectedPaths.value.has(path)) selectedPaths.value.delete(path)
  else selectedPaths.value.add(path)
  // trigger reactivity
  selectedPaths.value = new Set(selectedPaths.value)
}

function selectAll() { selectedPaths.value = new Set(matchingPaths.value) }
function selectNone() { selectedPaths.value = new Set() }

// ── Step 2 — Diff (instant, from dump) ──
type PathDiff = { path: string; before: Record<string, string>; after: Record<string, string> }

const previews = computed<PathDiff[]>(() =>
  [...selectedPaths.value]
    .filter(p => matchingPaths.value.includes(p))
    .sort()
    .map(path => {
      const before = dumpData.value[path] ?? {}
      const after = { ...before, [keyName.value]: newValue.value }
      return { path, before, after }
    }),
)

const showConfirmAll = ref(false)

const confirmAllBefore = computed(() =>
  previews.value.reduce((acc, p) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(p.before).map(([k, v]) => [`${p.path} / ${k}`, v])),
  }), {} as Record<string, string>),
)
const confirmAllAfter = computed(() =>
  previews.value.reduce((acc, p) => ({
    ...acc,
    ...Object.fromEntries(Object.entries(p.after).map(([k, v]) => [`${p.path} / ${k}`, v])),
  }), {} as Record<string, string>),
)

// ── Step 3 — Results ──
const applyResults = ref<{ path: string; ok: boolean; error?: string }[]>([])
const applying = ref(false)
const applyOkCount = computed(() => applyResults.value.filter(r => r.ok).length)
const applyErrCount = computed(() => applyResults.value.filter(r => !r.ok).length)

// ── Validation ──
const step1Valid = computed(() =>
  scanned.value && selectedPaths.value.size > 0 && newValue.value.trim().length > 0,
)

// ── Actions ──
async function scan() {
  if (!keyName.value.trim()) return
  scanning.value = true
  scanError.value = null
  scanned.value = false
  dumpData.value = {}
  newValue.value = ''
  try {
    const params = new URLSearchParams({ mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/dump?${params}`)
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    const payload = await res.json()
    const raw = payload?.data ?? payload
    if (typeof raw !== 'object' || raw === null) throw new Error('Réponse invalide du serveur')
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

const STEP_LABELS: Record<number, string> = { 1: 'Recherche', 2: 'Diff', 3: 'Résultat' }
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
          <span class="text-white font-semibold text-sm">Remplacer une valeur</span>
          <span class="text-gray-600 text-xs">·</span>
          <span class="text-gray-500 text-xs">mount : <span class="text-green-400">{{ vault.currentMount }}</span></span>
        </div>
        <div class="flex items-center gap-1">
          <template v-for="s in [1, 2, 3]" :key="s">
            <div
              class="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition"
              :class="step === s ? 'bg-blue-700 text-white' : s < step ? 'bg-gray-700 text-gray-300' : 'text-gray-600'"
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

        <!-- ── STEP 1 — Recherche + sélection + nouvelle valeur ── -->
        <div v-if="step === 1" class="space-y-4">

          <!-- Search bar -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-gray-400 text-xs">Nom de la clé à mettre à jour</label>
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
                placeholder="API_KOBI_REGISTRY_V2_API_KEY"
                class="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 text-blue-300 font-mono rounded text-sm focus:outline-none focus:border-blue-600 placeholder-gray-700"
                spellcheck="false"
                @keydown.enter="scan"
              />
              <button
                class="px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded text-sm font-semibold disabled:opacity-40 transition"
                :disabled="!keyName.trim() || scanning"
                @click="scan"
              >{{ scanning ? 'Scan…' : 'Rechercher' }}</button>
            </div>
          </div>

          <!-- Scanning -->
          <div v-if="scanning" class="flex flex-col items-center py-8 gap-3">
            <div class="w-10 h-10 border-2 border-gray-700 border-t-blue-400 rounded-full animate-spin"></div>
            <p class="text-gray-400 text-sm">Scan du mount en cours…</p>
          </div>

          <!-- Scan error -->
          <div v-if="scanError" class="text-red-400 text-sm px-3 py-2 bg-red-950 border border-red-800 rounded">
            ⚠ {{ scanError }}
          </div>

          <!-- No results -->
          <div v-if="scanned && !scanning && matchingPaths.length === 0" class="p-4 bg-gray-800 border border-gray-700 rounded text-center">
            <div class="text-gray-300 font-semibold mb-1">Clé introuvable</div>
            <div class="text-gray-500 text-xs font-mono">
              « {{ keyName }} » n'existe dans aucun secret du mount <span class="text-green-400">{{ vault.currentMount }}</span>.
            </div>
          </div>

          <!-- Results -->
          <template v-if="scanned && !scanning && matchingPaths.length > 0">

            <!-- Found banner -->
            <div class="flex items-center gap-3 px-4 py-2.5 bg-blue-950 border border-blue-800 rounded">
              <span class="text-blue-400 text-base shrink-0">🔍</span>
              <div class="flex-1 min-w-0">
                <span class="text-blue-200 font-semibold text-sm font-mono">{{ keyName }}</span>
                <span class="text-blue-300 text-sm"> trouvée dans
                  <span class="text-white font-bold">{{ matchingPaths.length }}</span> secret(s)
                </span>
                <div class="text-blue-500 text-xs mt-0.5">
                  <template v-if="allSameCurrentValue !== null">
                    Valeur actuelle identique partout : <span class="font-mono text-amber-400">{{ allSameCurrentValue }}</span>
                  </template>
                  <template v-else>
                    {{ uniqueCurrentValues.length }} valeurs différentes trouvées
                  </template>
                  · {{ Object.keys(dumpData).length }} secrets scannés
                </div>
              </div>
            </div>

            <!-- New value input -->
            <div class="p-3 bg-gray-800 border border-gray-700 rounded space-y-2">
              <label class="text-gray-300 text-xs font-semibold block">Nouvelle valeur commune</label>
              <input
                v-model="newValue"
                type="text"
                placeholder="Entrez la nouvelle valeur…"
                class="w-full px-3 py-2 bg-gray-950 border border-gray-700 text-green-300 font-mono rounded text-sm focus:outline-none focus:border-green-600 placeholder-gray-700"
                spellcheck="false"
              />
              <div v-if="newValue.trim() && allSameCurrentValue !== null && newValue.trim() === allSameCurrentValue" class="text-amber-400 text-xs">
                ⚠ La nouvelle valeur est identique à la valeur actuelle.
              </div>
            </div>

            <!-- Path list with individual checkboxes -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-gray-400 text-xs">
                  <span class="text-white font-semibold">{{ selectedPaths.size }}</span> / {{ matchingPaths.length }} paths sélectionnés
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
                  class="flex items-center gap-3 px-4 py-2 cursor-pointer transition select-none"
                  :class="selectedPaths.has(path) ? 'hover:bg-gray-800' : 'opacity-40 hover:opacity-60'"
                  @click="togglePath(path)"
                >
                  <!-- Checkbox -->
                  <span class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs transition"
                    :class="selectedPaths.has(path) ? 'bg-blue-500 border-blue-400' : 'border-gray-600 bg-gray-800'">
                    <span v-if="selectedPaths.has(path)">✓</span>
                  </span>

                  <!-- Path -->
                  <span class="font-mono text-xs flex-1 min-w-0 truncate text-gray-300">{{ path }}</span>

                  <!-- Current → new value preview -->
                  <div class="flex items-center gap-1.5 shrink-0 text-xs font-mono">
                    <span class="text-amber-400 max-w-32 truncate" :title="dumpData[path]?.[keyName]">
                      {{ dumpData[path]?.[keyName] ?? '' }}
                    </span>
                    <span v-if="newValue.trim() && selectedPaths.has(path)" class="text-gray-600">→</span>
                    <span v-if="newValue.trim() && selectedPaths.has(path)" class="text-green-400 max-w-32 truncate" :title="newValue">
                      {{ newValue }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- ── STEP 2 — Diff ── -->
        <div v-else-if="step === 2" class="space-y-4">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <span class="text-gray-400 text-sm">
              <span class="text-white font-bold">{{ previews.length }}</span> path(s) ·
              clé <span class="font-mono text-blue-300">{{ keyName }}</span> → <span class="font-mono text-green-300">{{ newValue }}</span>
            </span>
            <div class="flex gap-2">
              <button class="text-xs px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" @click="step = 1">← Ajuster</button>
              <button
                class="text-xs px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold disabled:opacity-40"
                :disabled="previews.length === 0"
                @click="showConfirmAll = true"
              >Appliquer ({{ previews.length }})</button>
            </div>
          </div>

          <div class="border border-gray-700 rounded divide-y divide-gray-800">
            <div v-for="entry in previews" :key="entry.path" class="px-4 py-2">
              <div class="font-mono text-xs text-gray-400 mb-1.5">{{ entry.path }}</div>
              <table class="w-full text-xs font-mono">
                <tbody>
                  <tr class="text-yellow-200 bg-yellow-950 rounded">
                    <td class="py-1 pr-4 w-1/3 font-semibold">{{ keyName }}</td>
                    <td class="py-1 pr-4 w-1/3 opacity-70 line-through">{{ entry.before[keyName] }}</td>
                    <td class="py-1 w-1/3 font-bold text-green-300">{{ entry.after[keyName] }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div v-if="previews.length === 0" class="text-gray-500 text-sm text-center py-4">
            Aucun path sélectionné.
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
                {{ applyErrCount === 0 ? 'Valeur mise à jour !' : 'Mise à jour terminée avec erreurs' }}
              </div>
              <div class="text-gray-400 text-sm">
                <span class="font-mono text-blue-300">{{ keyName }}</span> mis à jour dans
                <span class="text-green-400 font-bold">{{ applyOkCount }}</span> secret(s)
                <template v-if="applyErrCount > 0"> · <span class="text-red-400 font-bold">{{ applyErrCount }}</span> erreur(s)</template>
              </div>
              <div class="mt-1 text-gray-500 text-xs font-mono">→ <span class="text-green-300">{{ newValue }}</span></div>
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
            <summary class="cursor-pointer hover:text-gray-400 transition">{{ applyOkCount }} mise(s) à jour réussie(s)</summary>
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
            class="text-sm px-4 py-1.5 bg-blue-700 hover:bg-blue-600 text-white rounded font-semibold disabled:opacity-40"
            :disabled="!step1Valid"
            @click="step = 2"
          >Voir le diff →</button>
        </div>
      </div>
    </div>
  </div>

  <ConfirmDiffModal
    v-if="showConfirmAll"
    path="(mise à jour — paths sélectionnés)"
    :before="confirmAllBefore"
    :after="confirmAllAfter"
    @confirm="applyAll"
    @cancel="showConfirmAll = false"
  />
</template>

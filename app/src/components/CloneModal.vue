<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from '../stores/vault'
import { mergeSecretData } from '../utils/nestedKeys'
import type { SecretData } from '../types/secret'

const { t } = useI18n()
const props = defineProps<{
  selectedData: Record<string, unknown>
  selectedLeafPaths: { path: string; value: unknown }[]
}>()
const emit = defineEmits<{ close: []; cloned: [targetPath: string] }>()
const vault = useVaultStore()

type Phase = 'form' | 'scanning' | 'diff' | 'applying' | 'done'
type SiblingStatus = {
  path: string
  conflictKeys: string[]      // dot-paths where target has a DIFFERENT value
  sameValuePaths: string[]    // dot-paths where target already has the same value
  data: Record<string, unknown> | null
  writeResult: 'pending' | 'ok' | 'error'
  error?: string
}

const phase = ref<Phase>('form')
const siblings = ref<string[]>([])
const siblingsLoading = ref(false)
const siblingsError = ref<string | null>(null)
const selectedTargets = ref<Set<string>>(new Set())
const customPathInput = ref('')
const customPaths = ref<string[]>([])
const includeProd = ref(false)

const siblingStatuses = ref<SiblingStatus[]>([])
const selectedClean = ref<Set<string>>(new Set())
const expandedDiffPaths = ref<Set<string>>(new Set())
const targetLeafSelections = ref<Map<string, Set<string>>>(new Map())

const PROD_NAMES = new Set(['prod', 'production', 'prd'])

function pathIsProd(path: string): boolean {
  const segs = path.split('/').filter(Boolean)
  return segs.slice(1).some(s => PROD_NAMES.has(s.toLowerCase()))
}

const allTargets = computed(() => [...siblings.value, ...customPaths.value])
const filteredTargets = computed(() =>
  includeProd.value ? allTargets.value : allTargets.value.filter(p => !pathIsProd(p))
)
const activePropCount = computed(() =>
  [...selectedTargets.value].filter(p => filteredTargets.value.includes(p)).length
)
const cleanSiblings = computed(() => siblingStatuses.value.filter(s => s.conflictKeys.length === 0))
const conflictSiblings = computed(() => siblingStatuses.value.filter(s => s.conflictKeys.length > 0))

async function fetchTargetData(path: string): Promise<Record<string, unknown> | null> {
  try {
    const params = new URLSearchParams({ path, mount: vault.currentMount, namespace: vault.currentNamespace })
    const res = await fetch(`/api/kv/read?${params}`)
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch { return null }
}

async function loadSiblings() {
  siblingsLoading.value = true
  siblingsError.value = null
  try {
    const secretPath = vault.selectedSecret?.path ?? vault.currentPath
    const parts = secretPath.split('/').filter(Boolean)
    let discovered: string[] = []
    if (parts.length >= 3) {
      const projectRoot = parts[0]
      const currentBu = parts[1]
      const restPath = parts.slice(2).join('/')
      const params = new URLSearchParams({ path: projectRoot, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/list?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const buFolders = (json.keys as string[]).filter((k: string) => k.endsWith('/')).map((k: string) => k.replace(/\/$/, ''))
      discovered = buFolders.filter(bu => bu !== currentBu).map(bu => `${projectRoot}/${bu}/${restPath}`)
    } else {
      const parentPath = parts.slice(0, -1).join('/')
      const params = new URLSearchParams({ path: parentPath, mount: vault.currentMount, namespace: vault.currentNamespace })
      const res = await fetch(`/api/kv/list?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const keys: string[] = (json.keys ?? []).filter((k: string) => !k.endsWith('/'))
      const prefix = parts.slice(0, -1).length > 0 ? `${parts.slice(0, -1).join('/')}/` : ''
      discovered = keys.map(k => `${prefix}${k}`).filter(p => p !== secretPath)
    }
    const customs = customPaths.value.filter(p => !discovered.includes(p) && p !== secretPath)
    siblings.value = [...discovered, ...customs]
    selectedTargets.value = new Set(siblings.value.filter(p => !pathIsProd(p)))
  } catch (e: unknown) {
    siblingsError.value = e instanceof Error ? e.message : t('cloneModal.loadError')
    siblings.value = []
  } finally {
    siblingsLoading.value = false
  }
}

function toggleTarget(path: string) {
  const next = new Set(selectedTargets.value)
  next.has(path) ? next.delete(path) : next.add(path)
  selectedTargets.value = next
}

function selectAll() { selectedTargets.value = new Set(filteredTargets.value) }
function deselectAll() { selectedTargets.value = new Set() }

function addCustomPath() {
  const p = customPathInput.value.trim()
  if (!p || customPaths.value.includes(p) || siblings.value.includes(p) || p === vault.currentPath) return
  customPaths.value = [...customPaths.value, p]
  selectedTargets.value = new Set([...selectedTargets.value, p])
  customPathInput.value = ''
}

function toggleDiffAccordion(path: string) {
  const expanded = new Set(expandedDiffPaths.value)
  if (expanded.has(path)) { expanded.delete(path) } else { expanded.add(path) }
  expandedDiffPaths.value = expanded
}

function getLeafValue(path: string): unknown {
  return props.selectedLeafPaths.find(p => p.path === path)?.value
}

function getNewPaths(s: SiblingStatus): { path: string; value: unknown }[] {
  return props.selectedLeafPaths.filter(({ path }) => !getValueAtDotPath(s.data ?? {}, path).found)
}

function formatValue(v: unknown): string {
  return typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')
}

function allLeafPaths(): Set<string> {
  return new Set(props.selectedLeafPaths.map(p => p.path))
}

function toggleClean(path: string) {
  const next = new Set(selectedClean.value)
  const sel = new Map(targetLeafSelections.value)
  if (next.has(path)) {
    next.delete(path)
    sel.delete(path)
  } else {
    next.add(path)
    sel.set(path, allLeafPaths())
  }
  selectedClean.value = next
  targetLeafSelections.value = sel
}

function toggleLeafForTarget(targetPath: string, leafPath: string) {
  const sel = new Map(targetLeafSelections.value)
  const paths = new Set(sel.get(targetPath) ?? allLeafPaths())
  if (paths.has(leafPath)) paths.delete(leafPath); else paths.add(leafPath)
  sel.set(targetPath, paths)
  targetLeafSelections.value = sel
}

function isLeafSelectedForTarget(targetPath: string, leafPath: string): boolean {
  return targetLeafSelections.value.get(targetPath)?.has(leafPath) ?? true
}

function buildDataForTarget(targetPath: string): Record<string, unknown> {
  const included = targetLeafSelections.value.get(targetPath) ?? allLeafPaths()
  const result: Record<string, unknown> = {}
  const setPath = (obj: Record<string, unknown>, parts: string[], val: unknown) => {
    const [head, ...rest] = parts
    if (!rest.length) { obj[head] = val; return }
    if (typeof obj[head] !== 'object' || obj[head] === null) obj[head] = {}
    setPath(obj[head] as Record<string, unknown>, rest, val)
  }
  for (const { path, value } of props.selectedLeafPaths) {
    if (included.has(path)) setPath(result, path.split('.'), value)
  }
  return result
}

function getValueAtDotPath(data: Record<string, unknown>, dotPath: string): { found: boolean; value: unknown } {
  const parts = dotPath.split('.')
  let current: unknown = data
  for (const part of parts) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return { found: false, value: undefined }
    const obj = current as Record<string, unknown>
    if (!(part in obj)) return { found: false, value: undefined }
    let val = obj[part]
    if (typeof val === 'string') { try { val = JSON.parse(val) } catch { /* keep as string */ } }
    current = val
  }
  return { found: true, value: current }
}

async function scanConflicts() {
  const targets = [...selectedTargets.value].filter(p => filteredTargets.value.includes(p))
  if (!targets.length) return
  siblingStatuses.value = targets.map(p => ({ path: p, conflictKeys: [], sameValuePaths: [], data: null, writeResult: 'pending' }))
  phase.value = 'scanning'
  await Promise.all(
    siblingStatuses.value.map(async (s) => {
      const data = await fetchTargetData(s.path)
      s.data = data
      s.conflictKeys = []
      s.sameValuePaths = []
      if (data) {
        for (const { path, value } of props.selectedLeafPaths) {
          const existing = getValueAtDotPath(data, path)
          if (existing.found) {
            if (JSON.stringify(existing.value) !== JSON.stringify(value)) {
              s.conflictKeys.push(path)
            } else {
              s.sameValuePaths.push(path)
            }
          }
        }
      }
    })
  )
  phase.value = 'diff'
  selectedClean.value = new Set(cleanSiblings.value.map(s => s.path))
  expandedDiffPaths.value = new Set()
  const initSel = new Map<string, Set<string>>()
  for (const s of cleanSiblings.value) initSel.set(s.path, allLeafPaths())
  targetLeafSelections.value = initSel
}

async function applyClone() {
  phase.value = 'applying'
  await Promise.all(
    siblingStatuses.value
      .filter(s => selectedClean.value.has(s.path))
      .map(async (s) => {
        try {
          const merged = mergeSecretData(s.data ?? {}, buildDataForTarget(s.path))
          await vault.writeSecret(s.path, merged as SecretData)
          s.writeResult = 'ok'
        } catch (e: unknown) {
          s.writeResult = 'error'
          s.error = e instanceof Error ? e.message : 'Error'
        }
      })
  )
  phase.value = 'done'
}

// Load siblings on mount
loadSiblings()
</script>

<template>
  <div
    class="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
    @click.self="phase === 'form' ? emit('close') : undefined"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh] light:bg-white light:border-gray-200">

      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-gray-800 shrink-0 light:border-gray-200">
        <div class="w-8 h-8 rounded-full bg-blue-950 flex items-center justify-center shrink-0 light:bg-blue-100">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-blue-400">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-white font-semibold text-sm light:text-black">{{ t('cloneModal.title') }}</div>
          <div class="text-gray-500 text-xs mt-0.5 light:text-gray-600">{{ t('cloneModal.subtitle', { n: selectedLeafPaths.length }) }}</div>
        </div>
        <button v-if="phase === 'form' || phase === 'done'" class="text-gray-500 hover:text-gray-300 shrink-0 light:hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        <!-- ── FORM PHASE ── -->
        <template v-if="phase === 'form'">

          <!-- Source keys -->
          <div>
            <div class="text-gray-400 text-xs uppercase tracking-wider font-semibold mb-2 light:text-gray-600">{{ t('cloneModal.sourceKeys') }}</div>
            <div class="bg-gray-950 border border-gray-800 rounded px-3 py-2 space-y-1 max-h-36 overflow-y-auto light:bg-gray-50 light:border-gray-200">
              <div v-for="p in selectedLeafPaths" :key="p.path" class="flex items-center gap-2 text-xs font-mono">
                <span class="text-gray-500 shrink-0 light:text-gray-400">▸</span>
                <span class="text-gray-300 light:text-gray-700">{{ p.path }}</span>
                <span class="text-gray-600 ml-auto shrink-0 text-[11px] light:text-gray-400">
                  {{ typeof p.value === 'object' ? '{…}' : String(p.value) }}
                </span>
              </div>
            </div>
          </div>

          <!-- Target paths -->
          <div class="border border-gray-700 rounded light:border-gray-200">
            <!-- Header controls -->
            <div class="flex items-center justify-between px-3 py-2 border-b border-gray-700 light:border-gray-200">
              <span class="text-xs text-gray-400 light:text-gray-600">{{ t('cloneModal.targetPaths') }}</span>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="px-2 py-0.5 rounded-full border text-xs font-medium transition cursor-pointer"
                  :class="includeProd ? 'bg-red-900/60 text-red-300 border-red-700 hover:bg-red-900' : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200 light:bg-gray-100 light:border-gray-300 light:text-gray-600 light:hover:bg-gray-200'"
                  @click="includeProd = !includeProd"
                >{{ includeProd ? t('cloneModal.includeProd') : t('cloneModal.excludeProd') }}</button>
                <button type="button" class="text-xs text-gray-500 hover:text-gray-200 transition" @click="selectAll">{{ t('cloneModal.selectAll') }}</button>
                <button type="button" class="text-xs text-gray-500 hover:text-gray-200 transition" @click="deselectAll">{{ t('cloneModal.deselectAll') }}</button>
                <button type="button" class="text-xs text-gray-500 hover:text-gray-200 transition" :disabled="siblingsLoading" @click="loadSiblings" title="Actualiser">🔄</button>
              </div>
            </div>

            <!-- Siblings list -->
            <div class="px-3 py-2 space-y-1 max-h-44 overflow-y-auto">
              <div v-if="siblingsLoading" class="text-gray-500 text-xs text-center py-2 animate-pulse">{{ t('cloneModal.loadingPaths') }}</div>
              <div v-else-if="siblingsError" class="text-amber-400 text-xs px-2 py-1.5 bg-amber-950/40 border border-amber-800/50 rounded">⚠ {{ siblingsError }}</div>
              <div v-else-if="filteredTargets.length === 0" class="text-gray-600 text-xs text-center py-2 light:text-gray-400">{{ t('cloneModal.noTargets') }}</div>
              <div
                v-else
                v-for="path in filteredTargets"
                :key="path"
                class="flex items-center gap-2 cursor-pointer px-2 py-1 rounded hover:bg-gray-800/60 transition light:hover:bg-gray-100"
                @click="toggleTarget(path)"
              >
                <span
                  class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs"
                  :class="selectedTargets.has(path) ? 'bg-blue-600 border-blue-500' : 'border-gray-600 bg-gray-800 light:bg-white light:border-gray-300'"
                ><span v-if="selectedTargets.has(path)">✓</span></span>
                <span class="text-xs font-mono truncate flex-1" :class="pathIsProd(path) ? 'text-amber-400 light:text-amber-600' : 'text-gray-300 light:text-gray-700'">{{ path }}</span>
                <span v-if="pathIsProd(path)" class="text-[10px] text-amber-600/70 shrink-0">prod</span>
              </div>
            </div>

            <!-- Custom path input -->
            <div class="border-t border-gray-700 px-3 py-2 flex gap-1 light:border-gray-200">
              <input
                v-model="customPathInput"
                :placeholder="t('cloneModal.customPathPlaceholder')"
                class="flex-1 px-2 py-1 bg-gray-950 border border-gray-700 text-gray-300 font-mono text-xs rounded focus:outline-none focus:border-gray-500 placeholder-gray-700 light:bg-white light:border-gray-300 light:text-gray-700 light:placeholder-gray-400"
                @keydown.enter.prevent="addCustomPath"
              />
              <button
                type="button"
                class="px-2 py-1 text-xs bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700 transition light:bg-gray-100 light:border-gray-300 light:text-gray-700 light:hover:bg-gray-200"
                @click="addCustomPath"
              >{{ t('cloneModal.addPath') }}</button>
            </div>
          </div>

        </template>

        <!-- ── SCANNING PHASE ── -->
        <div v-else-if="phase === 'scanning'" class="flex flex-col items-center py-10 gap-3">
          <svg class="animate-spin w-8 h-8 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span class="text-gray-400 text-sm">{{ t('cloneModal.scanning') }}</span>
        </div>

        <!-- ── DIFF PHASE ── -->
        <template v-else-if="phase === 'diff'">

          <!-- Keys being cloned -->
          <div>
            <div class="text-xs text-gray-400 mb-2 light:text-gray-600">{{ t('cloneModal.keysToClone', { n: selectedLeafPaths.length }) }}</div>
            <div class="bg-gray-950 border border-gray-800 rounded px-3 py-2 max-h-24 overflow-y-auto light:bg-gray-50 light:border-gray-200">
              <div v-for="p in selectedLeafPaths" :key="p.path" class="flex items-center gap-2 text-xs font-mono py-0.5">
                <span class="text-green-500">+</span>
                <span class="text-blue-300 light:text-blue-700">{{ p.path }}</span>
                <span class="text-gray-600 ml-auto text-[11px]">→ {{ typeof p.value === 'object' ? '{…}' : String(p.value) }}</span>
              </div>
            </div>
          </div>

          <!-- Clean targets with diff accordion -->
          <div v-if="cleanSiblings.length > 0">
            <div class="text-xs text-gray-400 mb-2 light:text-gray-600">{{ t('cloneModal.cleanTargets', { n: cleanSiblings.length }) }}</div>
            <div class="space-y-1">
              <div v-for="s in cleanSiblings" :key="s.path" class="rounded border border-gray-700 overflow-hidden light:border-gray-300">
                <div
                  class="flex items-center gap-2 cursor-pointer px-3 py-1.5 hover:bg-gray-800/30 transition light:hover:bg-gray-50"
                  @click="toggleClean(s.path)"
                >
                  <span
                    class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs"
                    :class="selectedClean.has(s.path) ? 'bg-green-600 border-green-500' : 'border-gray-600 bg-gray-800 light:bg-white light:border-gray-300'"
                  ><span v-if="selectedClean.has(s.path)">✓</span></span>
                  <span class="text-xs font-mono text-gray-300 flex-1 truncate light:text-gray-700">{{ s.path }}</span>
                  <span v-if="s.sameValuePaths.length > 0" class="shrink-0 text-[10px] text-gray-600 light:text-gray-400">
                    {{ t('cloneModal.alreadyUpToDate', { n: s.sameValuePaths.length }) }}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 text-gray-600 hover:text-gray-300 transition px-1 light:text-gray-400 light:hover:text-gray-600"
                    :title="t('cloneModal.showDiff')"
                    @click.stop="toggleDiffAccordion(s.path)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5 transition-transform" :class="expandedDiffPaths.has(s.path) ? 'rotate-90' : ''"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                  </button>
                </div>
                <div v-if="expandedDiffPaths.has(s.path)" class="border-t border-gray-800 bg-gray-950 light:bg-gray-50 light:border-gray-200">
                  <table class="w-full text-[11px] font-mono">
                    <thead>
                      <tr class="border-b border-gray-800 light:border-gray-200">
                        <th class="px-2 py-1 w-4"></th>
                        <th class="px-3 py-1 text-left text-gray-600 font-medium w-4"></th>
                        <th class="px-3 py-1 text-left text-gray-600 font-medium">{{ t('cloneModal.diffPath') }}</th>
                        <th class="px-3 py-1 text-left text-gray-600 font-medium">{{ t('cloneModal.diffBefore') }}</th>
                        <th class="px-3 py-1 text-left text-gray-600 font-medium">{{ t('cloneModal.diffAfter') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="{ path: lp, value: lv } in getNewPaths(s)" :key="lp" class="border-b border-gray-800/50 bg-green-950/20 light:bg-green-50 light:border-gray-100" :class="!isLeafSelectedForTarget(s.path, lp) ? 'opacity-40' : ''">
                        <td class="px-2 py-1 text-center"><input type="checkbox" class="accent-blue-500 cursor-pointer w-3 h-3" :checked="isLeafSelectedForTarget(s.path, lp)" @change="toggleLeafForTarget(s.path, lp)" /></td>
                        <td class="px-3 py-1 text-green-500 select-none">+</td>
                        <td class="px-3 py-1 text-gray-400 max-w-[160px] truncate">{{ lp }}</td>
                        <td class="px-3 py-1 text-gray-700">—</td>
                        <td class="px-3 py-1 text-green-300 light:text-green-700">{{ formatValue(lv) }}</td>
                      </tr>
                      <tr v-for="sp in s.sameValuePaths" :key="sp" class="border-b border-gray-800/30 light:border-gray-100">
                        <td class="px-2 py-1"></td>
                        <td class="px-3 py-1 text-gray-700 select-none">=</td>
                        <td class="px-3 py-1 text-gray-600 max-w-[160px] truncate">{{ sp }}</td>
                        <td class="px-3 py-1 text-gray-700" colspan="2">{{ formatValue(getValueAtDotPath(s.data ?? {}, sp).value) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <!-- Conflict targets (different values — opt-in to overwrite) -->
          <div v-if="conflictSiblings.length > 0" class="space-y-1">
            <div class="text-xs text-amber-400 mb-2 light:text-amber-600">{{ t('cloneModal.conflictTargets') }}</div>
            <div
              v-for="s in conflictSiblings"
              :key="s.path"
              class="rounded border border-amber-800/50 overflow-hidden light:border-amber-300"
            >
              <div
                class="flex items-center gap-2 cursor-pointer px-3 py-2 hover:bg-amber-900/20 transition bg-amber-950/30 light:bg-amber-50"
                @click="toggleClean(s.path)"
              >
                <span
                  class="w-4 h-4 rounded border flex items-center justify-center shrink-0 text-white text-xs"
                  :class="selectedClean.has(s.path) ? 'bg-amber-600 border-amber-500' : 'border-gray-600 bg-gray-800 light:bg-white light:border-gray-300'"
                ><span v-if="selectedClean.has(s.path)">✓</span></span>
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-mono text-amber-300 truncate light:text-amber-700">{{ s.path }}</div>
                  <div class="text-[11px] text-amber-500/70 mt-0.5 light:text-amber-600">{{ t('cloneModal.conflictKeys', { keys: s.conflictKeys.join(', ') }) }}</div>
                </div>
                <span class="text-[10px] text-amber-600/70 shrink-0">{{ t('cloneModal.overwrite') }}</span>
                <button
                  type="button"
                  class="shrink-0 text-gray-600 hover:text-gray-300 transition px-1 light:text-gray-400 light:hover:text-gray-600"
                  :title="t('cloneModal.showDiff')"
                  @click.stop="toggleDiffAccordion(s.path)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5 transition-transform" :class="expandedDiffPaths.has(s.path) ? 'rotate-90' : ''"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                </button>
              </div>
              <div v-if="expandedDiffPaths.has(s.path)" class="border-t border-amber-900/50 bg-gray-950 light:bg-amber-50/50 light:border-amber-200">
                <table class="w-full text-[11px] font-mono">
                  <thead>
                    <tr class="border-b border-gray-800 light:border-amber-200">
                      <th class="px-2 py-1 w-4"></th>
                      <th class="px-3 py-1 text-left text-gray-600 font-medium w-4"></th>
                      <th class="px-3 py-1 text-left text-gray-600 font-medium">{{ t('cloneModal.diffPath') }}</th>
                      <th class="px-3 py-1 text-left text-gray-600 font-medium">{{ t('cloneModal.diffBefore') }}</th>
                      <th class="px-3 py-1 text-left text-gray-600 font-medium">{{ t('cloneModal.diffAfter') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="cp in s.conflictKeys" :key="cp" class="border-b border-gray-800/50 bg-amber-950/20 light:bg-amber-50 light:border-amber-100" :class="!isLeafSelectedForTarget(s.path, cp) ? 'opacity-40' : ''">
                      <td class="px-2 py-1 text-center"><input type="checkbox" class="accent-blue-500 cursor-pointer w-3 h-3" :checked="isLeafSelectedForTarget(s.path, cp)" @change="toggleLeafForTarget(s.path, cp)" /></td>
                      <td class="px-3 py-1 text-amber-500 select-none">~</td>
                      <td class="px-3 py-1 text-amber-300 max-w-[160px] truncate light:text-amber-700">{{ cp }}</td>
                      <td class="px-3 py-1 text-red-400 light:text-red-700">{{ formatValue(getValueAtDotPath(s.data ?? {}, cp).value) }}</td>
                      <td class="px-3 py-1 text-green-300 light:text-green-700">{{ formatValue(getLeafValue(cp)) }}</td>
                    </tr>
                    <tr v-for="{ path: lp, value: lv } in getNewPaths(s)" :key="lp" class="border-b border-gray-800/50 bg-green-950/20 light:bg-green-50 light:border-gray-100" :class="!isLeafSelectedForTarget(s.path, lp) ? 'opacity-40' : ''">
                      <td class="px-2 py-1 text-center"><input type="checkbox" class="accent-blue-500 cursor-pointer w-3 h-3" :checked="isLeafSelectedForTarget(s.path, lp)" @change="toggleLeafForTarget(s.path, lp)" /></td>
                      <td class="px-3 py-1 text-green-500 select-none">+</td>
                      <td class="px-3 py-1 text-gray-400 max-w-[160px] truncate">{{ lp }}</td>
                      <td class="px-3 py-1 text-gray-700">—</td>
                      <td class="px-3 py-1 text-green-300 light:text-green-700">{{ formatValue(lv) }}</td>
                    </tr>
                    <tr v-for="sp in s.sameValuePaths" :key="sp" class="border-b border-gray-800/30 light:border-gray-100">
                      <td class="px-2 py-1"></td>
                      <td class="px-3 py-1 text-gray-700 select-none">=</td>
                      <td class="px-3 py-1 text-gray-600 max-w-[160px] truncate">{{ sp }}</td>
                      <td class="px-3 py-1 text-gray-700" colspan="2">{{ formatValue(getValueAtDotPath(s.data ?? {}, sp).value) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div v-if="cleanSiblings.length === 0 && conflictSiblings.length === 0" class="text-gray-500 text-sm text-center py-4">
            {{ t('cloneModal.noTargets') }}
          </div>

        </template>

        <!-- ── APPLYING / DONE PHASES ── -->
        <template v-else-if="phase === 'applying' || phase === 'done'">
          <div class="text-xs text-gray-400 mb-2 light:text-gray-600">{{ t('cloneModal.resultsTitle') }}</div>
          <div class="space-y-1">
            <div
              v-for="s in siblingStatuses.filter(s => selectedClean.has(s.path))"
              :key="s.path"
              class="flex items-center justify-between px-3 py-2 rounded border text-xs font-mono"
              :class="s.writeResult === 'ok'
                ? 'border-green-800 bg-green-950/30 light:border-green-300 light:bg-green-50'
                : s.writeResult === 'error'
                ? 'border-red-800 bg-red-950/30 light:border-red-300 light:bg-red-50'
                : 'border-gray-700 bg-gray-800/20'"
            >
              <span :class="s.writeResult === 'ok' ? 'text-green-300 light:text-green-700' : s.writeResult === 'error' ? 'text-red-300 light:text-red-700' : 'text-gray-400'">
                {{ s.path }}
              </span>
              <span v-if="s.writeResult === 'pending'" class="text-gray-600 shrink-0">
                <svg class="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
              </span>
              <span v-else-if="s.writeResult === 'ok'" class="text-green-400 shrink-0 light:text-green-600">✓ {{ t('cloneModal.success') }}</span>
              <span v-else class="text-red-400 shrink-0 light:text-red-600" :title="s.error">✕ {{ t('cloneModal.error') }}</span>
            </div>
          </div>
        </template>

      </div>

      <!-- Footer -->
      <div class="flex gap-2 px-5 py-4 border-t border-gray-800 shrink-0 light:border-gray-200">

        <!-- Form footer -->
        <template v-if="phase === 'form'">
          <button
            class="flex-1 py-2 text-sm bg-blue-700 hover:bg-blue-600 text-white rounded transition font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="activePropCount === 0 || siblingsLoading"
            @click="scanConflicts"
          >{{ t('cloneModal.scan', { n: activePropCount }) }}</button>
          <button
            class="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded transition light:text-gray-600 light:hover:text-gray-800 light:border-gray-300"
            @click="emit('close')"
          >{{ t('cloneModal.cancel') }}</button>
        </template>

        <!-- Diff footer -->
        <template v-else-if="phase === 'diff'">
          <button
            v-if="cleanSiblings.length > 0 || conflictSiblings.length > 0"
            class="flex-1 py-2 text-sm bg-green-700 hover:bg-green-600 text-white rounded transition font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="selectedClean.size === 0"
            @click="applyClone"
          >{{ t('cloneModal.confirm', { n: selectedClean.size }) }}</button>
          <button
            class="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition light:text-gray-600 light:border-gray-300"
            @click="emit('close')"
          >{{ t('cloneModal.cancel') }}</button>
        </template>

        <!-- Done footer -->
        <template v-else-if="phase === 'done'">
          <button
            class="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition light:text-gray-600 light:border-gray-300"
            @click="emit('close')"
          >{{ t('cloneModal.close') }}</button>
        </template>

      </div>

    </div>
  </div>
</template>

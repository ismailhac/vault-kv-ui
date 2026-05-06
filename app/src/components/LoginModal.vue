<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useVaultStore } from '../stores/vault'
import type { NamespaceOption } from '../stores/vault'

const emit = defineEmits<{ close: [] }>()
const vault = useVaultStore()

// ── Top-level step ────────────────────────────────────────────────────────────
type Step = 'setup' | 'login'
const step = ref<Step>(vault.showSetupStep || !vault.isConfigured ? 'setup' : 'login')

// ── Setup wizard sub-steps ────────────────────────────────────────────────────
type SetupSub = 'org' | 'mount' | 'namespaces'
const setupSub = ref<SetupSub>(
  vault.isConfigured && vault.showSetupStep ? 'org' : 'org'
)

function buildUrl(org: string) {
  return org.trim() ? `https://vault.factory.${org.trim()}.cloud` : ''
}
function extractOrg(url: string) {
  return url.match(/^https?:\/\/vault\.factory\.(.+?)\.cloud\/?$/)?.[1] ?? ''
}

const setupOrg      = ref(extractOrg(vault.vaultAddr || ''))
const setupVaultAddr = ref(vault.vaultAddr || '')
const setupMount    = ref(vault.currentMount || 'secret')
const setupNamespaces = ref<Array<{ label: string; namespace: string }>>(
  vault.namespaces.length > 0
    ? vault.namespaces.map(n => ({ label: n.label, namespace: n.namespace }))
    : []
)
const setupSaving   = ref(false)
const setupError    = ref<string | null>(null)

function onOrgInput() {
  setupVaultAddr.value = buildUrl(setupOrg.value)
}

function confirmOrg() {
  if (!setupOrg.value.trim()) {
    setupError.value = 'Le nom de l\'organisation est requis'
    return
  }
  setupError.value = null
  setupSub.value = 'mount'
}

function addNamespaceRow() {
  setupNamespaces.value.push({ label: '', namespace: '' })
}

function removeNamespaceRow(i: number) {
  setupNamespaces.value.splice(i, 1)
}

async function saveSetup() {
  setupError.value = null
  setupSaving.value = true
  try {
    const nsList: NamespaceOption[] = setupNamespaces.value
      .filter(n => n.label.trim() || n.namespace.trim())
      .map(n => ({
        id: n.label.trim().toLowerCase().replace(/\s+/g, '-') || n.namespace.trim().replace(/\//g, '-'),
        label: n.label.trim() || n.namespace.trim(),
        namespace: n.namespace.trim(),
      }))
    if (nsList.length === 0) {
      throw new Error('Au moins un namespace est requis pour se connecter')
    }
    await vault.saveAppConfig({
      vaultAddr: setupVaultAddr.value.trim(),
      namespaces: nsList,
      mount: setupMount.value.trim() || 'secret',
    })
    vault.currentNamespace = nsList[0].namespace
    vault.showSetupStep = false
    step.value = 'login'
  } catch (e: unknown) {
    setupError.value = e instanceof Error ? e.message : 'Erreur de sauvegarde'
  } finally {
    setupSaving.value = false
  }
}

function goToSetup() {
  stopPolling()
  loginState.value = 'idle'
  errorMsg.value = null
  authUrl.value = null
  setupOrg.value = extractOrg(vault.vaultAddr || '')
  setupVaultAddr.value = vault.vaultAddr || ''
  setupMount.value = vault.currentMount || 'secret'
  setupNamespaces.value = vault.namespaces.length > 0
    ? vault.namespaces.map(n => ({ label: n.label, namespace: n.namespace }))
    : []
  setupSub.value = 'org'
  step.value = 'setup'
}

// ── Login step ────────────────────────────────────────────────────────────────
type LoginState = 'idle' | 'connecting' | 'waiting' | 'error'
const loginState = ref<LoginState>('idle')
const authUrl = ref<string | null>(null)
const errorMsg = ref<string | null>(null)
const copied = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

// Track user's explicit namespace selection (can differ from vault.currentNamespace)
const selectedLoginNs = ref('')

// Active login namespace: explicit selection → current namespace → first configured namespace
const loginNs = computed(() => {
  return selectedLoginNs.value || vault.currentNamespace || vault.namespaces[0]?.namespace || ''
})

const vaultUiUrl = computed(() => {
  if (!vault.vaultAddr) return ''
  const base = vault.vaultAddr.replace(/\/$/, '')
  return `${base}/ui/vault/auth?namespace=${encodeURIComponent(loginNs.value)}&with=oidc`
})

const namespaceLabel = computed(
  () => (vault.namespaces.find(n => n.namespace === loginNs.value)?.label ?? loginNs.value) || '(racine)'
)

async function startLogin() {
  loginState.value = 'connecting'
  errorMsg.value = null
  authUrl.value = null
  showTokenInput.value = false
  try {
    const result = await vault.startLogin(loginNs.value)
    authUrl.value = result.authUrl
    loginState.value = 'waiting'
    window.open(result.authUrl, '_blank', 'noopener,noreferrer')
    pollTimer = setInterval(poll, 2000)
  } catch (e: unknown) {
    loginState.value = 'error'
    errorMsg.value = e instanceof Error ? e.message : 'Erreur de démarrage'
  }
}

async function poll() {
  try {
    const result = await vault.pollLogin(loginNs.value)
    if (result.status === 'done' && result.tokenStatus) {
      stopPolling()
      vault.tokenStatus = result.tokenStatus
      vault.tokenError = null
      vault.currentNamespace = loginNs.value
      try { localStorage.setItem('vault-namespace', loginNs.value) } catch {}
      vault.showLoginModal = false
      await vault.listPath('')
    } else if (result.status === 'error') {
      stopPolling()
      loginState.value = 'error'
      errorMsg.value = result.error ?? 'Erreur inconnue'
    }
  } catch {}
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function copyUrl() {
  if (!authUrl.value) return
  await navigator.clipboard.writeText(authUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

async function switchLoginNs(ns: string) {
  selectedLoginNs.value = ns
  stopPolling()
  loginState.value = 'connecting'
  errorMsg.value = null
  authUrl.value = null
  showTokenInput.value = false

  // Check if we already have a valid token for this namespace before trying OIDC
  try {
    const res = await fetch(`/api/status?${new URLSearchParams({ namespace: ns })}`)
    if (res.ok) {
      const status = await res.json()
      if (status && status.ttl > 0) {
        vault.currentNamespace = ns
        vault.tokenStatus = status
        vault.tokenError = null
        try { localStorage.setItem('vault-namespace', ns) } catch {}
        vault.showLoginModal = false
        await vault.listPath('')
        return
      }
    }
  } catch {}

  startLogin()
}

// Manual token entry
const showTokenInput = ref(false)
const manualToken = ref('')
const tokenSubmitting = ref(false)
const tokenInputError = ref<string | null>(null)

async function submitToken() {
  if (!manualToken.value.trim()) return
  tokenSubmitting.value = true
  tokenInputError.value = null
  try {
    await vault.setToken(manualToken.value.trim(), loginNs.value)
    vault.showLoginModal = false
    await vault.listPath('')
  } catch (e: unknown) {
    tokenInputError.value = e instanceof Error ? e.message : 'Token invalide'
  } finally {
    tokenSubmitting.value = false
  }
}

function close() {
  stopPolling()
  vault.showSetupStep = false
  emit('close')
}

onUnmounted(stopPolling)
</script>

<template>
  <div
    class="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"
    @click.self="close"
  >
    <div class="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-lg shadow-2xl">

      <!-- ── SETUP STEP ─────────────────────────────────────────────────────── -->
      <template v-if="step === 'setup'">

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <h2 class="text-white font-semibold text-sm">⚙ Configuration Vault</h2>
            <!-- Progress breadcrumb -->
            <div class="flex items-center gap-1.5 mt-1">
              <span
                class="text-xs px-1.5 py-0.5 rounded"
                :class="setupSub === 'org' ? 'bg-green-800 text-green-200' : 'text-gray-500'"
              >1 · Organisation</span>
              <span class="text-gray-700 text-xs">›</span>
              <span
                class="text-xs px-1.5 py-0.5 rounded"
                :class="setupSub === 'mount' ? 'bg-green-800 text-green-200' : 'text-gray-500'"
              >2 · KV Mount</span>
              <span class="text-gray-700 text-xs">›</span>
              <span
                class="text-xs px-1.5 py-0.5 rounded"
                :class="setupSub === 'namespaces' ? 'bg-green-800 text-green-200' : 'text-gray-500'"
              >3 · Namespaces</span>
            </div>
          </div>
          <button class="text-gray-500 hover:text-gray-300 text-lg leading-none" @click="close">✕</button>
        </div>

        <!-- ── Sub-step 1: Organisation ── -->
        <div v-if="setupSub === 'org'" class="px-5 py-5 space-y-4">

          <div class="space-y-2">
            <label class="block text-gray-300 text-xs font-semibold">Organisation</label>
            <div class="flex items-center">
              <span class="px-3 py-2 bg-gray-800 border border-r-0 border-gray-700 text-gray-500 text-xs rounded-l select-none whitespace-nowrap">https://vault.factory.</span>
              <input
                v-model="setupOrg"
                type="text"
                placeholder="company"
                class="w-32 px-3 py-2 bg-gray-950 border-y border-gray-700 text-green-300 text-sm font-mono focus:outline-none focus:border-y-green-600 placeholder-gray-600"
                @input="onOrgInput"
                @keydown.enter="confirmOrg"
                autofocus
              />
              <span class="px-3 py-2 bg-gray-800 border border-l-0 border-gray-700 text-gray-500 text-xs rounded-r select-none whitespace-nowrap">.cloud</span>
            </div>
            <p class="text-gray-600 text-xs">Nom de votre organisation (ex : <code class="text-gray-500">company</code>)</p>
          </div>

          <!-- Live URL preview -->
          <div v-if="setupVaultAddr" class="flex items-center gap-2 bg-gray-800 rounded px-3 py-2">
            <span class="text-gray-500 text-xs shrink-0">URL :</span>
            <span class="text-green-400 font-mono text-xs truncate">{{ setupVaultAddr }}</span>
          </div>

          <div v-if="setupError" class="bg-red-950 border border-red-800 rounded px-3 py-2 text-red-300 text-xs">
            ⚠ {{ setupError }}
          </div>

          <button
            class="w-full px-4 py-2.5 bg-green-700 hover:bg-green-600 disabled:opacity-40 cursor-pointer text-white rounded font-semibold text-sm transition"
            :disabled="!setupOrg.trim()"
            @click="confirmOrg"
          >
            Confirmer →
          </button>
        </div>

        <!-- ── Sub-step 2: KV Mount ── -->
        <div v-else-if="setupSub === 'mount'" class="px-5 py-5 space-y-4">

          <!-- Confirmed URL badge -->
          <div class="flex items-center gap-2 bg-gray-800 rounded px-3 py-2 text-xs">
            <span class="text-gray-500">Vault</span>
            <span class="text-green-400 font-mono truncate">{{ setupVaultAddr }}</span>
          </div>

          <div class="space-y-1.5">
            <label class="block text-gray-300 text-xs font-semibold">KV Mount</label>
            <input
              v-model="setupMount"
              type="text"
              placeholder="secret"
              class="w-full px-3 py-2 bg-gray-950 border border-gray-700 text-gray-100 text-sm rounded focus:outline-none focus:border-green-600 placeholder-gray-600"
              @keydown.enter="setupSub = 'namespaces'"
            />
            <p class="text-gray-600 text-xs">Nom du moteur KV v2 — généralement <code class="text-gray-500">secret</code></p>
          </div>

          <div class="flex gap-2">
            <button
              class="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition"
              @click="setupSub = 'org'"
            >← Retour</button>
            <button
              class="flex-1 px-4 py-2 bg-green-700 hover:bg-green-600 text-white rounded font-semibold text-sm transition"
              @click="setupSub = 'namespaces'"
            >Suivant →</button>
          </div>
        </div>

        <!-- ── Sub-step 3: Namespaces ── -->
        <div v-else-if="setupSub === 'namespaces'" class="px-5 py-5 space-y-4">

          <!-- Summary badges -->
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="bg-gray-800 rounded px-2 py-1 text-green-400 font-mono truncate max-w-[220px]">{{ setupVaultAddr }}</span>
            <span class="bg-gray-800 rounded px-2 py-1 text-gray-400">mount: <span class="text-purple-300">{{ setupMount || 'secret' }}</span></span>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="block text-gray-300 text-xs font-semibold">
                Namespaces <span class="text-red-400">*</span>
              </label>
              <button
                type="button"
                class="text-xs text-green-500 hover:text-green-400 transition"
                @click="addNamespaceRow"
              >+ Ajouter</button>
            </div>

            <div v-if="setupNamespaces.length > 0" class="space-y-2 max-h-48 overflow-y-auto pr-1">
              <div
                v-for="(ns, i) in setupNamespaces"
                :key="i"
                class="flex gap-2 items-center"
              >
                <input
                  v-model="ns.label"
                  type="text"
                  placeholder="Libellé"
                  class="w-1/3 px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-100 text-xs rounded focus:outline-none focus:border-green-600 placeholder-gray-600"
                />
                <input
                  v-model="ns.namespace"
                  type="text"
                  placeholder="org/team/namespace"
                  class="flex-1 min-w-0 px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-100 text-xs font-mono rounded focus:outline-none focus:border-green-600 placeholder-gray-600"
                />
                <button
                  type="button"
                  class="shrink-0 text-gray-600 hover:text-red-400 transition text-sm leading-none"
                  @click="removeNamespaceRow(i)"
                >✕</button>
              </div>
            </div>
            <p v-else class="text-gray-600 text-xs">Au moins un namespace est requis</p>
          </div>

          <div v-if="setupError" class="bg-red-950 border border-red-800 rounded px-3 py-2 text-red-300 text-xs">
            ⚠ {{ setupError }}
          </div>

          <div class="flex gap-2">
            <button
              class="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-sm transition"
              :disabled="setupSaving"
              @click="setupSub = 'mount'"
            >← Retour</button>
            <button
              class="flex-1 px-4 py-2.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded font-semibold text-sm transition"
              :disabled="setupSaving"
              @click="saveSetup"
            >
              <span v-if="setupSaving" class="inline-flex items-center gap-2">
                <span class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                Enregistrement…
              </span>
              <span v-else>Enregistrer &amp; se connecter →</span>
            </button>
          </div>
        </div>

      </template>

      <!-- ── LOGIN STEP ─────────────────────────────────────────────────────── -->
      <template v-else>

        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <h2 class="text-white font-semibold text-sm">🔑 Connexion Vault — OIDC</h2>
            <p class="text-gray-500 text-xs mt-0.5">
              Namespace :
              <span class="text-purple-300 font-mono">{{ namespaceLabel || '(racine)' }}</span>
            </p>
          </div>
          <button class="text-gray-500 hover:text-gray-300 text-lg leading-none" @click="close">✕</button>
        </div>

        <!-- Body -->
        <div class="px-5 py-5 space-y-4">

          <!-- idle -->
          <div v-if="loginState === 'idle'" class="space-y-4 text-center">
            <p class="text-gray-400 text-sm">
              Un onglet va s'ouvrir vers votre fournisseur d'identité.<br>
              Connectez-vous, puis revenez ici.
            </p>
            <!-- Namespace selector -->
            <div v-if="vault.namespaces.length > 1" class="space-y-2">
              <p class="text-gray-500 text-xs">Sélectionner le namespace :</p>
              <div class="flex flex-wrap gap-2 justify-center">
                <button
                  v-for="ns in vault.namespaces"
                  :key="ns.namespace"
                  class="text-xs px-3 py-1.5 rounded font-semibold border transition"
                  :class="ns.namespace === loginNs
                    ? 'bg-green-900 text-green-200 border-green-600'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:bg-gray-700 hover:border-gray-500 cursor-pointer'"
                  @click="loginNs = ns.namespace"
                >{{ ns.label || ns.namespace }}</button>
              </div>
            </div>
            <button
              class="w-full px-4 py-2.5 bg-green-700 hover:bg-green-600 text-white rounded font-semibold text-sm transition cursor-pointer"
              @click="startLogin"
            >
              🌐 Ouvrir la page de connexion Vault
            </button>
          </div>

          <!-- connecting -->
          <div v-else-if="loginState === 'connecting'" class="text-center space-y-3">
            <div class="flex justify-center">
              <div class="w-8 h-8 border-2 border-gray-600 border-t-green-400 rounded-full animate-spin"></div>
            </div>
            <p class="text-gray-400 text-sm">Démarrage de vault CLI…</p>
          </div>

          <!-- waiting for browser auth -->
          <div v-else-if="loginState === 'waiting'" class="space-y-4">
            <div class="flex items-start gap-2 bg-green-950 border border-green-800 rounded px-3 py-2 text-green-300 text-xs">
              <span class="mt-0.5 shrink-0">✓</span>
              <span>Page d'autorisation ouverte dans un nouvel onglet. Connectez-vous, puis revenez ici.</span>
            </div>
            <div class="space-y-1">
              <p class="text-gray-500 text-xs">Si l'onglet ne s'est pas ouvert :</p>
              <div class="flex gap-2">
                <input
                  :value="authUrl"
                  readonly
                  class="flex-1 min-w-0 px-2 py-1.5 bg-gray-950 border border-gray-700 text-blue-300 text-xs font-mono rounded truncate focus:outline-none"
                />
                <button
                  class="shrink-0 px-2 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded border border-gray-600"
                  @click="copyUrl"
                >{{ copied ? '✓' : 'Copier' }}</button>
                <a
                  :href="authUrl ?? '#'"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="shrink-0 px-2 py-1.5 text-xs bg-blue-800 hover:bg-blue-700 text-white rounded"
                >Ouvrir</a>
              </div>
            </div>
            <div class="flex items-center gap-2 text-gray-400 text-xs">
              <div class="w-4 h-4 border-2 border-gray-600 border-t-green-400 rounded-full animate-spin shrink-0"></div>
              En attente de l'authentification…
            </div>
            <button class="text-xs text-gray-500 hover:text-gray-300 underline" @click="close">Annuler</button>
          </div>

          <!-- error -->
          <div v-else-if="loginState === 'error'" class="space-y-4">
            <!-- Error banner -->
            <div class="bg-red-950 border border-red-800 rounded px-3 py-2 text-red-300 text-xs font-mono break-all">
              ⚠ {{ errorMsg }}
            </div>

            <!-- Namespace picker — try another namespace -->
            <div v-if="vault.namespaces.length > 1" class="space-y-2">
              <p class="text-gray-500 text-xs">Essayer avec un autre namespace :</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="ns in vault.namespaces"
                  :key="ns.namespace"
                  class="text-xs px-3 py-1.5 rounded font-semibold border transition cursor-pointer"
                  :class="ns.namespace === loginNs
                    ? 'bg-purple-900 text-purple-200 border-purple-600'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:bg-gray-700 hover:border-gray-500'"
                  @click="switchLoginNs(ns.namespace)"
                >{{ ns.label || ns.namespace }}</button>
              </div>
            </div>

            <!-- Vault UI fallback — open web UI, authenticate, paste token -->
            <div class="border border-gray-700 rounded-lg p-3 space-y-3 bg-gray-800/40">
              <p class="text-gray-400 text-xs leading-relaxed">
                Connectez-vous via l'interface web Vault, puis copiez et collez votre token :
              </p>
              <a
                v-if="vaultUiUrl"
                :href="vaultUiUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center justify-center gap-2 w-full px-3 py-2 bg-indigo-800 hover:bg-indigo-700 text-indigo-100 rounded text-xs font-semibold transition"
                @click="showTokenInput = true"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
                Ouvrir Vault UI (OIDC)
              </a>
              <template v-if="showTokenInput">
                <p class="text-gray-500 text-xs">Après connexion, copiez votre token depuis Vault UI et collez-le ici :</p>
                <div class="flex gap-2">
                  <input
                    v-model="manualToken"
                    type="password"
                    placeholder="hvs.XXXXXXXXXXXXXXXX"
                    class="flex-1 min-w-0 px-2 py-1.5 bg-gray-950 border border-gray-700 text-gray-200 text-xs font-mono rounded focus:outline-none focus:border-green-600"
                    @keydown.enter="submitToken"
                    autofocus
                  />
                  <button
                    class="shrink-0 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded transition"
                    :disabled="tokenSubmitting || !manualToken.trim()"
                    @click="submitToken"
                  >{{ tokenSubmitting ? '…' : 'Valider' }}</button>
                </div>
                <p v-if="tokenInputError" class="text-red-400 text-xs">{{ tokenInputError }}</p>
              </template>
              <button
                v-else
                class="text-xs text-gray-600 hover:text-gray-400 transition underline"
                @click="showTokenInput = true"
              >J'ai déjà un token</button>
            </div>

            <!-- Retry button -->
            <button
              class="w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm"
              @click="startLogin"
            >
              Réessayer ({{ namespaceLabel }})
            </button>
          </div>

          <!-- Footer link to setup -->
          <div class="pt-1 border-t border-gray-800 text-center">
            <button
              class="text-xs text-gray-500 hover:text-gray-300 transition"
              @click="goToSetup"
            >
              ⚙ Modifier la configuration
            </button>
          </div>

        </div>
      </template>

    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useVaultStore } from './stores/vault'
import { useLocale } from './composables/useLocale'
import TokenStatusBar from './components/TokenStatusBar.vue'
import LoadingSpinner from './components/LoadingSpinner.vue'
import LoginModal from './components/LoginModal.vue'

const { t } = useI18n()
const { locale, setLocale } = useLocale()

const vault = useVaultStore()
const router = useRouter()
const homeRefreshKey = ref(0)

onMounted(() => {
  vault.initializeApp()
})

async function handleGoHome() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vault-go-home'))
  }
  vault.goHome()
  homeRefreshKey.value += 1
  await router.push('/')
}

function handleRetry() {
  vault.retryInitialization()
}

function handleManualLogin() {
  vault.showLoginModal = true
}
</script>

<template>
  <div class="min-h-screen bg-gray-950 text-gray-100 font-mono flex flex-col">

    <!-- Init overlay -->
    <LoadingSpinner
      v-if="!vault.isInitialized"
      :status="vault.initStatus"
      :message="vault.initStatus === 'loading' ? t('loadingSpinner.verifyingToken') : t('loadingSpinner.authSuccess')"
      :error="vault.initError || ''"
      :on-retry="vault.initStatus === 'error' ? handleRetry : undefined"
      :on-manual-login="vault.initStatus === 'error' ? handleManualLogin : undefined"
    />

    <!-- Login modal -->
    <LoginModal v-if="vault.showLoginModal" @close="vault.showLoginModal = false" />

    <!-- Main app -->
    <template v-if="vault.isInitialized">

      <!-- Full-screen landing when not authenticated — no chrome -->
      <template v-if="!vault.isAuthenticated">
        <RouterView :key="homeRefreshKey" />
      </template>

      <!-- Normal layout with header + footer when authenticated -->
      <template v-else>

      <!-- ── Header ── -->
      <header class="border-b border-gray-800 px-4 h-12 flex items-center gap-3">

        <!-- Branding -->
        <button
          type="button"
          class="flex items-center gap-2 group shrink-0 cursor-pointer"
          @click="handleGoHome"
        >
          <span class="text-green-400 text-xl font-bold leading-none group-hover:text-green-300 transition select-none">⬡</span>
          <span class="text-white font-bold text-sm tracking-wide group-hover:text-green-300 transition whitespace-nowrap">{{ t('app.vaultAdmin') }}</span>
        </button>

        <!-- Divider -->
        <span class="text-gray-700 shrink-0 select-none">|</span>

        <!-- Token status — takes remaining space, clips overflow -->
        <div class="flex-1 min-w-0 overflow-hidden">
          <TokenStatusBar />
        </div>

        <!-- Right zone -->
        <div class="flex items-center gap-1 shrink-0 ml-2">

          <!-- Language pills -->
          <button
            type="button"
            class="px-2 py-0.5 rounded text-xs font-bold transition cursor-pointer"
            :class="locale === 'en' ? 'bg-green-800 text-green-200' : 'text-gray-500 hover:text-gray-300'"
            @click="setLocale('en')"
          >{{ t('app.langEn') }}</button>
          <button
            type="button"
            class="px-2 py-0.5 rounded text-xs font-bold transition cursor-pointer"
            :class="locale === 'fr' ? 'bg-green-800 text-green-200' : 'text-gray-500 hover:text-gray-300'"
            @click="setLocale('fr')"
          >{{ t('app.langFr') }}</button>

          <!-- Divider -->
          <span class="text-gray-700 mx-1 select-none">|</span>

          <!-- Config / reconnect -->
          <button
            type="button"
            class="flex items-center justify-center p-1.5 rounded transition cursor-pointer text-gray-500 hover:text-gray-200 hover:bg-gray-800"
            :title="t('app.configTitle')"
            @click="vault.showSetupStep = true; vault.showLoginModal = true"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 0 1 21.75 8.25Z" />
            </svg>
          </button>

          <!-- Admin panel -->
          <RouterLink
            to="/admin"
            class="flex items-center justify-center p-1.5 rounded transition"
            :class="$route.path === '/admin' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'"
            :title="t('app.adminDashboardTitle')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
          </RouterLink>

        </div>

      </header>

      <!-- ── Content ── -->
      <main class="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <RouterView :key="homeRefreshKey" />
      </main>


      <!-- ── Footer ── -->
      <footer class="border-t border-gray-800 px-6 py-3 mt-4">
        <div class="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 text-gray-600 text-xs">
          <div class="flex items-center gap-2">
            <span class="text-green-700 font-bold">⬡ {{ t('app.vaultAdmin') }}</span>
            <span v-if="vault.appVersion">v{{ vault.appVersion }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span>{{ t('app.builtWith') }}</span>
            <span class="text-gray-700">·</span>
            <span>{{ t('app.by') }} <span class="text-gray-400">Ismail</span></span>
            <span class="text-gray-700">·</span>
            <span>{{ new Date().getFullYear() }}</span>
          </div>
        </div>
      </footer>

      </template><!-- end authenticated layout -->
    </template><!-- end isInitialized -->
  </div>
</template>

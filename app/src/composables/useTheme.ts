import { ref, computed } from 'vue'

type Theme = 'dark' | 'light'
const THEME_KEY = 'vault-theme'

// Injected as a <style> tag so Tailwind/Lightning CSS never processes or purges it.
const LIGHT_CSS = `
html.light {
  color-scheme: light;
  --color-gray-950: #f9fafb;
  --color-gray-900: #f3f4f6;
  --color-gray-800: #e5e7eb;
  --color-gray-700: #d1d5db;
  --color-gray-600: #9ca3af;
  --color-gray-500: #6b7280;
  --color-gray-400: #4b5563;
  --color-gray-300: #374151;
  --color-gray-200: #1f2937;
  --color-gray-100: #111827;
  --color-gray-50:  #030712;
}
`

function ensureStyleInjected() {
  if (document.getElementById('vault-light-theme')) return
  const el = document.createElement('style')
  el.id = 'vault-light-theme'
  el.textContent = LIGHT_CSS
  document.head.appendChild(el)
}

function readSaved(): Theme {
  try { return (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'dark' } catch { return 'dark' }
}

function applyTheme(t: Theme) {
  ensureStyleInjected()
  document.documentElement.classList.toggle('light', t === 'light')
}

const theme = ref<Theme>(readSaved())

// Apply synchronously on module load — prevents flash before first Vue render
if (typeof document !== 'undefined') applyTheme(theme.value)

export function useTheme() {
  const isDark = computed(() => theme.value === 'dark')

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_KEY, theme.value)
    applyTheme(theme.value)
  }

  return { isDark, theme, toggle }
}

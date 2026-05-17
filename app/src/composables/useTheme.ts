import { ref, computed } from 'vue'

type Theme = 'dark' | 'light'
const THEME_KEY = 'vault-theme'

function readSaved(): Theme {
  try { return (localStorage.getItem(THEME_KEY) as Theme | null) ?? 'dark' } catch { return 'dark' }
}

function applyTheme(t: Theme) {
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

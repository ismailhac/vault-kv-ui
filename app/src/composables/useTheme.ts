import { ref, watchEffect } from 'vue'

type Theme = 'dark' | 'light'

const theme = ref<Theme>((localStorage.getItem('vault-theme') as Theme) ?? 'dark')

watchEffect(() => {
  document.documentElement.classList.toggle('light', theme.value === 'light')
  localStorage.setItem('vault-theme', theme.value)
})

export function useTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }
  return { theme, toggleTheme }
}

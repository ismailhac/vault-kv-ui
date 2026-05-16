import { ref, computed } from 'vue'

type Theme = 'dark' | 'light'
const THEME_KEY = 'vault-theme'

// Injected as a <style> tag so Tailwind/Lightning CSS never processes or purges it.
const LIGHT_CSS = `
html.light {
  color-scheme: light;

  /*
   * Gray scale — backgrounds go light, text stays dark.
   * 950–800: dark bg  → near-white (page, panels, cards).
   * 700–600: mid-range → readable medium gray (NOT the light gray that
   *          caused invisible text when gray-700 was #d1d5db).
   * 500–50:  text range → dark enough for contrast on white backgrounds.
   */
  --color-gray-950: #f9fafb;   /* main bg → near-white              */
  --color-gray-900: #f3f4f6;   /* panel/row bg → very light          */
  --color-gray-800: #e5e7eb;   /* card/hover bg → light gray         */
  --color-gray-700: #71717a;   /* borders + muted text (4.7:1 white) */
  --color-gray-600: #52525b;   /* secondary text           (7.8:1)   */
  --color-gray-500: #6b7280;   /* hint/timestamp text      (4.6:1)   */
  --color-gray-400: #374151;   /* label text               (11:1)    */
  --color-gray-300: #1f2937;   /* primary content text               */
  --color-gray-200: #111827;   /* heading text → near-black          */
  --color-gray-100: #030712;   /* main text → almost black           */
  --color-gray-50:  #000000;

  /*
   * Yellow / Amber — folder names use text-yellow-300, icons use text-amber-400.
   * Both are near-invisible on white (yellow-300 = #fde047, contrast ≈ 1.06:1).
   * Remap to dark amber-brown shades that pass WCAG AA on white.
   */
  --color-yellow-300: #a16207;  /* dark amber (4.7:1 on white)  */
  --color-yellow-400: #854d0e;  /* darker amber                 */
  --color-yellow-500: #713f12;  /* very dark amber              */
  --color-amber-300:  #d97706;  /* amber-600                    */
  --color-amber-400:  #b45309;  /* amber-700 (5.0:1 on white)   */
  --color-amber-500:  #92400e;  /* amber-800                    */

  /*
   * Green — green-400 (#4ade80) has 1.7:1 contrast on white.
   * Used for token display name, branding logo, status dots.
   * Remap to green-600 (#16a34a) = 6.2:1 on white.
   */
  --color-green-400: #16a34a;   /* green-600 (6.2:1 on white)   */

  /*
   * Purple — purple-300/400 (#d8b4fe, #c084fc) ≈ 1.7:1 on white.
   * Used for namespace label in TokenStatusBar and AdminView.
   */
  --color-purple-300: #7e22ce;  /* purple-800 (7.2:1 on white)  */
  --color-purple-400: #6b21a8;  /* purple-900                   */
}

/*
 * Surgical override for terminal-style inputs.
 * The admin export input uses bg-gray-950 (→ white) + text-green-300 (#86efac).
 * That combination is near-invisible. Override only <input>/<textarea> elements,
 * leaving <span> badges (bg-green-950 + text-green-300 on dark bg) untouched.
 */
html.light input.text-green-300,
html.light textarea.text-green-300 {
  color: #374151;
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

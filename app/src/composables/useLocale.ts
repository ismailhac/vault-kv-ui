import { useI18n } from 'vue-i18n'

const LOCALE_KEY = 'vault-locale'

export function useLocale() {
  const { locale } = useI18n()

  function setLocale(lang: string) {
    locale.value = lang
    localStorage.setItem(LOCALE_KEY, lang)
  }

  return { locale, setLocale }
}

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import router from './router'
import './style.css'
import App from './App.vue'
import en from './locales/en.json'
import fr from './locales/fr.json'

const savedLocale = localStorage.getItem('vault-locale') ?? 'en'

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: { en, fr },
})

createApp(App).use(createPinia()).use(router).use(i18n).mount('#app')

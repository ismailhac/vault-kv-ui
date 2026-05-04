import { createRouter, createWebHistory } from 'vue-router'
import BrowserView from '../views/BrowserView.vue'
import AdminView from '../views/AdminView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: BrowserView },
    { path: '/admin', component: AdminView },
  ],
})

export default router

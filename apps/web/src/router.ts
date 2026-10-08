import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'main', component: () => import('./pages/MainShell.vue') },
  {
    path: '/device/:mac/plug',
    name: 'plug',
    component: () => import('./pages/PlugPage.vue'),
  },
  {
    path: '/device/:mac/settings',
    name: 'device-settings',
    component: () => import('./pages/DeviceSettingsPage.vue'),
  },
  {
    path: '/device/:mac/link',
    name: 'device-link',
    component: () => import('./pages/LinkPage.vue'),
  },
  { path: '/settings', name: 'settings', component: () => import('./pages/AppSettingsPage.vue') },
  { path: '/add', name: 'add', component: () => import('./pages/AddDevicePage.vue') },
  { path: '/sort', name: 'sort', component: () => import('./pages/SortPage.vue') },
  { path: '/about', name: 'about', component: () => import('./pages/AboutPage.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

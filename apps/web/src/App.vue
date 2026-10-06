<script setup lang="ts">
import { onMounted } from 'vue';
import { initSocket } from './composables/useSocket';
import { useAppStore } from './stores/app';
import { useDeviceStore } from './stores/devices';

const app = useAppStore();
const device = useDeviceStore();

onMounted(async () => {
  initSocket();
  await Promise.all([app.loadStatus(), app.loadSettings(), device.load()]);
});
</script>

<template>
  <router-view />
</template>

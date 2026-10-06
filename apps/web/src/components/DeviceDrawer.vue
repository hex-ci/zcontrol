<script setup lang="ts">
/**
 * 抽屉侧边栏：
 *   + 顶部项目标识（zControl Web / zM1 空气检测仪 Web 控制台）
 *   + 排序提示文字
 *   + 设备列表（当前项高亮；长按弹「配置设备:xx」确认删除）
 *   + 列表底部「增加设备」按钮
 *   + 底部两按钮：设置 / 关于
 */
import { computed, ref } from 'vue';
import { showConfirmDialog } from 'vant';
import { useDeviceStore } from '../stores/devices';

defineProps<{ activeMac: string }>();

const emit = defineEmits<{
  pick: [mac: string];
  add: [];
  settings: [];
  about: [];
  sort: [];
  remove: [mac: string];
}>();

const device = useDeviceStore();
const devices = computed(() => device.devices);

const PROJECT_URL = 'https://github.com/hex-ci/zcontrol';

function openProject() {
  window.open(PROJECT_URL, '_blank');
}

// region 长按删除设备
let pressTimer: number | null = null;
const suppressClick = ref(false);

function cancelPress() {
  if (pressTimer !== null) {
    window.clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function startPress(mac: string, name: string) {
  cancelPress();
  suppressClick.value = false;
  pressTimer = window.setTimeout(() => {
    pressTimer = null;
    suppressClick.value = true;
    void askRemove(mac, name);
  }, 600);
}

function endPress() {
  cancelPress();
}

async function askRemove(mac: string, name: string) {
  try {
    await showConfirmDialog({
      title: `配置设备:${name}`,
      message: '注意:重新配网设备无需删除设备',
      confirmButtonText: '删除设备',
      cancelButtonText: '取消',
    });
    emit('remove', mac);
  } catch {
    /* 用户取消 */
  }
}
// endregion

function pick(mac: string) {
  if (suppressClick.value) {
    suppressClick.value = false;
    return;
  }
  emit('pick', mac);
}
</script>

<template>
  <div class="flex h-full flex-col bg-white">
    <!-- nav header：项目标识（渐变背景） -->
    <div
      class="flex flex-col justify-end bg-gradient-to-br from-[#4DB6AC] via-[#009688] to-[#00695C] px-4 pt-6 pb-3 text-white"
    >
      <span class="text-lg font-semibold" data-testid="drawer-title">zControl Web</span>
      <span
        class="cursor-pointer text-xs underline opacity-90"
        data-testid="drawer-project"
        @click="openProject"
      >
        zM1 空气检测仪 Web 控制台
      </span>
    </div>

    <!-- 排序提示，点击进入排序页 -->
    <div
      class="cursor-pointer border-b border-gray-100 px-4 py-2 text-center text-xs text-gray-500"
      role="button"
      data-testid="drawer-sort-tip"
      @click="emit('sort')"
    >
      长按删除设备.点此设置排序
    </div>

    <!-- 设备列表 -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-for="d in devices"
        :key="d.mac"
        class="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-4 py-3"
        :class="d.mac === activeMac ? 'bg-[#3F51B5]/10' : 'bg-transparent'"
        :data-mac="d.mac"
        :data-testid="`drawer-device-${d.mac}`"
        @click="pick(d.mac)"
        @pointerdown="startPress(d.mac, d.name)"
        @pointerup="endPress"
        @pointerleave="endPress"
        @pointercancel="endPress"
      >
        <span
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          :class="d.mac === activeMac ? 'bg-[#3F51B5] text-white' : 'bg-gray-200 text-gray-500'"
        >
          <!-- zM1 空气检测仪占位图标 -->
          <van-icon name="chart-trending-o" size="18" />
        </span>
        <span
          class="truncate text-sm"
          :class="d.mac === activeMac ? 'font-medium text-[#3F51B5]' : 'text-gray-700'"
        >
          {{ d.name }}
        </span>
      </div>

      <div v-if="!devices.length" class="px-4 py-6 text-center text-sm text-gray-400">
        还没有设备
      </div>

      <!-- 列表底部「增加设备」按钮 -->
      <button
        class="w-full px-4 py-3 text-left text-sm text-[#3F51B5]"
        data-testid="drawer-add"
        @click="emit('add')"
      >
        增加设备
      </button>
    </div>

    <!-- 底部两按钮：设置 / 关于 -->
    <div class="grid grid-cols-2 border-t border-gray-200">
      <button class="py-3 text-center text-sm text-gray-600" data-testid="drawer-settings" @click="emit('settings')">
        设置
      </button>
      <button
        class="border-l border-gray-200 py-3 text-center text-sm text-gray-600"
        data-testid="drawer-about"
        @click="emit('about')"
      >
        关于
      </button>
    </div>
  </div>
</template>

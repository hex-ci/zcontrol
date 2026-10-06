<script setup lang="ts">
/**
 * 设备排序页（提示「长按拖动排序」+ 列表项）。
 * 拖动用 sortablejs；同时提供上/下移按钮。保存时 PUT /devices/order。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showSuccessToast, showToast } from 'vant';
// sortablejs 未随包提供 TS 类型
// @ts-ignore
import Sortable from 'sortablejs';
import AppNavBar from '../components/AppNavBar.vue';
import type { DeviceDTO } from '../api';
import { useDeviceStore } from '../stores/devices';

const router = useRouter();
const device = useDeviceStore();

const list = ref<DeviceDTO[]>([]);
const listEl = ref<HTMLElement | null>(null);
const saving = ref(false);
const dirty = ref(false);
let sortable: Sortable | null = null;

/** 设备列表就绪前保持与 store 同步；用户拖动/移动后不再覆盖 */
watch(
  () => device.devices,
  (d) => {
    if (!dirty.value) list.value = [...d];
  },
  { immediate: true, deep: true },
);

onMounted(async () => {
  if (!device.devices.length) {
    try {
      await device.load();
    } catch {
      /* 后端不可用时忽略 */
    }
  }
  list.value = [...device.devices];

  await nextTick();
  if (listEl.value) {
    sortable = Sortable.create(listEl.value, {
      animation: 150,
      handle: '.sort-handle',
      onEnd: (evt) => {
        const from = evt.oldIndex;
        const to = evt.newIndex;
        if (from == null || to == null || from === to) return;
        const arr = list.value.slice();
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        list.value = arr;
        dirty.value = true;
      },
    });
  }
});

onBeforeUnmount(() => {
  sortable?.destroy();
  sortable = null;
});

function move(index: number, dir: -1 | 1) {
  const j = index + dir;
  if (j < 0 || j >= list.value.length) return;
  const arr = list.value.slice();
  const tmp = arr[index];
  arr[index] = arr[j];
  arr[j] = tmp;
  list.value = arr;
  dirty.value = true;
}

async function save() {
  saving.value = true;
  try {
    await device.reorder(list.value.map((d) => d.mac));
    showSuccessToast('保存成功');
    router.push('/');
  } catch (e) {
    showToast(String((e as Error).message));
  } finally {
    saving.value = false;
  }
}

function back() {
  router.back();
}
</script>

<template>
  <div class="flex min-h-full flex-col bg-gray-50">
    <AppNavBar title="排序" back @back="back" />

    <p class="py-2 text-center text-xs text-gray-400" data-testid="sort-tip">
      长按拖动排序,或点击箭头调整顺序
    </p>

    <div ref="listEl" class="flex flex-1 flex-col gap-2 px-4">
      <div
        v-for="(d, i) in list"
        :key="d.mac"
        class="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-3"
        :data-testid="`sort-row-${d.mac}`"
      >
        <span class="sort-handle cursor-move text-gray-400" aria-label="拖动">⠿</span>
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-[#3F51B5] text-xs text-white">
          {{ i + 1 }}
        </span>
        <span class="flex-1 truncate text-sm text-gray-800">{{ d.name }}</span>
        <button
          class="px-2 text-gray-500 disabled:text-gray-200"
          :disabled="i === 0"
          :data-testid="`sort-up-${d.mac}`"
          @click="move(i, -1)"
        >
          <van-icon name="arrow-up" />
        </button>
        <button
          class="px-2 text-gray-500 disabled:text-gray-200"
          :disabled="i === list.length - 1"
          :data-testid="`sort-down-${d.mac}`"
          @click="move(i, 1)"
        >
          <van-icon name="arrow-down" />
        </button>
      </div>

      <div v-if="!list.length" class="py-8 text-center text-sm text-gray-400">没有设备</div>
    </div>

    <div class="p-4">
      <van-button block type="primary" color="#3F51B5" :loading="saving" data-testid="sort-save" @click="save">
        保存
      </van-button>
    </div>
  </div>
</template>

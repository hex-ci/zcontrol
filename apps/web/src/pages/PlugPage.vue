<script setup lang="ts">
/**
 * 亮度定时页（zM1）
 *
 * 结构：
 *   顶部工具栏（返回主界面）
 *   van-pull-refresh
 *     ├─ 标题「定时任务」
 *     ├─ 5 行任务列表（task_0..task_4，第 5 组 task_4 被倒计时占用）
 *     │    每行：时间 %02d:%02d（大字号）/ 动作文字 / van-switch
 *     │    行点击 → 设置定时任务弹窗；开关点击 → 立即下发该组
 *     └─ 「设置倒计时」按钮 → 倒计时弹窗（固定 task_4）
 *
 * 数据来源：useDeviceStore().byMac(mac).state.tasks；未获取到为 null → 显示占位，不编造值。
 * 所有下发统一走 useDeviceStore().sendCmd（页面不直接 fetch）。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import AppNavBar from '../components/AppNavBar.vue';
import TaskEditPopup from '../components/TaskEditPopup.vue';
import CountDownPopup from '../components/CountDownPopup.vue';
import type { Zm1Task } from '../api';
import { useAppStore } from '../stores/app';
import { useDeviceStore } from '../stores/devices';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const device = useDeviceStore();

const mac = computed(() => String(route.params.mac));
const current = computed(() => device.byMac(mac.value));
const title = computed(() => (current.value ? `${current.value.name} 亮度定时` : '亮度定时'));

/** 5 组任务；未获取到为 null（列表显示占位） */
const tasks = ref<(Zm1Task | null)[]>([null, null, null, null, null]);
const storeTasks = computed(() => current.value?.state?.tasks ?? null);

watch(
  storeTasks,
  (list) => {
    tasks.value = Array.from({ length: 5 }, (_, i) => list?.[i] ?? null);
  },
  { immediate: true, deep: true },
);

const refreshing = ref(false);

const pad = (n: number) => String(n).padStart(2, '0');
/** 时间文本 "%02d:%02d" */
const timeText = (t: Zm1Task | null) => (t ? `${pad(t.hour)}:${pad(t.minute)}` : '--:--');
/** 动作文本：action != 0 ? "亮度:"+action : "关屏" */
const actionText = (t: Zm1Task | null) =>
  t ? (t.brightness !== 0 ? `亮度:${t.brightness}` : '关屏') : '--';

/** 查询 5 组定时任务 */
async function queryTasks() {
  try {
    await device.sendCmd(mac.value, {
      task_0: {},
      task_1: {},
      task_2: {},
      task_3: {},
      task_4: {},
    });
  } catch (e) {
    showToast((e as Error).message);
  }
}

/** 下发某一组任务 */
async function sendTask(index: number, task: Zm1Task) {
  try {
    await device.sendCmd(mac.value, {
      [`task_${index}`]: {
        hour: task.hour,
        minute: task.minute,
        brightness: task.brightness,
        on: task.on,
      },
    });
  } catch (e) {
    showToast((e as Error).message);
    throw e;
  }
}

/** 行开关点击：立即下发该组（on 取开关勾选态） */
async function onToggle(index: number, checked: boolean) {
  const task = tasks.value[index];
  if (!task) return; // 未获取到数据时不编造下发
  const prev = task;
  const next: Zm1Task = { ...task, on: checked ? 1 : 0 };
  tasks.value[index] = next; // 乐观更新，失败回滚
  try {
    await sendTask(index, next);
  } catch {
    tasks.value[index] = prev;
  }
}

/** 弹窗：设置定时任务 */
const editShow = ref(false);
const editIndex = ref(0);
const editTask = computed<Zm1Task | null>(() => tasks.value[editIndex.value] ?? null);

function openEdit(index: number) {
  editIndex.value = index;
  editShow.value = true;
}

/** 确认定时任务：on 恒为 1 */
async function onEditConfirm(payload: { hour: number; minute: number; brightness: number }) {
  try {
    await device.sendCmd(mac.value, {
      [`task_${editIndex.value}`]: { ...payload, on: 1 },
    });
  } catch (e) {
    showToast((e as Error).message);
  }
}

/** 弹窗：设置倒计时（固定第 5 组 task_4，on 恒为 1） */
const cdShow = ref(false);

async function onCountDownConfirm(payload: { hour: number; minute: number; brightness: number }) {
  try {
    await device.sendCmd(mac.value, { task_4: { ...payload, on: 1 } });
  } catch (e) {
    showToast((e as Error).message);
  }
}

/** 下拉刷新 */
async function onRefresh() {
  await queryTasks();
  refreshing.value = false;
}

onMounted(() => {
  if (!device.byMac(mac.value)) void device.load().catch(() => {});
  // ServiceConnected / MqttConnected 均触发查询
  void queryTasks();
});

// MqttConnected / MqttDisconnected 时重新查询
watch(
  () => app.status?.mqtt.connected,
  (now, before) => {
    if (before === undefined) return;
    if (now !== before) void queryTasks();
  },
);

function goBack() {
  router.push('/');
}
</script>

<template>
  <div class="flex min-h-full flex-col">
    <AppNavBar :title="title" back @back="goBack" />

    <van-pull-refresh v-model="refreshing" class="flex-1" @refresh="onRefresh">
      <div class="p-2">
        <div class="py-2 text-center text-[15px] text-gray-600">定时任务</div>

        <div class="overflow-hidden rounded-md bg-white">
          <div
            v-for="(t, i) in tasks"
            :key="i"
            data-testid="task-row"
            class="flex cursor-pointer items-center gap-3 border-b border-gray-200 px-4 py-3 last:border-b-0 active:bg-gray-50"
            @click="openEdit(i)"
          >
            <span class="w-[72px] shrink-0 text-[25px] leading-none tabular-nums">{{
              timeText(t)
            }}</span>
            <span class="flex-1 text-[20px] text-gray-700">{{ actionText(t) }}</span>
            <van-switch
              class="shrink-0"
              :model-value="!!(t && t.on)"
              :disabled="!t"
              @click.stop
              @update:model-value="(v: boolean) => onToggle(i, v)"
            />
          </div>
        </div>

        <div class="pt-4">
          <van-button type="primary" color="#3F51B5" block @click="cdShow = true">
            设置倒计时
          </van-button>
        </div>
      </div>
    </van-pull-refresh>

    <TaskEditPopup v-model:show="editShow" :task="editTask" @confirm="onEditConfirm" />
    <CountDownPopup v-model:show="cdShow" @confirm="onCountDownConfirm" />
  </div>
</template>

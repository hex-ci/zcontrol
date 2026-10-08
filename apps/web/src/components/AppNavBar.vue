<script setup lang="ts">
/**
 * 顶部工具栏，动作：
 *  - menu  打开抽屉（左区整体可点，不只图标）
 *  - back  返回（左区整体可点）
 *  - doc   设备文档
 *  - sync  配置设备 MQTT 服务器（云同步，固定走 UDP）
 *  - edit  设置（进入设备设置页）
 *
 * 可点区域说明：Vant 导航栏左/右区自带 16px 内边距，把 handler 挂到「整个区域」而不是 20px 图标上，
 * 否则点图标周围有按压反馈但不触发（移动端手指命中率很低）。
 *
 * 图标名必须在 Vant 4 的图标表里存在：曾用 `cloud-o`（Vant 没有这个图标），
 * 结果按钮变成 16px 宽的空白区域、用户完全看不到入口（靠 e2e 的图标字形守卫兜住）。
 * 三个动作都只放图标、不加文字，保持顶栏一致；含义靠 title / aria-label。
 *
 * `:clickable="false"`：Vant 默认会给左/右区容器加 `van-haptics-feedback`
 * （cursor:pointer + 按下变暗）。右区容器我们并没有监听 click-right，于是整块空白也像按钮、
 * 点了却没任何反应——关掉它，改成只让真正的控件（三个按钮、左侧菜单图标）自己有光标与按压反馈。
 */
defineProps<{
  title: string;
  menu?: boolean;
  doc?: boolean;
  sync?: boolean;
  edit?: boolean;
  back?: boolean;
}>();

const emit = defineEmits<{
  menu: [];
  doc: [];
  sync: [];
  edit: [];
  back: [];
}>();
</script>

<template>
  <van-nav-bar
    :title="title"
    :left-arrow="!!back"
    :clickable="false"
    fixed
    placeholder
    :border="false"
    @click-left="menu ? emit('menu') : emit('back')"
  >
    <template v-if="menu" #left>
      <span class="flex cursor-pointer items-center active:opacity-60">
        <van-icon name="bars" size="20" />
      </span>
    </template>
    <template #right>
      <div class="flex items-center">
        <button
          v-if="doc"
          type="button"
          class="flex cursor-pointer items-center px-2 py-2 active:opacity-60"
          data-testid="nav-doc"
          @click="emit('doc')"
        >
          <van-icon name="question-o" size="18" />
        </button>
        <!-- 云同步：图标名必须在 Vant 图标表里存在（曾用 cloud-o → 画不出字形，按钮是 16px 的空白区） -->
        <button
          v-if="sync"
          type="button"
          class="flex cursor-pointer items-center px-2 py-2 active:opacity-60"
          data-testid="nav-sync"
          title="云同步：把本机 MQTT 服务器配置下发给设备"
          aria-label="云同步：把本机 MQTT 服务器配置下发给设备"
          @click="emit('sync')"
        >
          <van-icon name="exchange" size="18" />
        </button>
        <button
          v-if="edit"
          type="button"
          class="flex cursor-pointer items-center px-2 py-2 active:opacity-60"
          data-testid="nav-edit"
          @click="emit('edit')"
        >
          <van-icon name="edit" size="18" />
        </button>
      </div>
    </template>
  </van-nav-bar>
</template>

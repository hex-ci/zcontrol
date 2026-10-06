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
    fixed
    placeholder
    :border="false"
    @click-left="menu ? emit('menu') : emit('back')"
  >
    <template v-if="menu" #left>
      <van-icon name="bars" size="20" />
    </template>
    <template #right>
      <div class="flex items-center">
        <button
          v-if="doc"
          type="button"
          class="flex items-center px-2 py-2"
          data-testid="nav-doc"
          @click="emit('doc')"
        >
          <van-icon name="question-o" size="18" />
        </button>
        <button
          v-if="sync"
          type="button"
          class="flex items-center px-2 py-2"
          data-testid="nav-sync"
          @click="emit('sync')"
        >
          <van-icon name="cloud-o" size="18" />
        </button>
        <button
          v-if="edit"
          type="button"
          class="flex items-center px-2 py-2"
          data-testid="nav-edit"
          @click="emit('edit')"
        >
          <van-icon name="edit" size="18" />
        </button>
      </div>
    </template>
  </van-nav-bar>
</template>

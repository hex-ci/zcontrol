<script setup lang="ts">
/**
 * 顶部工具栏，三个动作：
 *  - doc   设备文档
 *  - sync  配置设备 MQTT 服务器（云同步，固定走 UDP）
 *  - edit  设置（进入设备设置页）
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
    @click-left="emit('back')"
  >
    <template v-if="menu" #left>
      <van-icon name="bars" size="20" @click="emit('menu')" />
    </template>
    <template #right>
      <div class="flex items-center gap-3">
        <van-icon v-if="doc" name="question-o" size="18" @click="emit('doc')" />
        <van-icon v-if="sync" name="cloud-o" size="18" @click="emit('sync')" />
        <van-icon v-if="edit" name="edit" size="18" @click="emit('edit')" />
      </div>
    </template>
  </van-nav-bar>
</template>

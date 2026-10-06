<script setup lang="ts">
/**
 * 配对说明页（纯静态说明文案）。
 */
import { useRouter } from 'vue-router';
import AppNavBar from '../components/AppNavBar.vue';

const router = useRouter();

/** 配网步骤 */
const steps = [
  '1.长按侧面按键15秒直到屏幕显示全部点亮.(第一次配网不需要此操作)',
  '2. 手机连接设备热点zM1_XXXX,打开网址:192.168.0.1,输入wifi名称(必须为2.4G)及密码点击下一步,提示配置成功.',
  '3. 在路由器管理中确认设备连上wifi,名称为zM1_XXXX.',
  '4. 搜寻局域网设备添加设备至本工具.',
];

function back() {
  router.back();
}
</script>

<template>
  <div class="flex min-h-full flex-col bg-white">
    <AppNavBar title="zM1配网" back @back="back" />

    <div class="flex flex-col gap-4 p-4 text-sm leading-6 text-gray-800" data-testid="link-steps">
      <p v-for="(s, i) in steps" :key="i" class="whitespace-pre-wrap">{{ s }}</p>

      <p class="whitespace-pre-wrap text-gray-600">更多详细内容见使用文档说明</p>
      <p class="whitespace-pre-wrap text-gray-600">文档在帮助/关于页面跳转</p>
    </div>
  </div>
</template>

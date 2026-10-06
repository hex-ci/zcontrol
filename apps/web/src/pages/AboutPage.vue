<script setup lang="ts">
/**
 * 帮助/关于页：当前版本 / 作者 / 项目地址，以及 zM1 通信协议文档入口。
 */
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import AppNavBar from '../components/AppNavBar.vue';
import { useAppStore } from '../stores/app';

const router = useRouter();
const app = useAppStore();

const AUTHOR_GITHUB = 'https://github.com/hex-ci';
const PROJECT_URL = 'https://github.com/hex-ci/zcontrol';
const PROTOCOL_DOC = 'https://github.com/hex-ci/zcontrol/blob/main/docs/PROTOCOL.md';

onMounted(() => {
  if (!app.status) {
    app.loadStatus().catch(() => {
      /* 后端不可用时忽略 */
    });
  }
});

function back() {
  router.back();
}
</script>

<template>
  <div class="flex min-h-full flex-col bg-gray-50">
    <AppNavBar title="关于" back @back="back" />

    <van-cell-group inset class="mt-3">
      <van-cell
        title="当前版本"
        :value="app.status?.versionName || '--'"
        data-testid="about-version"
      />
      <a
        class="van-cell van-cell--clickable"
        :href="AUTHOR_GITHUB"
        target="_blank"
        rel="noopener"
        data-testid="about-author"
      >
        <div class="van-cell__title"><span>作者</span></div>
        <div class="van-cell__value"><span>Hex</span></div>
      </a>
      <a
        class="van-cell van-cell--clickable"
        :href="PROJECT_URL"
        target="_blank"
        rel="noopener"
        data-testid="about-project"
      >
        <div class="van-cell__title"><span>项目地址</span></div>
        <div class="van-cell__value"><span>{{ PROJECT_URL }}</span></div>
      </a>
    </van-cell-group>

    <van-cell-group inset class="mt-3 mb-6" title="相关文档">
      <div class="flex flex-col gap-2 p-4">
        <a
          :href="PROTOCOL_DOC"
          target="_blank"
          rel="noopener"
          class="rounded border border-gray-200 bg-white px-3 py-2 text-center text-sm text-[#3F51B5]"
          data-testid="doc-link-0"
        >
          zM1 通信协议
        </a>
      </div>
    </van-cell-group>
  </div>
</template>

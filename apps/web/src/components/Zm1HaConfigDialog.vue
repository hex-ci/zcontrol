<script setup lang="ts">
/**
 * Home Assistant 配置弹窗：展示生成的 YAML（只读），可复制或下载成 .yaml 文件。
 * 纯文本生成——不会向设备或 HA 发送任何数据。
 */
import { showToast } from 'vant';
import { copyText } from '../composables/clipboard';

const props = defineProps<{ show: boolean; yaml: string; fileName: string }>();
const emit = defineEmits<{ 'update:show': [boolean] }>();

async function onCopy(): Promise<void> {
  showToast((await copyText(props.yaml)) ? '已复制HA配置' : '复制失败,请长按选择文本');
}

function onDownload(): void {
  const blob = new Blob([props.yaml], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = props.fileName || 'zcontrol-ha.yaml';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <van-popup
    :show="show"
    round
    position="bottom"
    class="flex max-h-[86%] flex-col"
    @update:show="emit('update:show', $event)"
  >
    <div class="shrink-0 px-5 pt-5 text-base font-medium">Home Assistant 配置</div>
    <div class="shrink-0 px-5 pt-2 pb-3 text-xs leading-5 text-gray-500">
      把 sensor / light 两项追加到 configuration.yaml 已有的 mqtt: 段下（还没有该段则整段粘到顶层），
      然后重启 HA 或「开发者工具 → YAML → 重新加载 MQTT 实体」。实体名沿用 zm1_&lt;mac&gt;_&lt;字段&gt;，
      实体 ID 不变、面板不受影响；该设备若已按旧模板配过，请用本段替换旧条目。只生成文本，不向设备下发任何数据。
    </div>
    <!-- YAML 不折行（折行会把 topic 拆成两段，手工复制容易复制错），窄屏上左右滚动 -->
    <div class="min-h-0 flex-1 overflow-auto px-5">
      <pre
        data-testid="ha-yaml"
        class="w-max min-w-full rounded bg-gray-100 p-3 text-[11px] leading-4 whitespace-pre text-gray-800"
        >{{ yaml }}</pre
      >
    </div>
    <div class="flex shrink-0 gap-3 p-4">
      <van-button block plain type="primary" data-testid="ha-copy" @click="onCopy">复制</van-button>
      <van-button block type="primary" data-testid="ha-download" @click="onDownload">
        下载 .yaml
      </van-button>
    </div>
  </van-popup>
</template>

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import Components from 'unplugin-vue-components/vite';
import AutoImport from 'unplugin-auto-import/vite';
import { VantResolver } from '@vant/auto-import-resolver';

const SERVER = 'http://127.0.0.1:8090';

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      // importStyle: false —— 样式统一由 src/style.css 里的全局 vant/lib/index.css 提供。
      // 若让 resolver 按组件按需引入，懒加载分块里的 Vant 默认 :root 变量会覆盖掉我们
      // 在 style.css 里对主题色的覆盖（实测工具栏会变回白色）。
      resolvers: [VantResolver({ importStyle: false })],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [VantResolver({ importStyle: false })],
      dts: 'src/components.d.ts',
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});

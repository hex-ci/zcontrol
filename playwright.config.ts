import { defineConfig, devices } from '@playwright/test'

/**
 * e2e 配置：默认跑本机开发环境（web 5173 / server 8090）。
 * BASE_URL 可覆盖，例如 BASE_URL=http://zcontrol.n1 pnpm test:e2e
 */
export default defineConfig({
  testDir: './apps/web/tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 这台机器上并行跑 30+ 条 UI 用例时负载较高，放宽等待时间避免伪失败
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
})

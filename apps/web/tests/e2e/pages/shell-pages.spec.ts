import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'

/**
 * 抽屉侧边栏 + 5 个次级页面的 e2e 验证。
 * 后端是空壳，全部接口用 page.route 提供 fixture（测试不向真实设备/局域网下发报文）。
 */

// 关掉 trace 录制，避免与并行/同仓其它进程共享 test-results 时产生工件竞争。
test.use({ trace: 'off' })

const DEVICES = [
  {
    mac: 'aabbccddee01',
    name: '测试检测仪',
    type: 4,
    typeName: 'zM1空气检测仪',
    online: true,
    ip: '192.168.1.10',
    order: 0,
    state: {},
    updatedAt: 1,
  },
  {
    mac: 'aabbccddee02',
    name: '悟空M1',
    type: 4,
    typeName: 'zM1空气检测仪',
    online: false,
    ip: null,
    order: 1,
    state: {},
    updatedAt: 1,
  },
]

const SCAN_DEVICE = {
  mac: 'aabbccddee03',
  name: 'zM1测试',
  type: 4,
  typeName: 'zM1空气检测仪',
  online: true,
  ip: '192.168.1.50',
  order: 2,
  state: {},
  updatedAt: 1,
}

const STATUS = {
  mqtt: { connected: true, uri: '192.168.1.10:1883', error: null },
  udp: { listening: true, port: 10181 },
  scan: { active: false },
  version: '1.0.0',
  versionName: '1.0.0-web',
  localIps: ['192.168.1.50'],
}

const SETTINGS = {
  mqtt_uri: '192.168.1.10:1883',
  mqtt_user: 'user',
  mqtt_clientid: 'cid',
  mqtt_password_set: true,
  version_no_ask: '',
}

interface Calls {
  addDevice: Record<string, unknown>[]
  saveSettings: Record<string, unknown>[]
  order: Record<string, unknown>[]
  scan: Record<string, unknown>[]
  /** 模拟后端向页面推送一帧 WS 消息 */
  ws: (msg: unknown) => void
}

/** 给所有接口挂上 fixture，返回记录到的写请求 */
async function mockApi(page: Page): Promise<Calls> {
  let wsRoute: WebSocketRoute | null = null
  const calls: Calls = {
    addDevice: [],
    saveSettings: [],
    order: [],
    scan: [],
    ws: msg => wsRoute?.send(JSON.stringify(msg)),
  }

  // 拦截 WebSocket：默认不连接真实后端、不主动发消息；用例可用 calls.ws() 模拟后端推送。
  await page.routeWebSocket('**/ws', (ws) => {
    wsRoute = ws
  })

  await page.route('**/api/status', r => r.fulfill({ json: STATUS }))

  await page.route('**/api/settings', (r) => {
    if (r.request().method() === 'PUT') {
      const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>
      calls.saveSettings.push(body)
      return r.fulfill({
        json: {
          settings: { ...SETTINGS, mqtt_uri: (body.mqtt_uri as string) ?? SETTINGS.mqtt_uri },
          mqtt: { connected: true, uri: (body.mqtt_uri as string) ?? STATUS.mqtt.uri, error: null },
        },
      })
    }
    return r.fulfill({ json: SETTINGS })
  })

  await page.route('**/api/devices', (r) => {
    if (r.request().method() === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>
      calls.addDevice.push(body)
      return r.fulfill({
        json: { device: { ...DEVICES[0], mac: body.mac, name: body.name, type: body.type ?? 4 } },
      })
    }
    return r.fulfill({ json: { devices: DEVICES } })
  })

  await page.route('**/api/devices/order', (r) => {
    calls.order.push(JSON.parse(r.request().postData() ?? '{}'))
    return r.fulfill({ json: { devices: DEVICES } })
  })

  await page.route('**/api/devices/export', r =>
    r.fulfill({
      json: {
        device: DEVICES.map(d => ({ name: d.name, mac: d.mac, type: d.type, type_name: d.typeName })),
      },
    }),
  )

  await page.route('**/api/devices/import', r =>
    r.fulfill({ json: { total: 1, added: 1, dup: 0, invalid: 0 } }),
  )

  await page.route('**/api/discovery/scan', (r) => {
    const method = r.request().method()
    if (method === 'POST') {
      const body = JSON.parse(r.request().postData() ?? '{}') as { action?: string }
      calls.scan.push(body)
      if (body.action === 'start') {
        return r.fulfill({ json: { active: true, devices: [SCAN_DEVICE] } })
      }
      return r.fulfill({ json: { active: false, devices: [SCAN_DEVICE] } })
    }
    return r.fulfill({ json: { active: false, devices: [] } })
  })

  return calls
}

test('主界面打开抽屉：标题/副标题、设备列表与底部三按钮，点击设备可切换', async ({ page }) => {
  await mockApi(page)
  await page.goto('/')

  // 初始当前设备 = 第一台
  await expect(page.locator('.van-nav-bar__title')).toHaveText('测试检测仪')

  // 点工具栏菜单图标打开抽屉
  await page.locator('.van-icon-bars').click()
  await expect(page.getByTestId('drawer-title')).toHaveText('zControl Web')
  await expect(page.getByText('zM1 空气检测仪 Web 控制台')).toBeVisible()
  // 抽屉顶部只保留项目标识，不含任何赞助/捐赠入口
  await expect(page.getByTestId('drawer-reward')).toHaveCount(0)

  await expect(page.getByTestId('drawer-device-aabbccddee01')).toContainText('测试检测仪')
  await expect(page.getByTestId('drawer-device-aabbccddee02')).toContainText('悟空M1')
  await expect(page.getByTestId('drawer-sort-tip')).toContainText('长按删除设备.点此设置排序')
  // 底部两按钮：设置 / 关于
  await expect(page.getByTestId('drawer-settings')).toBeVisible()
  await expect(page.getByTestId('drawer-about')).toBeVisible()

  await page.screenshot({ path: 'docs/screenshots/13-shell.png', fullPage: true })

  // 点第二台设备 → 抽屉关闭且当前设备切换
  await page.getByTestId('drawer-device-aabbccddee02').click()
  await expect(page.locator('.van-nav-bar__title')).toHaveText('悟空M1')
})

test('/add：局域网扫描发现设备；手动输入 12 位 MAC 并 POST /api/devices', async ({ page }) => {
  const calls = await mockApi(page)
  await page.goto('/#/add')
  await expect(page.getByTestId('manual-mac')).toBeVisible()

  // (a) 局域网扫描（走拦截的 fixture，不广播到局域网）
  await page.getByTestId('scan-toggle').click()
  await expect(page.getByTestId('scan-status')).toBeVisible()
  await expect(page.getByTestId('scan-device-aabbccddee03')).toContainText('zM1测试')

  // (b) 手动输入：非法 MAC 报错
  await page.getByTestId('manual-mac').locator('input').fill('abc')
  await page.getByTestId('manual-add').click()
  await expect(page.locator('.van-toast').filter({ hasText: 'MAC 格式错误' })).toBeVisible()
  expect(calls.addDevice.length).toBe(0)

  // 合法 12 位十六进制 MAC（大小写不敏感，统一小写）
  await page.getByTestId('manual-mac').locator('input').fill('AABBCCDDEEFF')
  await page.getByTestId('manual-name').locator('input').fill('zM1测试')
  await page.getByTestId('manual-add').click()

  await expect.poll(() => calls.addDevice.length).toBe(1)
  expect(calls.addDevice[0]).toMatchObject({ mac: 'aabbccddeeff', name: 'zM1测试', type: 4 })

  // 添加成功 → 返回主界面
  await expect(page.locator('.van-nav-bar__title')).toHaveText('测试检测仪')
})

test('/add：扫描结果既随首帧下发，也会实时推送（修复前必须刷新页面才看得到）', async ({ page }) => {
  const calls = await mockApi(page)
  const pushed = { ...SCAN_DEVICE, mac: 'aabbccddee04', name: '推送设备' }

  await page.goto('/#/add')
  await expect(page.getByText('未发现设备,点击「开始扫描」')).toBeVisible()

  // ① 首帧 hello 里带的扫描结果（等价于「刷新页面后立刻出现」）
  calls.ws({
    type: 'hello',
    data: { status: STATUS, devices: DEVICES, settings: SETTINGS, scan: { active: false, devices: [pushed] } },
  })
  await expect(page.getByTestId('scan-device-aabbccddee04')).toContainText('推送设备')

  // ② 扫描过程中的实时推送：点开始扫描后无需刷新，列表自动出现设备
  await page.getByTestId('scan-toggle').click()
  await expect(page.getByTestId('scan-status')).toBeVisible()
  // 开始扫描会先清空列表（REST 返回该时刻的空列表）
  await expect(page.getByTestId('scan-device-aabbccddee04')).toHaveCount(0)

  calls.ws({ type: 'scan', data: { devices: [pushed] } })
  await expect(page.getByTestId('scan-device-aabbccddee04')).toContainText('推送设备')
})

test('/settings：mqtt 地址非法 Toast 报错，合法才 PUT /api/settings', async ({ page }) => {
  const calls = await mockApi(page)
  await page.goto('/#/settings')

  const uriInput = page.locator('.van-field').filter({ hasText: 'MQTT 地址' }).locator('input')
  await expect(uriInput).toHaveValue('192.168.1.10:1883') // 读到后端设置
  await expect(page.getByTestId('mqtt-state')).toContainText('已连接')
  await expect(page.getByTestId('udp-state')).toContainText('监听中')

  // 非法：abc
  await uriInput.fill('abc')
  await page.getByTestId('save-mqtt').click()
  await expect(page.locator('.van-toast').filter({ hasText: '格式错误' })).toBeVisible()
  expect(calls.saveSettings.length).toBe(0)

  await page.screenshot({ path: 'docs/screenshots/14-app-settings.png', fullPage: true })

  // 合法：只填地址自动补 :1883
  await uriInput.fill('192.168.1.10')
  await page.getByTestId('save-mqtt').click()
  await expect.poll(() => calls.saveSettings.length).toBe(1)
  expect(calls.saveSettings[0]?.mqtt_uri).toBe('192.168.1.10:1883')
})

test('/sort：调整顺序后 PUT /api/devices/order', async ({ page }) => {
  const calls = await mockApi(page)
  await page.goto('/#/sort')

  await expect(page.getByTestId('sort-row-aabbccddee01')).toBeVisible()
  await expect(page.getByTestId('sort-tip')).toContainText('长按拖动排序')

  // 把第一台下移
  await page.getByTestId('sort-down-aabbccddee01').click()
  await page.getByTestId('sort-save').click()

  await expect.poll(() => calls.order.length).toBe(1)
  expect(calls.order[0]?.macs).toEqual(['aabbccddee02', 'aabbccddee01'])

  // 保存后返回主界面
  await expect(page.locator('.van-nav-bar__title')).toHaveText('测试检测仪')
})

test('/about：版本、作者/项目链接，且仅有 1 个通信协议文档链接', async ({ page }) => {
  await mockApi(page)
  await page.goto('/#/about')

  await expect(page.getByTestId('about-version')).toContainText('1.0.0-web')

  const author = page.getByTestId('about-author')
  await expect(author).toHaveAttribute('href', 'https://github.com/hex-ci')
  await expect(author).toContainText('Hex')

  await expect(page.getByTestId('about-project')).toContainText('https://github.com/hex-ci/zcontrol')

  // 仅一个文档链接：zM1 通信协议
  await expect(page.locator('[data-testid^="doc-link-"]')).toHaveCount(1)
  const doc = page.getByTestId('doc-link-0')
  await expect(doc).toContainText('zM1 通信协议')
  await expect(doc).toHaveAttribute(
    'href',
    'https://github.com/hex-ci/zcontrol/blob/main/docs/PROTOCOL.md',
  )

  // 隐私区已移除
  await expect(page.getByTestId('about-privacy')).toHaveCount(0)
})

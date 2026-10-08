import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface LogLine {
  ts: number
  dir: 'send' | 'recv' | 'sys'
  text: string
}

const MAX_LINES = 500

function two(n: number) {
  return String(n).padStart(2, '0')
}

/** 日志时间格式：[HH:mm:ss.sss] */
export function stamp(ts = Date.now()): string {
  const d = new Date(ts)
  return `[${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(
    d.getMilliseconds(),
  ).padStart(3, '0')}]`
}

/** 日志首行格式：---- yyyy/MM/dd HH:mm:ss ---- */
export function header(ts = Date.now()): string {
  const d = new Date(ts)
  return `---- ${d.getFullYear()}/${two(d.getMonth() + 1)}/${two(d.getDate())} ${two(
    d.getHours(),
  )}:${two(d.getMinutes())}:${two(d.getSeconds())} ----`
}

export const useLogStore = defineStore('log', () => {
  const logs = ref<Record<string, LogLine[]>>({})
  const headerAt = ref<Record<string, number>>({})

  function lines(mac: string): LogLine[] {
    return logs.value[mac] ?? []
  }

  function push(mac: string, dir: LogLine['dir'], text: string, ts = Date.now()) {
    const arr = logs.value[mac] ?? []
    arr.push({ ts, dir, text })
    if (arr.length > MAX_LINES) arr.splice(0, arr.length - MAX_LINES)
    logs.value = { ...logs.value, [mac]: arr }
    if (!headerAt.value[mac]) headerAt.value = { ...headerAt.value, [mac]: ts }
  }

  function clear(mac: string) {
    logs.value = { ...logs.value, [mac]: [] }
    headerAt.value = { ...headerAt.value, [mac]: Date.now() }
    push(mac, 'sys', 'log已经清空')
  }

  /** 供界面渲染：首行时间戳 + 每行 [时间]内容 */
  function asText(mac: string): string {
    const head = header(headerAt.value[mac] ?? Date.now())
    return [head, ...lines(mac).map(l => stamp(l.ts) + l.text)].join('\n')
  }

  return { logs, headerAt, lines, push, clear, asText }
})

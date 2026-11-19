/**
 * 宿主能力层的类型定义与访问入口。
 *
 * 目前唯一实现是 Electron 的 preload。将来要把这套界面挂进 DSH 插件时，
 * 只需要另写一份实现（走 DSH 的宿主服务），这里的类型和 UI 代码都不用改。
 */

export type Eol = 'lf' | 'crlf'

export interface FileVersion { mtime: number; size: number; hash: string }

export interface DocPayload {
  path: string
  name: string
  dir: string
  content: string
  encoding: string
  eol: Eol
  bom: boolean
  mtime: number
  size: number
  version?: FileVersion
}

export interface WritePayload {
  content: string
  encoding: string
  eol: Eol
  bom: boolean
  expected?: FileVersion
  force?: boolean
}

export interface DocEntry {
  path: string
  name: string
  rel: string
  dir: string
  mtime: number
  size: number
}

export interface HostApi {
  kind: 'electron' | 'browser' | 'dsh'
  pickFile(): Promise<string | null>
  pickFolder(): Promise<string | null>
  read(path: string): Promise<DocPayload | { error: string }>
  write(path: string, payload: WritePayload): Promise<{ ok: true; mtime: number; version?: FileVersion } | { error: string; conflict?: boolean; current?: FileVersion }>
  listDocs(dir: string): Promise<{ dir: string; entries: DocEntry[] } | { error: string }>
  stat(path: string): Promise<{ exists: boolean; mtime: number; size: number }>
  reveal(path: string): void
  watch(path: string | null): Promise<void>
  openExternal(url: string): Promise<void>
  startupFile(): Promise<string | null>
  setOverlay(opts: { color: string; symbolColor: string }): Promise<void>
  requestClose(): Promise<{ ok: boolean; requestId: number | null }>
  confirmClose(requestId: number, decision: 'save' | 'discard' | 'cancel'): Promise<{ ok: boolean }>
  onBeforeClose(cb: (request: { requestId: number }) => void): () => void
  onOpenFile(cb: (path: string) => void): () => void
  onExternalChange(cb: (evt: { path: string; mtime: number; deleted: boolean }) => void): () => void
}

declare global {
  interface Window {
    host: HostApi
  }
}

/**
 * 延迟到真正调用时才去取 window.host。
 * 模块求值发生在宿主安装之前（浏览器兜底 / DSH 插件都是后装的），
 * 所以在模块顶层直接读 window.host 会拿到 undefined。
 */
export const host: HostApi = new Proxy({} as HostApi, {
  get(_target, prop) {
    const api = window.host
    if (!api) throw new Error('宿主能力尚未就绪')
    const value = (api as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? value.bind(api) : value
  }
})

export function isError(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v
}

/* ---------------- 展示用的小工具 ---------------- */

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

export function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx > 0 ? p.slice(0, idx) : p
}

/** 相对当前工作目录的短路径，太长了就省略中间 */
export function shortPath(full: string, root: string | null, max = 52): string {
  let p = full
  if (root) {
    const norm = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
    if (norm(full).startsWith(norm(root))) {
      p = full.slice(root.length).replace(/^[\\/]/, '')
    }
  }
  if (p.length <= max) return p
  const head = p.slice(0, 12)
  const tail = p.slice(-(max - 15))
  return `${head}…${tail}`
}

export function formatTime(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const diff = now - ms
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour

  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day && d.getDate() === new Date(now).getDate()) {
    return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 中文字数：汉字算 1，英文按词算 1，数字连写算 1 */
export function countWords(text: string): number {
  const han = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const latin = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, ' ')
    .match(/[A-Za-z0-9_'-]+/g)?.length ?? 0
  return han + latin
}

export function readingMinutes(words: number): number {
  /* 中文阅读大约 400 字/分钟 */
  return Math.max(1, Math.round(words / 400))
}

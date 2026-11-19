import { contextBridge, ipcRenderer, webUtils } from 'electron'

/**
 * 把文件拖进窗口时，Chromium 默认会直接导航到 file:// 把整个应用顶掉。
 * 这里在 preload 里截住，取出真实路径，交给主进程转给渲染层打开。
 */
window.addEventListener(
  'dragover',
  (e) => {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  },
  false
)

window.addEventListener(
  'drop',
  (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    let path = ''
    try {
      path = webUtils.getPathForFile(file)
    } catch {
      path = ''
    }
    if (path) ipcRenderer.send('app:openDropped', path)
  },
  false
)

/**
 * 渲染层唯一的系统能力入口。
 * 刻意收在一个扁平对象里：将来把这个界面挂进 DSH 插件时，
 * 只要换掉这一层的实现，UI 与业务代码一行都不用动。
 */
const host = {
  kind: 'electron' as const,

  pickFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),

  read: (path: string) => ipcRenderer.invoke('fs:read', path),
  write: (path: string, payload: unknown) => ipcRenderer.invoke('fs:write', path, payload),
  listDocs: (dir: string) => ipcRenderer.invoke('fs:listDocs', dir),
  stat: (path: string) => ipcRenderer.invoke('fs:stat', path),
  reveal: (path: string) => ipcRenderer.invoke('fs:reveal', path),
  watch: (path: string | null) => ipcRenderer.invoke('fs:watch', path),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),

  startupFile: (): Promise<string | null> => ipcRenderer.invoke('app:startupFile'),
  setOverlay: (opts: { color: string; symbolColor: string }) => ipcRenderer.invoke('win:overlay', opts),

  /** Ask the renderer to save/discard/cancel before the native window closes. */
  requestClose: (): Promise<{ ok: boolean; requestId: number | null }> =>
    ipcRenderer.invoke('app:requestClose'),
  confirmClose: (
    requestId: number,
    decision: 'save' | 'discard' | 'cancel'
  ): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:confirmClose', requestId, decision),
  onBeforeClose: (
    cb: (request: { requestId: number }) => void
  ): (() => void) => {
    const handler = (_e: unknown, request: { requestId: number }): void => cb(request)
    ipcRenderer.on('app:beforeClose', handler)
    ipcRenderer.send('app:closeListenerReady')
    return () => ipcRenderer.off('app:beforeClose', handler)
  },

  onOpenFile: (cb: (path: string) => void): (() => void) => {
    const handler = (_e: unknown, path: string): void => cb(path)
    ipcRenderer.on('app:openFile', handler)
    return () => ipcRenderer.off('app:openFile', handler)
  },

  onExternalChange: (cb: (evt: { path: string; mtime: number; deleted: boolean }) => void): (() => void) => {
    const handler = (_e: unknown, evt: { path: string; mtime: number; deleted: boolean }): void => cb(evt)
    ipcRenderer.on('file:externalChange', handler)
    return () => ipcRenderer.off('file:externalChange', handler)
  }
}

contextBridge.exposeInMainWorld('host', host)

export type Host = typeof host

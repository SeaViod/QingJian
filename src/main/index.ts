import { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeTheme, protocol, net } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as files from './files'

const isDev = !app.isPackaged
// Integration tests use a separate profile; never touch the user's open session.
if (isDev && process.env.ZHIMO_USER_DATA_DIR) app.setPath('userData', process.env.ZHIMO_USER_DATA_DIR)

/**
 * 给渲染层一个能读本地图片的自定义协议。
 * 直接写 file:// 在开发模式（http://localhost）下会被拦，自定义协议两边都通。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mdlocal',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])
let mainWindow: BrowserWindow | null = null
let closeRequestId = 0
let pendingCloseRequest: number | null = null
let closeApproved = false
let appQuitRequested = false
let closeListenerReady = false

function askRendererBeforeClose(): void {
  if (!mainWindow || mainWindow.isDestroyed() || pendingCloseRequest !== null) return
  pendingCloseRequest = ++closeRequestId
  if (closeListenerReady) mainWindow.webContents.send('app:beforeClose', { requestId: pendingCloseRequest })
}

function approveClose(requestId: number, decision: 'save' | 'discard' | 'cancel'): boolean {
  if (pendingCloseRequest !== requestId) return false
  pendingCloseRequest = null
  if (decision === 'cancel') {
    appQuitRequested = false
    return true
  }
  closeApproved = true
  if (appQuitRequested) app.quit()
  else mainWindow?.close()
  return true
}

/* 第二个实例启动时，把要打开的文件转交给主实例 */
let pendingOpen: string | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const target = pickFileArg(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (target) mainWindow.webContents.send('app:openFile', target)
    }
  })
}

/** 从命令行参数里挑出一个存在的文件路径 */
function pickFileArg(argv: string[]): string | null {
  for (const raw of argv.slice(1)) {
    if (raw.startsWith('-')) continue
    const p = files.normalize(raw)
    if (p && files.isFile(p)) return p
  }
  return null
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 520,
    show: false,
    /* 暖纸底，避免白屏闪一下 */
    backgroundColor: '#f6f1e7',
    /* 隐藏原生标题栏，把按钮叠到自绘顶栏上（保留 Win11 贴靠布局） */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f6f1e7',
      symbolColor: '#6b6157',
      height: 60
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) closeListenerReady = false
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.on('close', (event) => {
    if (closeApproved) return
    event.preventDefault()
    askRendererBeforeClose()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    pendingCloseRequest = null
    closeApproved = false
    appQuitRequested = false
  })

  /* 外链一律走系统浏览器，绝不在应用内导航 */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* ---------------- IPC ---------------- */

function registerIpc(): void {
  ipcMain.handle('dialog:openFile', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }]
    })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:openFolder', async () => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('fs:read', (_e, path: string) => files.readDocument(path))
  ipcMain.handle('fs:write', (_e, path: string, payload: files.WritePayload) =>
    files.writeDocument(path, payload)
  )

  ipcMain.on('app:closeListenerReady', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return
    closeListenerReady = true
    if (pendingCloseRequest !== null) event.sender.send('app:beforeClose', { requestId: pendingCloseRequest })
  })

  /* Renderer owns the dirty/save decision; main owns the native close gate. */
  ipcMain.handle('app:requestClose', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, requestId: null }
    if (pendingCloseRequest === null) askRendererBeforeClose()
    return { ok: true, requestId: pendingCloseRequest }
  })
  ipcMain.handle(
    'app:confirmClose',
    (_e, requestId: unknown, decision: unknown) => {
      if (!Number.isInteger(requestId)) return { ok: false }
      if (decision !== 'save' && decision !== 'discard' && decision !== 'cancel') return { ok: false }
      return { ok: approveClose(requestId as number, decision) }
    }
  )
  ipcMain.handle('fs:listDocs', (_e, dir: string) => files.listDocuments(dir))
  ipcMain.handle('fs:stat', (_e, path: string) => files.statFile(path))
  ipcMain.handle('fs:reveal', (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  /* 拖进窗口的文件：preload 取到真实路径后转给渲染层 */
  ipcMain.on('app:openDropped', (_e, path: string) => {
    const abs = files.normalize(path)
    if (abs && files.isFile(abs)) mainWindow?.webContents.send('app:openFile', abs)
  })

  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  ipcMain.handle('app:startupFile', () => {
    const arg = pickFileArg(process.argv)
    const remembered = files.rememberedFile()
    return pendingOpen || arg || remembered
  })

  /* 主题变化时同步原生按钮配色 */
  ipcMain.handle('win:overlay', (_e, opts: { color: string; symbolColor: string }) => {
    try {
      mainWindow?.setTitleBarOverlay({ ...opts, height: 60 })
    } catch {
      /* 区域不支持时静默 */
    }
  })

  /* 监听当前文件的外部改动 → 推给渲染层 */
  ipcMain.handle('fs:watch', (_e, path: string | null) =>
    files.watchDocument(path, (evt) => {
      mainWindow?.webContents.send('file:externalChange', evt)
    })
  )
}

/* ---------------- 生命周期 ---------------- */

app.whenReady().then(() => {
  nativeTheme.themeSource = 'light'

  protocol.handle('mdlocal', async (request) => {
    const url = new URL(request.url)
    const raw = url.searchParams.get('p')
    if (!raw) return new Response('bad request', { status: 400 })
    const abs = files.normalize(raw)
    if (!abs || !files.isFile(abs)) return new Response('not found', { status: 404 })
    try {
      return await net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })

  Menu.setApplicationMenu(null)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (mainWindow && !mainWindow.isDestroyed() && !closeApproved) {
    event.preventDefault()
    appQuitRequested = true
    askRendererBeforeClose()
    return
  }
  files.stopWatching()
})

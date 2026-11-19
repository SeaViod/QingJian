import { app } from 'electron'
import {
  promises as fsp,
  existsSync,
  statSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import chokidar, { type FSWatcher } from 'chokidar'
import iconv from 'iconv-lite'
import chardet from 'chardet'

export type Eol = 'lf' | 'crlf'

export interface FileVersion {
  /** Rounded mtime is kept for compatibility with the renderer's existing stat shape. */
  mtime: number
  size: number
  /** Content hash prevents same-size/same-mtime external edits from being missed. */
  hash: string
}

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
  /** Version captured while reading; newer renderers can pass it back on write. */
  version?: FileVersion
}

export interface WritePayload {
  content: string
  encoding: string
  eol: Eol
  bom: boolean
  /** Optional optimistic-concurrency token. Older callers may omit it. */
  expected?: Partial<FileVersion>
  /** Explicitly overwrite a known external change after presenting a conflict choice. */
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

const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.mdx'])
const TEXT_EXTS = new Set([
  ...MD_EXTS,
  '.txt', '.log', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.csv', '.tsv', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.py',
  '.java', '.c', '.cpp', '.h', '.go', '.rs', '.sh', '.bat', '.ps1', '.sql',
  '.tex', '.rst', '.org'
])

const MAX_READ_BYTES = 8 * 1024 * 1024
/** 兼容超长单行（minified js 之类） */
const MAX_LINE_BYTES = 1024 * 1024

/* ---------------- 路径 ---------------- */

export function normalize(p: string): string | null {
  try {
    const abs = isAbsolute(p) ? p : resolve(p)
    return abs
  } catch {
    return null
  }
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/* ---------------- 编码 ---------------- */

interface Decoded {
  content: string
  encoding: string
  bom: boolean
}

function decodeBuffer(buf: Buffer): Decoded {
  /* BOM 优先，最可靠 */
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { content: buf.subarray(3).toString('utf8'), encoding: 'utf-8', bom: true }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { content: iconv.decode(buf.subarray(2), 'utf-16le'), encoding: 'utf-16le', bom: true }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { content: iconv.decode(buf.subarray(2), 'utf-16be'), encoding: 'utf-16be', bom: true }
  }

  /* 严格 UTF-8 试解，成功就是 UTF-8（无 BOM） */
  try {
    return { content: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8', bom: false }
  } catch {
    /* 继续猜 */
  }

  let guess: string | null = null
  try {
    const det = chardet.detect(buf) as unknown
    if (typeof det === 'string') guess = det
    else if (det && typeof det === 'object' && 'name' in (det as any)) guess = String((det as any).name)
  } catch {
    /* chardet 失败就跳过 */
  }

  const chain: string[] = []
  if (guess) {
    const g = guess.toLowerCase()
    if (/gb|936/.test(g)) chain.push('gb18030')
    else if (/^utf-?16be$/.test(g)) chain.push('utf-16be')
    else if (/utf-?16/.test(g)) chain.push('utf-16le')
    else if (/utf/.test(g)) chain.push('utf-8')
    else chain.push(g)
  }
  chain.push('gb18030', 'utf-8')

  for (const enc of chain) {
    if (!iconv.encodingExists(enc)) continue
    const text = iconv.decode(buf, enc)
    /* iconv 不报错，用"有没有替换符"判断可信度 */
    if (!text.includes('\uFFFD')) return { content: text, encoding: normEnc(enc), bom: false }
  }
  return { content: buf.toString('binary'), encoding: 'utf-8', bom: false }
}

function normEnc(enc: string): string {
  const e = enc.toLowerCase()
  if (e === 'gbk' || e === 'gb2312' || e === 'gb18030' || e === 'cp936') return 'gb18030'
  if (e === 'utf8') return 'utf-8'
  return e
}

function normalizeEncoding(enc: string): string {
  const e = enc.trim().toLowerCase().replace(/_/g, '-')
  if (e === 'utf8' || e === 'utf-8') return 'utf-8'
  if (e === 'utf16le' || e === 'utf-16le' || e === 'ucs-2' || e === 'ucs2') return 'utf-16le'
  if (e === 'utf16be' || e === 'utf-16be') return 'utf-16be'
  if (e === 'gbk' || e === 'gb2312' || e === 'gb18030' || e === 'cp936') return 'gb18030'
  return e
}

function encodeContent(content: string, encoding: string, bom: boolean): Buffer {
  const enc = normalizeEncoding(encoding)
  let body: Buffer
  if (enc === 'gb18030') body = iconv.encode(content, 'gb18030')
  else if (enc === 'utf-16le' || enc === 'utf-16be') body = iconv.encode(content, enc)
  else if (enc === 'utf-8') body = Buffer.from(content, 'utf8')
  else body = iconv.encode(content, enc)

  if (!bom) return body
  if (enc === 'utf-8') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body])
  if (enc === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), body])
  if (enc === 'utf-16be') return Buffer.concat([Buffer.from([0xfe, 0xff]), body])
  return body
}

/* ---------------- 换行 ---------------- */

function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) || []).length
  const lf = (text.match(/(?<!\r)\n/g) || []).length
  return crlf > lf ? 'crlf' : 'lf'
}

function applyEol(text: string, eol: Eol): string {
  const unified = text.replace(/\r\n/g, '\n')
  return eol === 'crlf' ? unified.replace(/\n/g, '\r\n') : unified
}

/* ---------------- 读写 ---------------- */

function versionFor(buf: Buffer, st: { mtimeMs: number; size: number }): FileVersion {
  return {
    mtime: Math.round(st.mtimeMs),
    size: st.size,
    hash: createHash('sha256').update(buf).digest('hex')
  }
}

const knownVersions = new Map<string, FileVersion>()
const writeQueues = new Map<string, Promise<unknown>>()

function pathKey(abs: string): string {
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

function isFileVersion(value: unknown): value is FileVersion {
  return (
    !!value &&
    typeof value === 'object' &&
    Number.isFinite((value as FileVersion).mtime) &&
    Number.isFinite((value as FileVersion).size) &&
    typeof (value as FileVersion).hash === 'string'
  )
}

async function readVersion(abs: string): Promise<FileVersion | null> {
  try {
    const [buf, st] = await Promise.all([fsp.readFile(abs), fsp.stat(abs)])
    return versionFor(buf, st)
  } catch {
    return null
  }
}

export async function readDocument(path: string): Promise<DocPayload | { error: string }> {
  const abs = normalize(path)
  if (!abs || !isFile(abs)) return { error: '文件不存在' }

  const ext = extname(abs).toLowerCase()
  if (!TEXT_EXTS.has(ext)) return { error: `不支持的文件类型：${ext || '无扩展名'}` }

  const initial = await fsp.stat(abs)
  if (initial.size > MAX_READ_BYTES) return { error: '文件超过 8MB，暂不支持打开' }

  const buf = await fsp.readFile(abs)
  /* Pair the bytes with a post-read stat so the optimistic token is not stale. */
  const st = await fsp.stat(abs)

  /* 超长单行会让编辑器卡死，提前拦下 */
  const longest = buf.toString('binary').split('\n').reduce((m, l) => Math.max(m, l.length), 0)
  if (longest > MAX_LINE_BYTES) return { error: '文件包含超长单行（压缩代码？），编辑器无法处理' }

  const d = decodeBuffer(buf)
  const version = versionFor(buf, st)
  knownVersions.set(pathKey(abs), version)
  return {
    path: abs,
    name: basename(abs),
    dir: dirname(abs),
    content: applyEol(d.content, 'lf'),
    encoding: d.encoding,
    eol: detectEol(d.content),
    bom: d.bom,
    mtime: version.mtime,
    size: version.size,
    version
  }
}

let lastSelfWrite = { path: '', at: 0 }

async function writeDocumentNow(
  abs: string,
  payload: WritePayload
): Promise<{ ok: true; mtime: number; version: FileVersion } | { error: string; conflict?: boolean; current?: FileVersion }> {
  if (!payload || typeof payload.content !== 'string') return { error: '无效写入内容' }
  if (payload.eol !== 'lf' && payload.eol !== 'crlf') return { error: '无效换行格式' }
  if (typeof payload.encoding !== 'string' || !iconv.encodingExists(payload.encoding)) {
    return { error: `不支持的编码：${payload.encoding}` }
  }
  if (typeof payload.bom !== 'boolean') return { error: '无效 BOM 设置' }

  const key = pathKey(abs)
  const baseline = isFileVersion(payload.expected) ? payload.expected : knownVersions.get(key)
  if (baseline && !payload.force) {
    const current = await readVersion(abs)
    const same = current && current.mtime === baseline.mtime && current.size === baseline.size && current.hash === baseline.hash
    if (!same) {
      return { error: '文件在外部被修改，请重新载入后再保存', conflict: true, current: current ?? undefined }
    }
  }

  const buf = encodeContent(applyEol(payload.content, payload.eol), normEnc(payload.encoding), payload.bom)
  const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(8).toString('hex')}.tmp`)
  let originalMode: number | undefined
  try {
    try {
      originalMode = (await fsp.stat(abs)).mode
    } catch {
      /* New target: default mode is appropriate. */
    }

    /* Write and fsync the temporary file before the atomic replacement. */
    const handle = await fsp.open(tmp, 'w', originalMode === undefined ? 0o666 : originalMode)
    try {
      await handle.writeFile(buf)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (originalMode !== undefined) await fsp.chmod(tmp, originalMode)

    /* Renaming over a symbolic link would replace the link, not save its target. */
    const target = await fsp.lstat(abs).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (target?.isSymbolicLink()) throw new Error('不能通过符号链接保存，请打开原文件后编辑')
    /* Do not fall back to direct writes: a rename failure must not truncate data. */
    await fsp.rename(tmp, abs)
  } catch (e) {
    try {
      await fsp.rm(tmp, { force: true })
    } catch {
      /* Best effort cleanup; the original file remains untouched. */
    }
    return { error: `写入失败：${(e as Error).message}` }
  }

  const st = await fsp.stat(abs)
  const version = versionFor(buf, st)
  knownVersions.set(key, version)
  lastSelfWrite = { path: key, at: Date.now() }
  rememberFile(abs)
  return { ok: true, mtime: version.mtime, version }
}

export async function writeDocument(
  path: string,
  payload: WritePayload
): Promise<{ ok: true; mtime: number; version?: FileVersion } | { error: string; conflict?: boolean; current?: FileVersion }> {
  const abs = normalize(path)
  if (!abs) return { error: '无效路径' }
  const ext = extname(abs).toLowerCase()
  if (!TEXT_EXTS.has(ext)) return { error: '该类型不允许写入' }

  const key = pathKey(abs)
  const previous = writeQueues.get(key) ?? Promise.resolve()
  const next = previous.then(() => writeDocumentNow(abs, payload))
  writeQueues.set(key, next)
  try {
    return await next
  } finally {
    if (writeQueues.get(key) === next) writeQueues.delete(key)
  }
}

export async function statFile(path: string): Promise<{ exists: boolean; mtime: number; size: number; hash?: string }> {
  const abs = normalize(path)
  if (!abs) return { exists: false, mtime: 0, size: 0 }
  try {
    const st = await fsp.stat(abs)
    return { exists: true, mtime: Math.round(st.mtimeMs), size: st.size }
  } catch {
    return { exists: false, mtime: 0, size: 0 }
  }
}

/* ---------------- 目录扫描 ---------------- */

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'build', 'target',
  '.venv', 'venv', '__pycache__', '.idea', '.vscode', '$RECYCLE.BIN', 'System Volume Information'
])

export async function listDocuments(
  dir: string,
  opts: { depth?: number; limit?: number } = {}
): Promise<{ dir: string; entries: DocEntry[] } | { error: string }> {
  const abs = normalize(dir)
  if (!abs || !isDir(abs)) return { error: '目录不存在' }

  const rootDir = abs
  const maxDepth = opts.depth ?? 3
  const limit = opts.limit ?? 400
  const out: DocEntry[] = []

  async function walk(current: string, depth: number): Promise<void> {
    if (out.length >= limit || depth > maxDepth) return
    let names: string[]
    try {
      names = await fsp.readdir(current)
    } catch {
      return
    }
    for (const name of names) {
      if (out.length >= limit) return
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      const full = join(current, name)
      let st
      try {
        st = await fsp.stat(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1)
      } else if (TEXT_EXTS.has(extname(name).toLowerCase())) {
        out.push({
          path: full,
          name,
          rel: full.slice(rootDir.length + 1).split(sep).join('/'),
          dir: current,
          mtime: Math.round(st.mtimeMs),
          size: st.size
        })
      }
    }
  }

  await walk(rootDir, 0)
  out.sort((a, b) => b.mtime - a.mtime)
  return { dir: rootDir, entries: out }
}

/* ---------------- 外部改动监听 ---------------- */

let watcher: FSWatcher | null = null
let watchedPath: string | null = null

export async function watchDocument(
  path: string | null,
  onChange: (evt: { path: string; mtime: number; deleted: boolean }) => void
): Promise<void> {
  if (path && watchedPath === path && watcher) return
  stopWatching()
  if (!path) return
  watchedPath = path
  const active = chokidar.watch(path, { ignoreInitial: true, persistent: true, depth: 0, atomic: true })
  watcher = active
  const emit = async (deleted: boolean): Promise<void> => {
    if (watcher !== active || watchedPath !== path) return
    // A native write may still be completing when its watcher event arrives.
    await writeQueues.get(pathKey(path))?.catch(() => {})
    const version = deleted ? null : await readVersion(path)
    const known = knownVersions.get(pathKey(path))
    if (version && known && version.hash === known.hash && version.mtime === known.mtime && version.size === known.size) return
    if (watcher !== active) return
    onChange({ path, mtime: version?.mtime ?? 0, deleted: !version })
  }
  active.on('change', () => void emit(false))
  active.on('add', () => void emit(false))
  active.on('unlink', () => void emit(true))
  await new Promise<void>((resolve) => {
    active.once('ready', resolve)
    active.once('error', () => resolve())
  })
}

export function stopWatching(): void {
  if (watcher) {
    void watcher.close()
    watcher = null
    watchedPath = null
  }
}

/* ---------------- 记住上次文件 ---------------- */

interface AppState {
  lastFile?: string
}

function statePath(): string {
  return join(app.getPath('userData'), 'state.json')
}

function readState(): AppState {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8')) as AppState
  } catch {
    return {}
  }
}

function writeState(s: AppState): void {
  try {
    writeFileSync(statePath(), JSON.stringify(s, null, 2), 'utf8')
  } catch {
    /* 持久化失败不影响主流程 */
  }
}

export function rememberFile(path: string): void {
  writeState({ ...readState(), lastFile: path })
}

export function rememberedFile(): string | null {
  const s = readState()
  if (s.lastFile && existsSync(s.lastFile)) return s.lastFile
  return null
}

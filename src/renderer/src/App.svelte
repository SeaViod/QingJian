<script lang="ts">
  import { onMount, tick } from 'svelte'
  import Icon from './components/Icon.svelte'
  import EditorPane from './components/EditorPane.svelte'
  import PreviewPane from './components/PreviewPane.svelte'
  import { renderMarkdown, type TocItem } from './lib/md'
  import {
    host,
    isError,
    countWords,
    readingMinutes,
    formatTime,
    type DocPayload,
    type DocEntry
  } from './lib/host'
  import { sound } from './lib/sound'
  import type { EditorHandle, FormatKind } from './lib/editor'

  type Mode = 'edit' | 'split' | 'read'
  type Theme = 'paper' | 'ink'

  const K_THEME = 'zhimo:theme'
  const K_FS = 'zhimo:fs'
  const K_MODE = 'zhimo:mode'

  let doc = $state<DocPayload | null>(null)
  let content = $state('')
  let savedContent = $state('')
  let mode = $state<Mode>('split')
  let theme = $state<Theme>('paper')
  let docs = $state<DocEntry[]>([])
  let toc = $state<TocItem[]>([])
  let html = $state('')
  let saving = $state(false)
  let booting = $state(true)
  let docFontSize = $state(17)
  let folderRoot = $state('')
  let opening = $state(false)
  let saveError = $state('')
  let closeRequest = $state<number | null>(null)
  let progress = $state(0)
  let soundOn = $state(sound.isEnabled)
  let toastMsg = $state('')
  let banner = $state<null | { kind: 'external'; mtime: number } | { kind: 'deleted' }>(null)
  let dragging = $state(false)

  let editorHandle: EditorHandle | null = null
  let previewTimer = 0
  let saveTimer = 0
  let toastTimer = 0
  let inFlightSave: Promise<boolean> | null = null
  let stopping = false

  /* ---------------- 派生 ---------------- */
  const words = $derived(countWords(content))
  const dirty = $derived(content !== savedContent)
  const saveLabel = $derived(saving ? '保存中' : saveError ? '保存失败' : banner ? '等待处理' : dirty ? '有改动' : '已保存')
  const saveClass = $derived(saving ? 'is-saving' : saveError || banner ? 'is-error' : dirty ? 'is-dirty' : 'is-saved')
  const encLabel = $derived(
    doc
      ? `${doc.encoding.toUpperCase()}${doc.eol === 'crlf' ? ' · CRLF' : ''}${doc.bom ? ' · BOM' : ''}`
      : ''
  )
  const shortDir = $derived(doc ? compactPath(doc.dir, 44) : '')

  function compactPath(p: string, max: number): string {
    return p.length <= max ? p : `…${p.slice(-(max - 1))}`
  }

  /* ---------------- 预览渲染 ---------------- */
  function renderPreview(): void {
    const result = renderMarkdown(content, doc?.dir ?? '')
    html = result.html
    toc = result.toc
  }

  function schedulePreview(): void {
    window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(renderPreview, 80)
  }

  /* ---------------- 保存 ---------------- */
  function scheduleSave(): void {
    window.clearTimeout(saveTimer)
    if (!doc || banner || stopping || opening) return
    saveTimer = window.setTimeout(() => void save(false), 900)
  }

  async function save(explicit: boolean, force = false): Promise<boolean> {
    window.clearTimeout(saveTimer)
    if (inFlightSave) {
      if (!(await inFlightSave)) return false
      return save(explicit, force)
    }
    if (!doc) return true
    if (banner && !force) {
      if (explicit) notify('请先处理外部文件改动，再保存')
      return false
    }
    const current = doc
    const text = content
    if (!force && text === savedContent) return true
    saving = true
    saveError = ''
    const task = (async (): Promise<boolean> => {
      try {
        const result = await host.write(current.path, {
          content: text,
          encoding: current.encoding,
          eol: current.eol,
          bom: current.bom,
          expected: current.version ? { ...current.version } : undefined,
          force
        })
        if (isError(result)) {
          if (result.conflict) {
            banner = result.current
              ? { kind: 'external', mtime: result.current.mtime }
              : { kind: 'deleted' }
          }
          throw new Error(result.error)
        }
        if (doc?.path === current.path) {
          savedContent = text
          doc.mtime = result.mtime
          doc.version = result.version
          if (force) banner = null
        }
        if (explicit) sound.play('save')
        return true
      } catch (error) {
        saveError = error instanceof Error ? error.message : String(error)
        notify(saveError)
        sound.play('error')
        return false
      } finally {
        saving = false
      }
    })()
    inFlightSave = task
    const ok = await task
    inFlightSave = null
    return ok
  }

  async function flush(): Promise<boolean> {
    if (inFlightSave && !(await inFlightSave)) return false
    while (content !== savedContent) {
      if (!(await save(false))) return false
    }
    return true
  }

  /* ---------------- 打开 ---------------- */
  function installDocument(next: DocPayload): void {
    window.clearTimeout(saveTimer)
    window.clearTimeout(previewTimer)
    doc = next
    content = next.content
    savedContent = next.content
    banner = null
    saveError = ''
    progress = 0
    editorHandle?.setDoc(next.content)
    renderPreview()
    document.title = `${next.name} · 纸墨`
    document.querySelector('.preview-scroll')?.scrollTo({ top: 0 })
  }

  function scrollToFragment(id: string): void {
    document.querySelector<HTMLElement>(`.md [id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function openDoc(path: string, root?: string, fragment?: string): Promise<void> {
    if (opening || stopping) return
    if (doc?.path.toLowerCase() === path.toLowerCase()) {
      if (fragment) scrollToFragment(fragment)
      return
    }
    opening = true
    try {
      if (banner) {
        notify('请先处理当前文件的外部改动')
        return
      }
      if (!(await flush())) return
      const result = await host.read(path)
      if (isError(result)) throw new Error(result.error)
      // Edits can arrive while the read was awaiting IPC.
      if (!(await flush())) return
      if (stopping) return
      installDocument(result)
      if (fragment) {
        await tick()
        scrollToFragment(fragment)
      }
      if (root) folderRoot = root
      else if (!folderRoot || !result.path.toLowerCase().startsWith(`${folderRoot.toLowerCase()}\\`)) folderRoot = result.dir
      await host.watch(result.path)
      await refreshDocs(folderRoot)
      sound.play('open')
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
      sound.play('error')
    } finally {
      opening = false
      if (content !== savedContent) scheduleSave()
    }
  }

  async function refreshDocs(dir: string): Promise<void> {
    const result = await host.listDocs(dir)
    if (!isError(result)) docs = result.entries
  }

  async function pickFile(): Promise<void> {
    const p = await host.pickFile()
    if (p) await openDoc(p)
  }

  async function pickFolder(): Promise<void> {
    const dir = await host.pickFolder()
    if (!dir) return
    const result = await host.listDocs(dir)
    if (isError(result)) {
      notify(result.error)
      return
    }
    if (result.entries.length) await openDoc(result.entries[0].path, dir)
    else {
      folderRoot = dir
      docs = []
      notify('这个目录里没有可打开的文档')
    }
  }

  /* ---------------- 外部改动 ---------------- */
  async function reloadFromDisk(): Promise<void> {
    if (!doc) return
    const path = doc.path
    window.clearTimeout(saveTimer)
    if (inFlightSave) await inFlightSave
    const result = await host.read(path)
    if (isError(result)) {
      notify(result.error)
      return
    }
    if (doc?.path === path) installDocument(result)
    notify('已重新载入')
  }

  async function keepMine(): Promise<void> {
    if (await save(true, true)) notify('已用当前内容覆盖')
  }

  async function restoreDeleted(): Promise<void> {
    if (await save(true, true)) notify('已把内容写回原位置')
  }

  /* ---------------- 界面 ---------------- */
  function notify(msg: string): void {
    toastMsg = msg
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => (toastMsg = ''), 1900)
  }

  function setMode(next: Mode): void {
    if (mode === next) return
    mode = next
    try {
      localStorage.setItem(K_MODE, next)
    } catch {
      /* 忽略 */
    }
    sound.play('switch')
  }

  function applyTheme(next: Theme, silent = false): void {
    theme = next
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(K_THEME, next)
    } catch {
      /* 忽略 */
    }
    /* 原生窗口按钮跟着换色，不然暗色下会很扎眼 */
    void host.setOverlay(
      next === 'paper'
        ? { color: '#f6f1e7', symbolColor: '#6b6157' }
        : { color: '#16120f', symbolColor: '#a5977f' }
    )
    if (!silent) sound.play('switch')
  }

  function setFontSize(size: number): void {
    docFontSize = Math.max(14, Math.min(22, size))
    document.documentElement.style.setProperty('--doc-fs', `${docFontSize}px`)
    try {
      localStorage.setItem(K_FS, String(docFontSize))
    } catch {
      /* 忽略 */
    }
  }

  function toggleSound(): void {
    soundOn = !soundOn
    sound.setEnabled(soundOn)
    if (soundOn) sound.play('tick')
    notify(soundOn ? '界面音效已开启' : '界面音效已关闭')
  }

  function fmt(kind: FormatKind): void {
    if (mode === 'read') setMode('edit')
    editorHandle?.format(kind)
  }

  function gotoHeading(item: TocItem): void {
    const el = document.querySelector<HTMLElement>(`.md [id="${CSS.escape(item.id)}"]`)
    if (el && mode !== 'edit') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (mode === 'edit' || !el) editorHandle?.scrollToLine(item.line)
    sound.play('tick')
  }

  /* ---------------- 快捷键 ---------------- */
  function onKeydown(e: KeyboardEvent): void {
    if (closeRequest !== null) {
      if (e.key === 'Escape') {
        e.preventDefault()
        void decideClose('cancel')
      }
      return
    }
    const mod = e.ctrlKey || e.metaKey
    if (!mod || e.defaultPrevented) return
    const k = e.key.toLowerCase()

    if (k === 's') {
      e.preventDefault()
      void save(true)
    } else if (k === 'o') {
      e.preventDefault()
      void (e.shiftKey ? pickFolder() : pickFile())
    } else if (k === '1') {
      e.preventDefault()
      setMode('edit')
    } else if (k === '2') {
      e.preventDefault()
      setMode('split')
    } else if (k === '3') {
      e.preventDefault()
      setMode('read')
    } else if (k === '=' || k === '+') {
      e.preventDefault()
      setFontSize(docFontSize + 1)
    } else if (k === '-') {
      e.preventDefault()
      setFontSize(docFontSize - 1)
    } else if (k === '\\') {
      e.preventDefault()
      applyTheme(theme === 'paper' ? 'ink' : 'paper')
    } else if (k === 'm' && e.shiftKey) {
      e.preventDefault()
      toggleSound()
    }
  }

  async function handleClose(requestId: number): Promise<void> {
    window.clearTimeout(saveTimer)
    // A clean document can close immediately. Never silently save dirty text.
    if (!dirty && !inFlightSave) {
      await host.confirmClose(requestId, 'discard')
      return
    }
    stopping = true
    closeRequest = requestId
  }

  async function decideClose(decision: 'save' | 'discard' | 'cancel'): Promise<void> {
    if (closeRequest === null) return
    const id = closeRequest
    if (decision === 'save') {
      // Resolving an external conflict is a separate, explicit action.
      if (banner || !(await flush())) return
    }
    await host.confirmClose(id, decision)
    closeRequest = null
    if (decision === 'cancel') {
      stopping = false
      if (!banner) scheduleSave()
    }
  }

  /* ---------------- 启动 ---------------- */
  onMount(() => {
    try {
      const savedTheme = localStorage.getItem(K_THEME)
      applyTheme(savedTheme === 'ink' ? 'ink' : 'paper', true)

      const savedFs = Number(localStorage.getItem(K_FS))
      if (savedFs) setFontSize(savedFs)

      const savedMode = localStorage.getItem(K_MODE) as Mode | null
      if (savedMode === 'edit' || savedMode === 'split' || savedMode === 'read') mode = savedMode
    } catch {
      /* 偏好读不出来就用默认值 */
    }

    const offClose = host.onBeforeClose(({ requestId }) => void handleClose(requestId))
    const offOpen = host.onOpenFile((p) => void openDoc(p))
    const offChange = host.onExternalChange((evt) => {
      if (!doc || evt.path !== doc.path) return
      window.clearTimeout(saveTimer)
      banner = evt.deleted ? { kind: 'deleted' } : { kind: 'external', mtime: evt.mtime }
    })

    void (async () => {
      try {
        const p = await host.startupFile()
        if (p) await openDoc(p)
      } finally {
        booting = false
      }
    })()

    window.addEventListener('keydown', onKeydown)

    /* 拖拽：拦住默认导航（否则整个应用会被拖进来的文件顶掉），并给出提示 */
    let dragDepth = 0
    const onDragEnter = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth++
      dragging = true
    }
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (): void => {
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) dragging = false
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      dragDepth = 0
      dragging = false
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)

    return () => {
      offClose()
      offOpen()
      offChange()
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.clearTimeout(saveTimer)
      window.clearTimeout(previewTimer)
      window.clearTimeout(toastTimer)
      editorHandle = null
    }
  })
</script>

<div class="app">
  <header class="topbar">
    <div class="logo">纸<em>·</em>墨</div>

    {#if doc}
      <div class="crumbs">{shortDir} / <b>{doc.name}</b></div>
      <span class="saved {saveClass}">{saveLabel}</span>
    {:else}
      <div class="crumbs">安静的本地 Markdown 编辑器</div>
    {/if}

    <div class="spacer"></div>

    <div class="seg">
      <button class={mode === 'edit' ? 'on' : ''} onclick={() => setMode('edit')}>写作</button>
      <button class={mode === 'split' ? 'on' : ''} onclick={() => setMode('split')}>对照</button>
      <button class={mode === 'read' ? 'on' : ''} onclick={() => setMode('read')}>阅读</button>
    </div>
  </header>

  <div class="body">
    {#if doc}
      <aside class="sidebar">
        <section class="side-sec">
          <h4>
            <span>文稿</span>
            <span class="side-actions">
              <button title="打开文件" aria-label="打开文件" onclick={() => void pickFile()}><Icon name="open" size={14} /></button>
              <button title="打开目录" aria-label="打开目录" onclick={() => void pickFolder()}><Icon name="folder" size={14} /></button>
              <button title="刷新列表" aria-label="刷新列表" onclick={() => void refreshDocs(folderRoot || doc!.dir)}><Icon name="refresh" size={13} /></button>
            </span>
          </h4>
          {#each docs as item (item.path)}
            <button
              class={`doc-item ${item.path === doc?.path ? 'on' : ''}`}
              onclick={() => void openDoc(item.path)}
              title={item.path}
            >
              <span class="doc-name">{item.name}</span>
              <span class="doc-meta">{formatTime(item.mtime)} · {item.size > 1024 ? `${Math.round(item.size / 1024)} KB` : `${item.size} B`}</span>
            </button>
          {/each}
          {#if !docs.length}
            <div class="side-empty">这个目录里没有别的文档</div>
          {/if}
        </section>

        <section class="side-sec outline">
          <h4><span>大纲</span></h4>
          {#each toc as item (item.id)}
            <a
              class={`l${item.level}`}
              href={`#${item.id}`}
              onclick={(e) => {
                e.preventDefault()
                gotoHeading(item)
              }}>{item.text}</a
            >
          {/each}
          {#if !toc.length}
            <div class="side-empty">还没有标题</div>
          {/if}
        </section>
      </aside>
    {/if}

    <main class="work">
      {#if booting}
        <div class="empty"></div>
      {:else if !doc}
        <div class="empty">
          <div class="seal">纸墨</div>
          <h1>一间安静的写作房间</h1>
          <p>打开一个 Markdown 文件，或者选一个放笔记的目录。</p>

          <div class="empty-actions">
            <button class="btn primary" onclick={() => void pickFile()}>打开文件</button>
            <button class="btn ghost" onclick={() => void pickFolder()}>打开目录</button>
          </div>

          <div class="empty-keys">
            <span><kbd>Ctrl</kbd>+<kbd>O</kbd> 打开文件</span>
            <span><kbd>Ctrl</kbd>+<kbd>⇧</kbd>+<kbd>O</kbd> 打开目录</span>
            <span><kbd>Ctrl</kbd>+<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> 写作·对照·阅读</span>
            <span><kbd>Ctrl</kbd>+<kbd>\</kbd> 换主题</span>
          </div>
        </div>
      {:else}
        <div class="toolbar">
          <button title="加粗" onclick={() => fmt('bold')}><Icon name="bold" /></button>
          <button title="斜体" onclick={() => fmt('italic')}><Icon name="italic" /></button>
          <button title="删除线" onclick={() => fmt('strike')}><Icon name="strike" /></button>
          <button title="行内代码" onclick={() => fmt('inline-code')}><Icon name="code" size={16} /></button>
          <span class="divider"></span>
          <button title="一级标题" onclick={() => fmt('h1')} class="h-btn">H1</button>
          <button title="二级标题" onclick={() => fmt('h2')} class="h-btn">H2</button>
          <button title="引用" onclick={() => fmt('quote')}><Icon name="quote" /></button>
          <span class="divider"></span>
          <button title="无序列表" onclick={() => fmt('ul')}><Icon name="ul" /></button>
          <button title="有序列表" onclick={() => fmt('ol')}><Icon name="ol" /></button>
          <button title="任务清单" onclick={() => fmt('task')}><Icon name="task" /></button>
          <span class="divider"></span>
          <button title="插入链接" onclick={() => fmt('link')}><Icon name="link" /></button>
          <button title="插入图片" onclick={() => fmt('image')}><Icon name="image" /></button>
          <button title="代码块" onclick={() => fmt('code')}><Icon name="code" /></button>
          <button title="插入表格" onclick={() => fmt('table')}><Icon name="table" /></button>
          <button title="分割线" onclick={() => fmt('hr')}><Icon name="hr" /></button>

          <div class="right">
            <button title="字号更小" class="txt-btn" onclick={() => setFontSize(docFontSize - 1)}>A−</button>
            <button title="字号更大" class="txt-btn" onclick={() => setFontSize(docFontSize + 1)}>A+</button>
            <button
              title={theme === 'paper' ? '切到夜墨 (Ctrl+\\)' : '切到宣纸 (Ctrl+\\)'}
              onclick={() => applyTheme(theme === 'paper' ? 'ink' : 'paper')}
            >
              <Icon name={theme === 'paper' ? 'moon' : 'sun'} />
            </button>
            <button
              title={soundOn ? '关闭界面音效 (Ctrl+⇧+M)' : '开启界面音效 (Ctrl+⇧+M)'}
              onclick={toggleSound}
            >
              <Icon name={soundOn ? 'soundOn' : 'soundOff'} />
            </button>
          </div>
        </div>

        {#if closeRequest !== null}
          <div class="close-backdrop" role="presentation">
            <div class="close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="close-title" aria-describedby="close-description">
              <div class="close-mark"><Icon name="save" size={20} /></div>
              <h2 id="close-title">要保存这次修改吗？</h2>
              <p id="close-description">“{doc?.name ?? '当前文稿'}”还有未保存的内容。</p>
              {#if saveError}<p class="close-error">{saveError}</p>{/if}
              {#if banner}<p class="close-error">文件在外部有变化。请返回编辑器处理冲突后再保存。</p>{/if}
              <div class="close-actions">
                <button class="close-cancel" onclick={() => void decideClose('cancel')}>继续编辑</button>
                <button class="close-discard" onclick={() => void decideClose('discard')}>不保存，退出</button>
                <button class="close-save" disabled={Boolean(banner)} onclick={() => void decideClose('save')}>{saveError ? '重试保存并退出' : '保存并退出'}</button>
              </div>
            </div>
          </div>
        {/if}
        {#if saveError && !banner && closeRequest === null}
          <div class="banner" role="alert">
            <span class="grow">保存失败：{saveError}</span>
            <button onclick={() => void save(true)}>重试保存</button>
          </div>
        {/if}
        {#if banner}
          <div class="banner" role="alert">
            {#if banner.kind === 'deleted'}
              <span class="grow">这个文件已经被删除或移动了。</span>
              <button onclick={() => void restoreDeleted()}>写回原位置</button>

            {:else}
              <span class="grow">文件在外部被修改过。</span>
              <button onclick={() => void reloadFromDisk()}>重新载入</button>
              <button class="link" onclick={() => void keepMine()}>保留我的版本</button>
            {/if}
          </div>
        {/if}

        <div class={`panes mode-${mode}`}>
          <div class="pane pane-editor">
            <div class="pane-label">Markdown</div>
            <EditorPane
              onReady={(handle) => {
                editorHandle = handle
                handle.setDoc(content)
              }}
              onChange={() => {
                if (!editorHandle) return
                content = editorHandle.getDoc()
                schedulePreview()
                scheduleSave()
              }}
              onSave={() => void save(true)}
            />
          </div>

          <div class="pane pane-preview">
            <div class="pane-label">预览</div>
            <PreviewPane
              {html}
              baseDir={doc.dir}
              onOpenDoc={(p, fragment) => void openDoc(p, undefined, fragment)}
              onScrollRatio={(r) => (progress = r)}
            />
          </div>
        </div>
      {/if}
    </main>
  </div>

  <footer class="statusbar">
    <span>{words} 字</span>
    <span class="dot"></span>
    <span>约 {readingMinutes(words)} 分钟读完</span>
    {#if doc}
      <span class="dot"></span>
      <span>{encLabel}</span>
    {/if}
    <div class="spacer"></div>
    <button class="reveal" onclick={() => doc && host.reveal(doc.path)} title="在资源管理器中显示">
      <Icon name="open" size={13} />
    </button>
    <div class="progress"><b style={`width:${Math.round(progress * 100)}%`}></b></div>
  </footer>
</div>

{#if toastMsg}
  <div class="toast show">{toastMsg}</div>
{/if}

{#if dragging}
  <div class="drop-hint">
    <div class="drop-inner">
      <div class="seal">放下</div>
      <span>松手即打开这个文件</span>
    </div>
  </div>
{/if}

<style>
  .h-btn {
    font-family: var(--font-serif);
    font-size: 11.5px !important;
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  .txt-btn {
    font-family: var(--font-serif);
    font-size: 12px !important;
  }
  .reveal {
    color: var(--ink-3);
    padding: 2px 5px;
    border-radius: 5px;
    display: inline-flex;
    transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
  }
  .reveal:hover {
    color: var(--ink);
    background: var(--paper-2);
  }

  /* 拖拽提示：整窗一层薄雾，中间一枚印章 */
  .drop-hint {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--paper) 72%, transparent);
    backdrop-filter: blur(6px);
    pointer-events: none;
    animation: hint-in 160ms var(--ease) both;
  }
  @keyframes hint-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .drop-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    font-size: 14px;
    color: var(--ink-2);
  }
  .drop-inner .seal {
    margin-bottom: 0;
    animation: hint-pop 220ms var(--ease) both;
  }
  @keyframes hint-pop {
    from {
      transform: rotate(-2.5deg) scale(0.9);
      opacity: 0;
    }
    to {
      transform: rotate(-2.5deg) scale(1);
      opacity: 1;
    }
  }
</style>

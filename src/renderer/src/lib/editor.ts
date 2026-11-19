import { EditorState, EditorSelection, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  placeholder,
  drawSelection,
  highlightActiveLine,
  rectangularSelection,
  crosshairCursor
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { searchKeymap } from '@codemirror/search'

/* ============================================================
   主题：让源码本身也长得像纸上的字
   ============================================================ */

const paperTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      backgroundColor: 'transparent',
      color: 'var(--ink)',
      fontSize: 'var(--doc-fs, 16px)'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.88',
      overflow: 'auto',
      padding: '2px 0 70px'
    },
    '.cm-content': {
      padding: '0 30px',
      caretColor: 'var(--accent)'
    },
    '.cm-line': { padding: '0' },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--accent)',
      borderLeftWidth: '2px'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--accent-soft)'
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--paper-2) 52%, transparent)',
      borderRadius: '4px'
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-placeholder': {
      color: 'var(--ink-3)',
      fontStyle: 'italic'
    },
    '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
      borderRadius: '3px'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 38%, transparent)'
    },
    '.cm-panels': {
      backgroundColor: 'var(--paper-2)',
      color: 'var(--ink)',
      borderColor: 'var(--line)'
    },
    '.cm-panels input, .cm-panels button': {
      fontFamily: 'var(--font-sans)',
      color: 'var(--ink)'
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--paper-2)',
      border: '1px solid var(--line)',
      color: 'var(--ink-3)'
    }
  },
  { dark: false }
)

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.52em', fontWeight: '700', color: 'var(--ink)', lineHeight: '1.4' },
  { tag: t.heading2, fontSize: '1.28em', fontWeight: '700', color: 'var(--ink)' },
  { tag: t.heading3, fontSize: '1.13em', fontWeight: '700', color: 'var(--ink)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--ink-2)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--ink)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--ink-3)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', color: 'var(--accent-ink)' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--accent)' },
  { tag: [t.processingInstruction, t.meta, t.punctuation], color: 'var(--ink-3)' },
  { tag: t.comment, color: 'var(--ink-3)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--accent)' }
])

/* ============================================================
   编辑命令
   ============================================================ */

function surround(view: EditorView, before: string, after: string, ghost: string): void {
  const { state } = view
  const tr = state.changeByRange((range) => {
    const selected = state.sliceDoc(range.from, range.to)
    const inner = selected || ghost
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length)
    }
  })
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }))
  view.focus()
}

function insertBlock(view: EditorView, text: string): void {
  const { state } = view
  const sel = state.selection.main
  const line = state.doc.lineAt(sel.from)
  /* 块级插入永远另起一行，别把已有段落搅乱 */
  const needsLeadingBreak = line.text.trim().length > 0
  const insert = (needsLeadingBreak ? '\n\n' : '') + text
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: EditorSelection.cursor(line.to + insert.length),
    scrollIntoView: true,
    userEvent: 'input.format'
  })
  view.focus()
}

function toggleLinePrefix(view: EditorView, prefix: string): void {
  const { state } = view
  const sel = state.selection.main
  const first = state.doc.lineAt(sel.from)
  const last = state.doc.lineAt(sel.to)

  const lines: { from: number; text: string }[] = []
  for (let n = first.number; n <= last.number; n++) {
    const line = state.doc.line(n)
    lines.push({ from: line.from, text: line.text })
  }
  const allHave = lines.every((l) => l.text.startsWith(prefix))
  const changes = lines.map((l) =>
    allHave ? { from: l.from, to: l.from + prefix.length, insert: '' } : { from: l.from, insert: prefix }
  )
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' })
  view.focus()
}

function toggleUnorderedList(view: EditorView, task: boolean): void {
  const { state } = view
  const sel = state.selection.main
  const first = state.doc.lineAt(sel.from)
  const last = state.doc.lineAt(sel.to)
  const lines = []
  for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n))

  const marker = task ? /^(\s*)[-*+]\s+\[[ xX]\]\s+/ : /^(\s*)[-*+]\s+/
  const allHave = lines.every((line) => marker.test(line.text))
  const changes = lines.map((line) => {
    const match = marker.exec(line.text)
    if (allHave && match) return { from: line.from, to: line.from + match[0].length, insert: match[1] }
    if (match) return { from: line.from, to: line.from + match[0].length, insert: `${match[1]}${task ? '- [ ] ' : '- '}` }
    return { from: line.from, insert: task ? '- [ ] ' : '- ' }
  })
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' })
  view.focus()
}

/** 有序列表要按行递增编号，并统一混合选择中的已有标记。 */
function toggleOrderedList(view: EditorView): void {
  const { state } = view
  const sel = state.selection.main
  const first = state.doc.lineAt(sel.from)
  const last = state.doc.lineAt(sel.to)
  const lines = []
  for (let n = first.number; n <= last.number; n++) lines.push(state.doc.line(n))
  const marker = /^(\s*)\d+[.)]\s+/
  const allHave = lines.every((line) => marker.test(line.text))
  const changes = lines.map((line, index) => {
    const match = marker.exec(line.text)
    if (allHave && match) return { from: line.from, to: line.from + match[0].length, insert: match[1] }
    const prefix = `${index + 1}. `
    if (match) return { from: line.from, to: line.from + match[0].length, insert: `${match[1]}${prefix}` }
    return { from: line.from, insert: prefix }
  })
  view.dispatch({ changes, scrollIntoView: true, userEvent: 'input.format' })
  view.focus()
}

export type FormatKind =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inline-code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'quote'
  | 'ul'
  | 'ol'
  | 'task'
  | 'link'
  | 'image'
  | 'code'
  | 'table'
  | 'hr'

function format(view: EditorView, kind: FormatKind): void {
  switch (kind) {
    case 'bold':
      return surround(view, '**', '**', '粗体')
    case 'italic':
      return surround(view, '*', '*', '斜体')
    case 'strike':
      return surround(view, '~~', '~~', '删除线')
    case 'inline-code':
      return surround(view, '`', '`', 'code')
    case 'h1':
      return toggleLinePrefix(view, '# ')
    case 'h2':
      return toggleLinePrefix(view, '## ')
    case 'h3':
      return toggleLinePrefix(view, '### ')
    case 'quote':
      return toggleLinePrefix(view, '> ')
    case 'ul':
      return toggleUnorderedList(view, false)
    case 'task':
      return toggleUnorderedList(view, true)
    case 'ol':
      return toggleOrderedList(view)
    case 'link':
      return surround(view, '[', '](https://)', '链接')
    case 'image':
      return surround(view, '![', '](图片路径)', '图片说明')
    case 'code':
      return insertBlock(view, '```\n\n```')
    case 'table':
      return insertBlock(
        view,
        '| 列一 | 列二 |\n| --- | --- |\n|  |  |'
      )
    case 'hr':
      return insertBlock(view, '---')
  }
}

/* ============================================================
   对外句柄
   ============================================================ */

export interface EditorOptions {
  onChange(): void
  onSave(): void
  onScrollTop(ratio: number): void
}

export interface EditorHandle {
  view: EditorView
  getDoc(): string
  setDoc(text: string): void
  format(kind: FormatKind): void
  focus(): void
  scrollToLine(line: number): void
  destroy(): void
}

export function createEditor(parent: HTMLElement, opts: EditorOptions): EditorHandle {
  const saveKey: Extension = keymap.of([
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        opts.onSave()
        return true
      }
    },
    {
      key: 'Mod-Shift-k',
      preventDefault: true,
      run: () => {
        format(view, 'strike')
        return true
      }
    }
  ])

  const makeState = (doc: string): EditorState => EditorState.create({
      doc,
      extensions: [
        saveKey,
        history(),
        drawSelection(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, addKeymap: true }),
        syntaxHighlighting(mdHighlight),
        paperTheme,
        placeholder('从这里开始写……'),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) opts.onChange()
        })
      ]
    })

  const view = new EditorView({ parent, state: makeState('') })

  /* 同步滚动比例给预览，做粗粒度联动 */
  let ticking = false
  view.scrollDOM.addEventListener(
    'scroll',
    () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const el = view.scrollDOM
        const max = el.scrollHeight - el.clientHeight
        opts.onScrollTop(max > 0 ? el.scrollTop / max : 0)
      })
    },
    { passive: true }
  )

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc(text: string) {
      // A fresh state isolates undo history and does not emit a user edit.
      view.setState(makeState(text))
      view.scrollDOM.scrollTop = 0
    },
    format: (kind) => format(view, kind),
    focus: () => view.focus(),
    scrollToLine(line: number) {
      const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
      view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
      view.focus()
    },
    destroy: () => view.destroy()
  }
}

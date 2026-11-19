import MarkdownIt, { type MarkdownIt as MarkdownEngine } from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/* 精确引入：只打包真正会用到的语法和一款主题，
   避免整包 shiki 拖进几百个用不上的语言。 */
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import themeVitesseDark from 'shiki/themes/vitesse-dark.mjs'
import langJavascript from 'shiki/langs/javascript.mjs'
import langTypescript from 'shiki/langs/typescript.mjs'
import langJsx from 'shiki/langs/jsx.mjs'
import langTsx from 'shiki/langs/tsx.mjs'
import langJson from 'shiki/langs/json.mjs'
import langPython from 'shiki/langs/python.mjs'
import langBash from 'shiki/langs/bash.mjs'
import langPowershell from 'shiki/langs/powershell.mjs'
import langHtml from 'shiki/langs/html.mjs'
import langCss from 'shiki/langs/css.mjs'
import langScss from 'shiki/langs/scss.mjs'
import langMarkdown from 'shiki/langs/markdown.mjs'
import langYaml from 'shiki/langs/yaml.mjs'
import langToml from 'shiki/langs/toml.mjs'
import langIni from 'shiki/langs/ini.mjs'
import langSql from 'shiki/langs/sql.mjs'
import langRust from 'shiki/langs/rust.mjs'
import langGo from 'shiki/langs/go.mjs'
import langJava from 'shiki/langs/java.mjs'
import langC from 'shiki/langs/c.mjs'
import langCpp from 'shiki/langs/cpp.mjs'
import langCsharp from 'shiki/langs/csharp.mjs'
import langPhp from 'shiki/langs/php.mjs'
import langRuby from 'shiki/langs/ruby.mjs'
import langLua from 'shiki/langs/lua.mjs'
import langDiff from 'shiki/langs/diff.mjs'
import langXml from 'shiki/langs/xml.mjs'
import langVue from 'shiki/langs/vue.mjs'
import langSvelte from 'shiki/langs/svelte.mjs'

/* ============================================================
   代码高亮
   ============================================================ */

/**
 * 代码块统一用深色主题，压在暖纸页面上——这是"纸墨"的视觉锚点之一。
 * 亮色主题下会显得灰蒙蒙，所以两套主题都用同一档深色。
 */
const CODE_THEME = 'vitesse-dark'

/** 常用语言有限的一批，够覆盖笔记里 99% 的代码块 */
const LANGS = [
  langJavascript,
  langTypescript,
  langJsx,
  langTsx,
  langJson,
  langPython,
  langBash,
  langPowershell,
  langHtml,
  langCss,
  langScss,
  langMarkdown,
  langYaml,
  langToml,
  langIni,
  langSql,
  langRust,
  langGo,
  langJava,
  langC,
  langCpp,
  langCsharp,
  langPhp,
  langRuby,
  langLua,
  langDiff,
  langXml,
  langVue,
  langSvelte
]

const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  console: 'bash',
  ps: 'powershell',
  ps1: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  cs: 'csharp',
  rs: 'rust',
  golang: 'go',
  text: '',
  plain: '',
  txt: '',
  '': ''
}

let highlighter: HighlighterCore | null = null
let langSet = new Set<string>()

/** 应用启动时 await 一次，之后渲染就是纯同步的 */
export async function initHighlighter(): Promise<void> {
  highlighter = await createHighlighterCore({
    themes: [themeVitesseDark],
    langs: LANGS,
    /* 用 JS 正则引擎而不是 oniguruma wasm：启动更快、不额外加载 wasm 文件 */
    engine: createJavaScriptRegexEngine()
  })
  langSet = new Set(highlighter.getLoadedLanguages())
}

function resolveLang(raw: string): string {
  const first = (raw || '').trim().split(/\s+/)[0].toLowerCase()
  if (!first) return ''
  const mapped = first in ALIASES ? ALIASES[first] : first
  return langSet.has(mapped) ? mapped : ''
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ============================================================
   资源路径：把 md 里的相对路径接到自定义协议上
   ============================================================ */

function toMediaUrl(abs: string): string {
  return 'mdlocal://local/?p=' + encodeURIComponent(abs)
}

export function resolveAsset(src: string, baseDir: string): string {
  if (!src) return src
  if (/^(https?:|data:|blob:|mdlocal:|mailto:|#)/i.test(src)) return src

  let p = src
  try {
    p = decodeURI(src)
  } catch {
    /* 保持原样 */
  }
  p = p.replace(/\\/g, '/').split('#')[0].split('?')[0]

  /* 已经是绝对路径 */
  if (/^[a-zA-Z]:\//.test(p)) return toMediaUrl(p.replace(/\//g, '\\'))
  if (p.startsWith('//')) return toMediaUrl(p)

  const base = (baseDir || '').replace(/\\/g, '/')
  const out: string[] = []
  for (const seg of (base + '/' + p).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return toMediaUrl(out.join('\\'))
}

/* ============================================================
   数学公式插件
   ============================================================ */

function mathPlugin(md: MarkdownEngine): void {
  /* 行内：$...$ */
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const start = state.pos
    if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false
    if (state.src.charCodeAt(start + 1) === 0x24) return false

    const next = state.src.charCodeAt(start + 1)
    if (next === 0x20 || next === 0x0a || Number.isNaN(next)) return false

    let pos = start + 1
    let close = -1
    while (pos < state.posMax) {
      const idx = state.src.indexOf('$', pos)
      if (idx < 0 || idx >= state.posMax) break
      if (state.src[idx - 1] === '\\') {
        pos = idx + 1
        continue
      }
      close = idx
      break
    }
    if (close < 0) return false

    const content = state.src.slice(start + 1, close)
    if (!content.trim()) return false
    if (/\s$/.test(content)) return false

    if (!silent) {
      const token = state.push('math_inline', 'math', 0)
      token.content = content
      token.markup = '$'
    }
    state.pos = close + 1
    return true
  })

  /* 块级：$$ ... $$ */
  md.block.ruler.before(
    'fence',
    'math_block',
    (state, startLine, endLine, silent) => {
      const pos = state.bMarks[startLine] + state.tShift[startLine]
      const max = state.eMarks[startLine]
      if (pos + 2 > max) return false
      if (state.src.slice(pos, pos + 2) !== '$$') return false

      const firstLine = state.src.slice(pos + 2, max)
      let content = ''
      let lastLine = startLine
      let closed = false

      if (firstLine.trim().endsWith('$$') && firstLine.trim().length > 2) {
        content = firstLine.trim().slice(0, -2)
        closed = true
      } else {
        content = firstLine
        let line = startLine
        while (++line < endLine) {
          const ls = state.bMarks[line] + state.tShift[line]
          const le = state.eMarks[line]
          const text = state.src.slice(ls, le)
          const idx = text.indexOf('$$')
          if (idx >= 0) {
            content += '\n' + text.slice(0, idx)
            lastLine = line
            closed = true
            break
          }
          content += '\n' + text
        }
      }
      if (!closed) return false
      if (silent) return true

      const token = state.push('math_block', 'math', 0)
      token.block = true
      token.content = content.trim()
      token.map = [startLine, lastLine + 1]
      state.line = lastLine + 1
      return true
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] }
  )

  const render = (tex: string, display: boolean): string => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' })
    } catch {
      return `<span class="math-error">${escapeHtml(tex)}</span>`
    }
  }
  md.renderer.rules.math_inline = (tokens, idx) => render(tokens[idx].content, false)
  md.renderer.rules.math_block = (tokens, idx) => render(tokens[idx].content, true) + '\n'
}

/* ============================================================
   Markdown 实例
   ============================================================ */

export interface TocItem {
  id: string
  text: string
  level: number
  line: number
}

interface RenderEnv {
  [key: string | symbol]: unknown
  baseDir: string
  toc: TocItem[]
  used: Map<string, number>
}

export function createRenderer(): MarkdownEngine {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
    typographer: false,
    highlight(code, lang): string {
      const language = resolveLang(lang)
      if (highlighter && language) {
        try {
          const html = highlighter.codeToHtml(code, { lang: language, theme: CODE_THEME })
          /* 把语言名挂到 <pre> 上，样式和复制按钮靠它 */
          return html.replace('<pre class="shiki', `<pre data-lang="${language}" class="shiki`)
        } catch {
          /* 落到下面的纯文本分支 */
        }
      }
      const label = (lang || 'text').trim().slice(0, 24)
      return `<pre data-lang="${escapeHtml(label)}"><code>${escapeHtml(code)}</code></pre>`
    }
  })

  md.use(footnote)
  md.use(taskLists, { enabled: false, label: false })
  mathPlugin(md)

  /* 表格外面套一层，窄屏可以横向滚动 */
  md.core.ruler.push('wrap_table', (state) => {
    const tokens = state.tokens
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'table_open') tokens[i].attrJoin('class', 'md-table')
    }
  })

  /* 标题：稳定、可外链的锚点 */
  md.renderer.rules.heading_open = (tokens, idx, options, rawEnv, self) => {
    const env = rawEnv as unknown as RenderEnv
    const inline = tokens[idx + 1]
    const rawText = inline?.content ?? ''
    const id = uniqueSlug(rawText, env.used)

    tokens[idx].attrSet('id', id)
    if (inline) {
      env.toc.push({
        id,
        text: rawText.replace(/[*_~`]/g, '').trim(),
        level: Number(tokens[idx].tag.slice(1)),
        line: (tokens[idx].map?.[0] ?? 0) + 1
      })
    }
    return self.renderToken(tokens, idx, options)
  }

  /* 图片 / 链接 */
  md.renderer.rules.image = (tokens, idx, options, rawEnv, self) => {
    const env = rawEnv as unknown as RenderEnv
    const token = tokens[idx]
    const raw = String(token.attrGet('src') || '')
    token.attrSet('src', resolveAsset(raw, env.baseDir))
    token.attrSet('loading', 'lazy')
    token.attrSet('decoding', 'async')
    /* 只有一张图独占一行时才当块级处理 */
    const alt = token.content || ''
    if (alt) token.attrSet('alt', alt)
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    const href = String(tokens[idx].attrGet('href') || '')
    if (/^https?:/i.test(href)) {
      tokens[idx].attrSet('target', '_blank')
      tokens[idx].attrSet('rel', 'noreferrer noopener')
    }
    return self.renderToken(tokens, idx, options)
  }

  return md
}

/** 标题 slug：中文直接保留，空格转连字符，同文去重 */
function uniqueSlug(text: string, used: Map<string, number>): string {
  let base = text
    .trim()
    .toLowerCase()
    .replace(/[*_~`"'’“”]/g, '')
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
    .replace(/^-+|-+$/g, '')
  if (!base) base = 'section'

  /* Reserve every emitted id, including suffixed ids. This avoids a later
     heading named "title-1" colliding with the second heading named "title". */
  let candidate = base
  let suffix = used.get(base) ?? 0
  while (used.has(candidate)) {
    suffix++
    candidate = `${base}-${suffix}`
  }
  used.set(base, suffix)
  used.set(candidate, 0)
  return candidate
}

/* ============================================================
   对外入口
   ============================================================ */

let md: MarkdownEngine | null = null

function instance(): MarkdownEngine {
  if (!md) md = createRenderer()
  return md
}

export interface RenderResult {
  html: string
  toc: TocItem[]
}

export function renderMarkdown(src: string, baseDir: string): RenderResult {
  const env: RenderEnv = { baseDir, toc: [], used: new Map() }
  const html = instance().render(src, env)
  return { html, toc: env.toc }
}

/** 目录里没有标题时，给一个兜底的空态 */
export function hasHeadings(toc: TocItem[]): boolean {
  return toc.length > 0
}

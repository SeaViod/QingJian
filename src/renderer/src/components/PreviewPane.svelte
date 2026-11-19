<script lang="ts">
  import { onMount } from 'svelte'
  import { host } from '../lib/host'
  import DOMPurify from 'dompurify'

  interface Props {
    html: string
    baseDir: string
    onOpenDoc: (path: string, fragment?: string) => void
    onScrollRatio?: (ratio: number) => void
  }

  let { html, baseDir, onOpenDoc, onScrollRatio }: Props = $props()

  let scroller: HTMLDivElement
  let article: HTMLElement
  let lightbox = $state<{ src: string; alt: string } | null>(null)
  // Sanitize before attaching markup to the live DOM. Preserve KaTeX MathML.
  function safeMarkup(markup: string): string {
    return DOMPurify.sanitize(markup, {
      USE_PROFILES: { html: true, svg: true, mathMl: true },
      FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'video', 'audio'],
      FORBID_ATTR: ['srcdoc', 'autofocus'],
      ADD_URI_SAFE_ATTR: [],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mdlocal):|data:image\/(?:png|jpe?g|gif|webp);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
    })
  }

  /** 给代码块补上语言标签和复制按钮 */
  function decorate(pre: HTMLElement): void {
    const lang = pre.getAttribute('data-lang') || ''
    if (lang) {
      const tag = document.createElement('span')
      tag.className = 'code-lang'
      tag.textContent = lang
      pre.appendChild(tag)
    }
    const btn = document.createElement('button')
    btn.className = 'code-copy'
    btn.type = 'button'
    btn.textContent = '复制'
    const id = Math.random().toString(36).slice(2)
    btn.dataset.id = id
    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code')
      if (!code) return
      try {
        await navigator.clipboard.writeText(code.innerText)
      } catch {
        const ta = document.createElement('textarea')
        ta.value = code.innerText
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      btn.textContent = '已复制'
      btn.classList.add('done')
      window.setTimeout(() => {
        btn.textContent = '复制'
        btn.classList.remove('done')
      }, 1500)
    })
    pre.appendChild(btn)
  }

  function renderInto(root: HTMLElement, markup: string): void {
    root.innerHTML = safeMarkup(markup)

    /* 表格包一层，窄屏可横向滚动 */
    for (const table of Array.from(root.querySelectorAll('table'))) {
      if (table.parentElement?.classList.contains('table-wrap')) continue
      const wrap = document.createElement('div')
      wrap.className = 'table-wrap'
      table.replaceWith(wrap)
      wrap.appendChild(table)
    }

    for (const pre of Array.from(root.querySelectorAll('pre'))) decorate(pre as HTMLElement)

    /* 标题前挂一个 ¶ 锚点 */
    for (const h of Array.from(root.querySelectorAll('h1,h2,h3,h4'))) {
      if (!h.id) continue
      const a = document.createElement('a')
      a.className = 'anchor'
      a.href = `#${h.id}`
      a.textContent = '¶'
      a.setAttribute('aria-label', `定位到 ${h.textContent}`)
      h.prepend(a)
    }
  }

  $effect(() => {
    if (article && html !== undefined) renderInto(article, html)
  })

  /* 事件委托挂在容器上，避免每次重渲染都重新绑定 */
  onMount(() => {
    const el = article
    if (!el) return
    const listener = (e: MouseEvent): void => handleClick(e)
    el.addEventListener('click', listener)
    return () => el.removeEventListener('click', listener)
  })

  function handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement

    const img = target.closest('img')
    if (img) {
      lightbox = { src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '' }
      return
    }

    const anchor = target.closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    e.preventDefault()

    if (href.startsWith('#')) {
      const el = article.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    if (/^https?:/i.test(href)) {
      void host.openExternal(href)
      return
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-zA-Z]:[\\/]/.test(href)) return
    if (!href) return

    /* 相对路径：按 Markdown 文件所在目录解析；坏的百分号编码不应让点击处理崩溃。 */
    let decoded: string
    try { decoded = decodeURIComponent(href) } catch { return }
    const [pathPart, fragmentPart] = decoded.split('#', 2)
    if (!/\.(?:md|markdown|mdown|mkd|txt)$/i.test(pathPart)) return
    const abs = pathPart.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(pathPart)
      ? pathPart
      : `${baseDir}\\${pathPart}`.replace(/\//g, '\\')
    const parts: string[] = []
    for (const seg of abs.split(/[\\/]/)) {
      if (!seg || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    onOpenDoc(parts.join('\\'), fragmentPart ? `#${fragmentPart}` : undefined)
  }

  function handleScroll(): void {
    if (!onScrollRatio || !scroller) return
    const max = scroller.scrollHeight - scroller.clientHeight
    onScrollRatio(max > 0 ? scroller.scrollTop / max : 0)
  }

  function closeLightbox(): void {
    lightbox = null
  }

  function onLightboxKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeLightbox()
    }
  }
</script>

<div
  class="preview-scroll"
  bind:this={scroller}
  onscroll={handleScroll}
  role="document"
  tabindex="-1"
>
  <article class="md" bind:this={article}></article>
</div>

{#if lightbox}
  <div
    class="lightbox"
    role="button"
    tabindex="0"
    onclick={(e) => e.target === e.currentTarget && closeLightbox()}
    onkeydown={onLightboxKeydown}
  >
    <img src={lightbox.src} alt={lightbox.alt} />
    {#if lightbox.alt}<span class="lightbox-cap">{lightbox.alt}</span>{/if}
  </div>
{/if}

<style>
  .preview-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    scroll-behavior: smooth;
    outline: none;
  }

  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 48px;
    background: color-mix(in srgb, var(--paper) 78%, transparent);
    backdrop-filter: blur(14px);
    cursor: zoom-out;
    animation: lb-in 220ms var(--ease) both;
  }
  @keyframes lb-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .lightbox img {
    max-width: 100%;
    outline: 2px solid transparent;
    max-height: 100%;
    border-radius: 10px;
    box-shadow: 0 30px 80px -30px rgba(40, 26, 10, 0.6);
  }
  .lightbox-cap {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 12px;
    color: var(--ink-2);
    background: var(--card);
    padding: 5px 14px;
    border-radius: 999px;
  }
</style>

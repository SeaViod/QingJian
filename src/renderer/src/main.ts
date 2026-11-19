import { mount } from 'svelte'
import './styles/tokens.css'
import './styles/base.css'
import './styles/markdown.css'
import App from './App.svelte'
import { initHighlighter } from './lib/md'

if (import.meta.env.DEV && !window.host) {
  const { installBrowserHost } = await import('./lib/host-browser')
  installBrowserHost()
}

const target = document.getElementById('app')
if (!target) throw new Error('#app not found')

/**
 * 先把语法高亮器备好再挂载，避免首屏渲染出无高亮的原始代码再闪一下。
 * 高亮器起不来也不该拦住整个应用。
 */
initHighlighter()
  .catch((err) => {
    console.error('[md] 高亮器初始化失败，退回纯文本代码块', err)
  })
  .finally(() => {
    mount(App, { target })
  })

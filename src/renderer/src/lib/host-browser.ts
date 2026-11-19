/**
 * 浏览器兜底宿主。
 *
 * 只有在 `window.host` 缺失时才安装 —— 也就是：
 *   1. `vite` 单独跑渲染层做视觉调试时
 *   2. 将来把界面挂进 DSH 插件、还没接宿主服务时
 *
 * 它用内存里的一篇样本文件顶着，保证界面每个状态都能看到。
 */

import type { DocEntry, DocPayload, HostApi, WritePayload } from './host'

const SAMPLE = `# 写作的节奏

写作不是把想法倒出来，而是**给想法找一个呼吸的位置**。节奏对了，读者才愿意跟你走完一段长路。

## 先说清楚一件事

> 句子太长，读者会累；句子太短，读者会觉得你在喘气。

好的段落像一个完整的手势：起、承、落。中间可以停顿，但不能断气。

### 三条我常用的校正

1. **读出声**。舌头会帮你找出所有读起来别扭的地方。
2. **删掉第一个形容词**。它通常只是习惯，不是必要。
3. **把被动句翻过来**。主语明确，句子就有力量。

- 每段只做一件事
- 每句只承担一个意思
- 每个词都得挣到自己的位置

- [x] 今天写满 500 字
- [ ] 把第三章重读一遍
- [ ] 处理掉所有 \`TODO\`

## 一个例子

把这段话：

\`\`\`text
由于本次实验的过程中存在着诸多不可控的因素，因此最终的结果在一定程度上受到了影响。
\`\`\`

改成：

\`\`\`text
这次实验有三个不可控因素，结果因此偏了两成。
\`\`\`

差别不在文采，在于**有没有人愿意读第二遍**。

## 代码与公式

写作工具本身也该安静。比如这段配置：

\`\`\`javascript
const editor = createEditor(host, {
  autoSave: 900,
  sound: { enabled: true, volume: 0.5 }
})
\`\`\`

行内公式 $E = mc^2$ 说明不了什么，但块级的能：

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$

## 一张表

| 问题 | 症状 | 药方 |
| --- | --- | --- |
| 句子过长 | 读到一半想跳过 | 拆成两句 |
| 逻辑跳跃 | 读者跟丢 | 补一句过渡 |
| 用词抽象 | 记不住 | 换成具体的东西 |
| 结尾疲软 | 读完没感觉 | 把结论提前一句 |

---

节奏是改出来的，不是写出来的。
`

interface MockDoc {
  path: string
  name: string
  content: string
  encoding: string
  eol: 'lf' | 'crlf'
  bom: boolean
  mtime: number
  version?: { mtime: number; size: number; hash: string }
}

function seed(): Map<string, MockDoc> {
  const now = Date.now()
  const docs: MockDoc[] = [
    {
      path: 'C:\\笔记\\写作的节奏.md',
      name: '写作的节奏.md',
      content: SAMPLE,
      encoding: 'utf-8',
      eol: 'lf',
      bom: false,
      mtime: now - 1000 * 60 * 12
    },
    {
      path: 'C:\\笔记\\读书笔记·瓦尔登湖.md',
      name: '读书笔记·瓦尔登湖.md',
      content: '# 瓦尔登湖\n\n一个人越是能把许多事情放下，就越是富有。\n',
      encoding: 'utf-8',
      eol: 'lf',
      bom: false,
      mtime: now - 1000 * 60 * 60 * 26
    },
    {
      path: 'C:\\笔记\\关于慢生活.md',
      name: '关于慢生活.md',
      content: '# 关于慢生活\n\n慢不是效率的反面，是效率的前提。\n',
      encoding: 'utf-8',
      eol: 'lf',
      bom: false,
      mtime: now - 1000 * 60 * 60 * 24 * 5
    }
  ]
  return new Map(docs.map((d) => [d.path, d]))
}

export function installBrowserHost(): void {
  if (window.host) return

  const store = seed()
  const root = 'C:\\笔记'
  let watched: string | null = null
  const externalListeners = new Set<(evt: { path: string; mtime: number; deleted: boolean }) => void>()

  const versionOf = (d: MockDoc): { mtime: number; size: number; hash: string } => ({
    mtime: d.mtime,
    size: d.content.length,
    hash: `${d.content.length}:${d.content.slice(0, 24)}`
  })
  const toPayload = (d: MockDoc): DocPayload => ({
    path: d.path,
    name: d.name,
    dir: root,
    content: d.content,
    encoding: d.encoding,
    eol: d.eol,
    bom: d.bom,
    mtime: d.mtime,
    size: d.content.length,
    version: versionOf(d)
  })

  const api: HostApi = {
    kind: 'browser',

    async pickFile() {
      return 'C:\\笔记\\写作的节奏.md'
    },

    async pickFolder() {
      return root
    },

    async read(path) {
      const d = store.get(path)
      if (!d) return { error: `浏览器预览模式打不开这个文件：${path}` }
      return toPayload(d)
    },

    async write(path: string, payload: WritePayload) {
      const d = store.get(path)
      if (!d) return { error: '文件不存在' }
      const current = versionOf(d)
      if (payload.expected && !payload.force && JSON.stringify(payload.expected) !== JSON.stringify(current)) {
        return { error: '文件在外部被修改，请重新载入后再保存', conflict: true, current }
      }
      d.content = payload.content
      d.mtime = Date.now()
      d.version = versionOf(d)
      return { ok: true as const, mtime: d.mtime, version: d.version }
    },

    async listDocs() {
      const entries: DocEntry[] = [...store.values()].map((d) => ({
        path: d.path,
        name: d.name,
        rel: d.name,
        dir: root,
        mtime: d.mtime,
        size: d.content.length
      }))
      entries.sort((a, b) => b.mtime - a.mtime)
      return { dir: root, entries }
    },

    async stat(path) {
      const d = store.get(path)
      return d ? { exists: true, mtime: d.mtime, size: d.content.length } : { exists: false, mtime: 0, size: 0 }
    },

    reveal() {
      /* 浏览器里没有资源管理器 */
    },

    async watch(path) {
      watched = path
    },

    async openExternal(url) {
      window.open(url, '_blank', 'noopener')
    },

    async startupFile() {
      return 'C:\\笔记\\写作的节奏.md'
    },

    async setOverlay() {
      /* 没有原生窗口 */
    },

    async requestClose() { return { ok: true, requestId: null } },
    async confirmClose() { return { ok: true } },
    onBeforeClose() { return () => {} },

    onOpenFile() {
      return () => {}
    },

    onExternalChange(cb) {
      externalListeners.add(cb)
      return () => externalListeners.delete(cb)
    }
  }

  /* 挂一点点工具到 window，方便在控制台里造"外部改动" */
  ;(window as unknown as Record<string, unknown>).__mockTouch = (): void => {
    if (!watched) return
    const d = store.get(watched)
    if (!d) return
    for (const cb of externalListeners) cb({ path: watched, mtime: Date.now(), deleted: false })
  }

  window.host = api
}

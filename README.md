<div align="center">
  <img src="assets/app-icon.png" alt="纸墨图标" width="128" />
  <h1>纸墨</h1>
  <p>青简 2.0 · 一款专注本地编辑与阅读的 Windows Markdown 编辑器</p>
</div>

## 设计

暖纸、墨色与朱印构成“纸墨”的视觉语言。应用图标以手工纸页和朱印为主题；窗口支持暖纸与夜墨两种主题。

## 功能

- 使用 CodeMirror 编辑 Markdown，支持写作、对照和阅读三种模式。
- 实时预览标题目录、表格、任务清单、代码高亮、数学公式和图片。
- 打开单个文件或目录，也可以将文件拖入窗口。
- 编辑后约 900 毫秒自动保存；`Ctrl+S` 可立即保存。
- 文件被外部修改时暂停自动保存，可选择重新载入或保留本地版本。
- 关闭含有未保存修改的文稿时，先询问：**保存并退出、不保存退出、继续编辑**。
- 尽量保留 UTF-8、UTF-16、GB18030 等编码、BOM 与换行格式。
- 提供暖纸 / 夜墨主题和可关闭的轻柔界面音效。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl+O` | 打开文件 |
| `Ctrl+Shift+O` | 打开目录 |
| `Ctrl+S` | 立即保存 |
| `Ctrl+1` / `Ctrl+2` / `Ctrl+3` | 写作 / 对照 / 阅读 |
| `Ctrl+F` | 在编辑区查找 |
| `Ctrl++` / `Ctrl+-` | 调整字号 |
| `Ctrl+\\` | 切换暖纸 / 夜墨 |
| `Ctrl+Shift+M` | 开关界面音效 |

## 运行

需要 Node.js 与 npm。

```powershell
npm install
npm run dev
```

## 检查与 Windows 打包

```powershell
npm run check
npm run build
npm test
npm run pack
npm run dist
```

- `npm run pack`：生成 `release/win-unpacked/` 免安装目录。
- `npm run dist`：生成 Windows x64 便携版 `release/Zhimo-2.0.0-Windows-x64.exe`。

构建尚未签名，Windows 可能提示确认应用来源。本项目当前只配置 Windows x64，不包含 macOS 发布目标。

## 技术与数据安全

Electron + Svelte + CodeMirror。应用按本地文件工作，不上传文稿。保存使用同目录临时文件和原子替换；写入前比对文件版本，检测外部修改并避免静默覆盖。预览 HTML 在进入页面前进行清理。渲染界面通过 `window.host` 访问宿主能力，保留未来接入其他宿主的空间；目前尚未实现 DSH 插件。

本版以编辑和阅读已有文件为重点，暂不包含新建 / 另存为、云同步、AI 或语音输入。未知编码或显示异常的文件请先另存副本后再编辑。

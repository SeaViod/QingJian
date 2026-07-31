# 青简 · Markdown 阅读器

一间安静的本地 Markdown 书房。宣纸、墨、朱砂印。

## 启动

**桌面版（推荐）**：双击 `QingJian.exe`，独立窗口直接打开，不依赖浏览器。
（18MB 单文件，基于系统 WebView2 内核，Win10/11 自带）

**浏览器版**：双击 `start.bat`，或命令行：

```bat
python server.py            :: 默认浏览 E:\，端口 8973
python server.py D:\notes   :: 指定起始目录
python server.py D:\notes 9100
python server.py --no-browser
```

启动后自动打开浏览器，地址 `http://127.0.0.1:8973/`。关闭控制台窗口即退出。

两种版本功能完全一致。桌面版默认浏览 E 盘根目录，窗口内可用路径栏跳转到任意目录。

桌面版只依赖系统 WebView2 内核；浏览器版只依赖 Python 标准库（3.9+），均完全离线可用。

## 设为默认打开方式

双击 `设为默认打开方式.bat`，即可把 `.md` / `.markdown` 文件关联到青简。
之后在资源管理器里双击任意 md 文件，会直接用青简打开，并自动定位到文件所在目录。

- 只写入当前用户的注册表（HKCU），不需要管理员权限，不影响其他用户
- 若之前有其他程序（如 Typora、VS Code）的关联，会被覆盖；想改回去，在文件上右键 → 打开方式 中选择即可
- 卸载关联：双击 `取消默认打开方式.bat`
- 重复双击多个 md 文件时不会开多个窗口：青简是单实例应用，后打开的文件会在已有窗口中切换

## 重新打包 exe

```bat
python -m pip install pywebview pyinstaller
python make_icon.py        :: 重新生成图标（可选）
python -m PyInstaller --noconfirm --onefile --noconsole --name QingJian ^
  --icon icon.ico --collect-all webview ^
  --add-data "index.html;." --add-data "style.css;." --add-data "app.js;." --add-data "vendor;vendor" app_main.py
```

或用已有的 `QingJian.spec` 直接 `python -m PyInstaller QingJian.spec`。

## 功能

| 能力 | 说明 |
| --- | --- |
| 文件树 | 左侧浏览目录，懒加载，支持键盘导航（↑↓ 移动、→ 展开、← 收起、Enter 打开） |
| 阅读渲染 | GFM 表格、任务列表、引用、嵌套列表、删除线 |
| 编辑保存 | Ctrl+E 进入编辑，Ctrl+S 保存（保留原文件编码，UTF-8 / GBK 均可） |
| 代码高亮 | 支持 190+ 语言，代码块右上角一键复制 |
| 数学公式 | KaTeX 渲染 `$...$` 行内公式与 `$$...$$` 块级公式 |
| 章节目录 | 右侧 TOC 跟随滚动高亮，点击跳转；h1-h3 自动收录 |
| 内部链接 | md 文件间相对链接可直接点击跳转；外链新窗口打开 |
| 图片 | md 内相对路径图片正常显示，也可直接打开图片文件浏览 |
| 三套主题 | 纸（日间）/ 墨（夜间）/ 茶（护眼），Ctrl+Shift+T 循环切换 |
| 排版调节 | Ctrl+= / Ctrl+- 调字号；工具栏「宽」切换行宽三档 |
| 最近阅读 | 文件树顶部列出最近打开的 12 篇 |
| 拖拽预览 | 把桌面上的 .md 直接拖进窗口即可阅读 |
| 路径跳转 | 顶部路径栏可直接输入任意目录或文件路径回车打开 |

## 快捷键

| 按键 | 作用 |
| --- | --- |
| Ctrl+K | 聚焦文件过滤 |
| Ctrl+E | 编辑 / 返回阅读 |
| Ctrl+S | 保存修改（编辑模式下） |
| Ctrl+\ | 显示/隐藏文件树 |
| Ctrl+Shift+T | 循环切换主题 |
| Ctrl+Shift+D | 显示/隐藏章节目录 |
| Ctrl+= / Ctrl+- | 增大 / 减小字号 |
| Ctrl+O | 跳转路径栏 |
| Alt+↑ | 上一级目录 |

## 目录结构

```
├── app_main.py    桌面版入口（pywebview + WebView2）
├── server.py      本地只读服务（文件浏览 / 读取 API）
├── index.html     页面骨架
├── style.css      设计系统（三主题变量）
├── app.js         渲染与交互逻辑
├── icon.ico       应用图标（make_icon.py 生成）
├── vendor\        marked / highlight.js / KaTeX（离线依赖）
├── start.bat      浏览器版一键启动
├── LICENSE        MIT
└── README.md
```

## 说明

- 支持阅读与编辑；写入仅限文本类文件（.md / .txt / .json 等），保存时保留原文件编码
- 服务为**只读设计**的说法已过时：现在提供编辑保存能力，但只允许修改已有文本文件，不允许新建或删除
- 桌面版默认浏览 E 盘根目录；想换默认目录，设置环境变量 `QJ_ROOT`（如 `QJ_ROOT=D:\notes`）后再启动 exe。
- 文件按 UTF-8 读取，失败自动回退 GBK，兼容中文老文件。
- 浏览器版端口被占用时自动顺延（8973→8980）；桌面版使用随机端口，互不冲突。
- 若桌面版异常退出，错误信息记录在 `%TEMP%\qingjian_error.log`。

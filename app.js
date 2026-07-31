/* ============================================================
   青简 · Markdown 阅读器 — 前端逻辑
   ============================================================ */
"use strict";

/* ---------- 全局状态 ---------- */
const state = {
  treeRoot: null,     // 文件树当前显示的根目录
  currentDir: null,   // 当前目录（路径栏）
  currentFile: null,  // 当前打开的文件
  fileType: null,     // md | text | image
  rawContent: "",     // 当前文件原始内容（编辑用）
  curEncoding: "utf-8",
  editing: false,     // 是否编辑模式
  dirty: false,       // 是否有未保存修改
  preview: false,     // 是否拖拽预览（不可保存）
  recent: [],
  theme: localStorage.getItem("qj:theme") || "day",
  toc: [],            // [{id, text, level}]
  headingEls: [],
};

const TEXT_EXTS = new Set([".md",".markdown",".mdown",".txt",".log",".json",".yaml",".yml",
  ".toml",".ini",".cfg",".conf",".csv",".tsv",".xml",".html",".htm",
  ".css",".js",".py",".java",".c",".cpp",".h",".go",".rs",".sh",
  ".bat",".ps1",".sql",".tex",".rst",".org"]);
const IMAGE_EXTS = new Set([".png",".jpg",".jpeg",".gif",".webp",".bmp",".svg",".ico",".avif"]);
const MD_EXTS = new Set([".md",".markdown",".mdown"]);

const $ = (id) => document.getElementById(id);
const readerEl = $("reader");
const contentEl = document.querySelector(".content");
const treeEl = $("tree");

/* ---------- 工具 ---------- */
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function extOf(p) { return p.slice(p.lastIndexOf(".")).toLowerCase(); }
function joinPath(dir, rel) {
  if (/^([a-zA-Z]+:)?\/\//.test(rel) || /^data:/i.test(rel) || rel.startsWith("#")) return rel;
  rel = rel.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(rel)) return rel; // 绝对路径
  const parts = [];
  for (const seg of (dir.replace(/\\/g, "/") + "/" + rel).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
function fileUrl(p) { return "/api/file?path=" + encodeURIComponent(p); }
function apiList(p, hidden) { return fetch("/api/list?path=" + encodeURIComponent(p) + (hidden ? "&hidden=1" : "")).then(r => r.json()); }
function apiRead(p) { return fetch("/api/read?path=" + encodeURIComponent(p)).then(r => r.json()); }

/* ============================================================
   Markdown 渲染
   ============================================================ */

/* 数学公式扩展：$$...$$ 与 $...$ */
const mathExt = {
  name: "math",
  level: "inline",
  start(src) { return src.search(/\$\$?/); },
  tokenizer(src) {
    let m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: "math", raw: m[0], text: m[1].trim(), display: true };
    m = /^\$([^\s$][^$]*?)\$/.exec(src);
    if (m) return { type: "math", raw: m[0], text: m[1].trim(), display: false };
    return undefined;
  },
  renderer(tok) {
    try {
      return katex.renderToString(tok.text, { displayMode: tok.display, throwOnError: false });
    } catch (e) {
      return tok.raw;
    }
  },
};

let hdSeq = 0;

const renderer = {
  /* 代码块高亮：marked 以位置参数调用 (text, lang, escaped) */
  code(text, lang) {
    let language = "";
    if (lang) {
      const first = lang.trim().split(/\s+/)[0];
      if (first && hljs.getLanguage(first)) language = first;
    }
    let html;
    try {
      html = language ? hljs.highlight(text, { language }).value
                      : hljs.highlightAuto(text).value;
    } catch (e) { html = esc(text); }
    const langTag = language ? `<span class="code-lang">${esc(language)}</span>` : "";
    return `<pre><code class="hljs">${html}</code>${langTag}
      <div class="code-actions"><button class="code-copy">复制</button></div></pre>`;
  },
  /* 标题带锚点 id：marked 以位置参数调用 (text, depth, raw) */
  heading(text, depth) {
    const id = "hd-" + (hdSeq++);
    return `<h${depth} id="${id}"><a class="heading-anchor" href="#${id}" aria-hidden="true">¶</a>${text}</h${depth}>`;
  },
  /* 图片相对路径转 API：marked 以位置参数调用 (href, title, text) */
  image(href, title, text) {
    const src = href && !/^data:/.test(href) ? fileUrl(joinPath(state.currentDir || "", href)) : (href || "");
    const t = title ? ` title="${esc(title)}"` : "";
    return `<img src="${esc(src)}" alt="${esc(text || "")}"${t} loading="lazy">`;
  },
  /* 链接：md 内部链接交给点击委托 */
  link(href, title, text) {
    if (!href) return text || "";
    if (/^https?:/i.test(href)) {
      return `<a href="${esc(href)}" target="_blank" rel="noopener">${text || ""}</a>`;
    }
    return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ""}>${text || ""}</a>`;
  },
  /* 原始 HTML 一律转义显示，杜绝恶意脚本执行 */
  html(...args) {
    const text = (typeof args[0] === "object" && args[0]) ? args[0].text : args[0];
    return esc(text || "");
  },
};

marked.use({ renderer, extensions: [mathExt] });
marked.setOptions({ gfm: true, breaks: true });

function renderMarkdown(src, dir) {
  hdSeq = 0;
  state.currentDir = dir;
  readerEl.innerHTML = marked.parse(src);
  decorateReader();
  buildToc();
}

function decorateReader() {
  /* 复制按钮 */
  readerEl.querySelectorAll("pre").forEach(pre => {
    const btn = pre.querySelector(".code-copy");
    if (!btn) return;
    const code = pre.querySelector("code");
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.innerText);
        btn.textContent = "已复制";
        btn.classList.add("done");
      } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = code.innerText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        btn.textContent = "已复制";
      }
      setTimeout(() => { btn.textContent = "复制"; btn.classList.remove("done"); }, 1400);
    });
  });
  /* 内部 md 链接跳转 */
  readerEl.querySelectorAll("a[href]").forEach(a => {
    const h = a.getAttribute("href");
    if (h.startsWith("#")) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const t = document.getElementById(h.slice(1));
        if (t) scrollToEl(t);
      });
    } else if (!/^https?:/i.test(h) && !/^data:/i.test(h)) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openPath(joinPath(state.currentDir, h));
      });
    }
  });
  /* 表格任务列表类名 */
  readerEl.querySelectorAll("li").forEach(li => {
    if (li.firstChild && li.firstChild.nodeType === 1 &&
        li.firstChild.tagName === "INPUT" && li.firstChild.type === "checkbox") {
      li.classList.add("task-list-item");
    }
  });
}

/* ---------- 目录 ---------- */
function buildToc() {
  const nav = $("toc");
  nav.innerHTML = "";
  state.toc = [];
  state.headingEls = [];
  readerEl.querySelectorAll("h1, h2, h3").forEach(h => {
    const level = parseInt(h.tagName[1], 10);
    state.toc.push({ id: h.id, text: h.textContent.replace(/¶/g, "").trim(), level });
    state.headingEls.push(h);
    const a = document.createElement("a");
    a.className = "toc-item toc-l" + level;
    a.textContent = h.textContent.replace(/¶/g, "").trim();
    a.href = "#" + h.id;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      scrollToEl(h);
    });
    nav.appendChild(a);
  });
  if (!state.toc.length) {
    nav.innerHTML = '<div style="padding:8px;color:var(--ink-faint);font-size:12px;">本文没有章节标题</div>';
  }
}

function scrollToEl(el) {
  const cr = contentEl.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const target = Math.max(0, contentEl.scrollTop + er.top - cr.top - 64);
  animateScroll(contentEl, target);
}

/* 自实现缓动滚动，不依赖浏览器 smooth 支持 */
function animateScroll(container, target, dur = 320) {
  const start = container.scrollTop;
  const dist = target - start;
  if (Math.abs(dist) < 2) return;
  const t0 = performance.now();
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let rafId = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    container.scrollTop = target;
    if (container === contentEl) updateScrollUI();
  };
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    container.scrollTop = start + dist * ease(p);
    if (p < 1) rafId = requestAnimationFrame(step);
    else finish();
  };
  rafId = requestAnimationFrame(step);
  setTimeout(finish, dur + 400); // 兜底：rAF 不可用时直接跳转
}

/* ---------- 滚动联动：目录高亮 + 书签绳 ---------- */
function updateScrollUI() {
  const st = contentEl.scrollTop;
  const sh = contentEl.scrollHeight - contentEl.clientHeight;
  const p = sh > 0 ? Math.min(1, st / sh) : 0;
  /* 书签绳：固定长度，随进度上下滑动（CSS calc 不支持乘法，直接算像素） */
  const top = 16 + Math.max(0, window.innerHeight - 124) * p;
  $("progress").style.top = top.toFixed(1) + "px";

  let cur = -1;
  const cr = contentEl.getBoundingClientRect();
  for (let i = 0; i < state.headingEls.length; i++) {
    if (state.headingEls[i].getBoundingClientRect().top <= cr.top + 76) cur = i;
    else break;
  }
  if (cur === -1 && state.headingEls.length) cur = 0; // 顶部时高亮首章
  document.querySelectorAll(".toc-item").forEach((n, i) => {
    n.classList.toggle("active", i === cur);
  });
}
contentEl.addEventListener("scroll", updateScrollUI, { passive: true });
window.addEventListener("resize", updateScrollUI);

/* ============================================================
   文件树
   ============================================================ */

function nodeHtml(name, path, kind, mark) {
  const cls = kind === "dir" ? "tree-node dir" : "tree-node file";
  const twist = kind === "dir" ? '<span class="twist">▶</span>' : '<span class="twist"></span>';
  const m = mark ? `<span class="tmark">${mark}</span>` : "";
  return `<div class="${cls}" data-path="${esc(path)}" data-kind="${kind}">${twist}<span class="tname">${esc(name)}</span>${m}</div>`;
}

function markOf(name, isDir) {
  if (isDir) return "";
  const e = extOf(name);
  if (MD_EXTS.has(e)) return "md";
  if (IMAGE_EXTS.has(e)) return "图";
  if (TEXT_EXTS.has(e)) return e.slice(1);
  return "·";
}

async function loadTree(rootPath) {
  state.treeRoot = rootPath;
  const rootLabel = rootPath.replace(/\\+$/, "") || rootPath;
  $("tree-root-label").textContent = rootLabel;
  const data = await apiList(rootPath);
  if (data.error) { setTreeStatus(data.error); return; }
  state.currentDir = rootPath;
  setPathInput(rootPath);
  renderDirChildren(data, treeEl);
  setTreeStatus("");
  loadRecent();
}

function renderDirChildren(data, container) {
  container.innerHTML = "";
  if (!data.entries.length) {
    container.innerHTML = '<div style="padding:12px;color:var(--ink-faint);font-size:12px;">空目录</div>';
    return;
  }
  const nodes = data.entries.map(e => {
    const dirChild = e.isDir ? '<div class="tree-children" style="display:none"></div>' : "";
    return nodeHtml(e.name, e.path, e.isDir ? "dir" : "file", markOf(e.name, e.isDir)) + dirChild;
  });
  container.innerHTML = nodes.join("");
}

/* 懒加载子目录：busy 防并发 + 250ms 双击窗口防抖 */
const lastToggleAt = new WeakMap();
async function toggleDir(node) {
  const now = Date.now();
  if (now - (lastToggleAt.get(node) || 0) < 250) return; // 双击只响应第一次
  lastToggleAt.set(node, now);
  if (node.dataset.busy === "1") return;
  node.dataset.busy = "1";
  try {
    const path = node.dataset.path;
    const children = node.nextElementSibling;
    if (!children || !children.classList.contains("tree-children")) return;

    if (!node.classList.contains("loaded")) {
      const data = await apiList(path);
      if (data.error) { setTreeStatus(data.error); return; }
      children.innerHTML = "";
      const nodes = data.entries.map(e => {
        const dirChild = e.isDir ? '<div class="tree-children" style="display:none"></div>' : "";
        return nodeHtml(e.name, e.path, e.isDir ? "dir" : "file", markOf(e.name, e.isDir)) + dirChild;
      });
      if (!nodes.length) children.innerHTML = '<div style="padding:4px 0 4px 30px;font-size:11.5px;color:var(--ink-faint);">空</div>';
      else children.innerHTML = nodes.join("");
      node.classList.add("loaded");
    }

    node.classList.toggle("open");
    children.style.display = node.classList.contains("open") ? "" : "none";
  } finally {
    node.dataset.busy = "0";
  }
}

/* 树点击委托 */
treeEl.addEventListener("click", async (e) => {
  const node = e.target.closest(".tree-node");
  if (!node) return;
  if (node.dataset.kind === "dir") {
    toggleDir(node);
    return;
  }
  openPath(node.dataset.path);
});

/* 键盘导航 */
treeEl.addEventListener("keydown", (e) => {
  const items = [...treeEl.querySelectorAll(".tree-node")].filter(n => n.offsetParent !== null);
  if (!items.length) return;
  let idx = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); }
  else if (e.key === "ArrowRight" && items[idx] && items[idx].dataset.kind === "dir") { toggleDir(items[idx]); return; }
  else if (e.key === "ArrowLeft" && items[idx] && items[idx].dataset.kind === "dir") { items[idx].classList.remove("open"); const c = items[idx].nextElementSibling; if (c) c.style.display = "none"; return; }
  else if (e.key === "Enter" && items[idx]) { items[idx].click(); return; }
  else return;
  items[idx] && items[idx].focus();
  e.preventDefault();
});

/* 展开路径链使文件可见，返回是否定位成功 */
async function ensureVisible(filePath) {
  const root = state.treeRoot;
  if (!root) return false;
  const fp = filePath.replace(/\\/g, "/").toLowerCase();
  const rp = root.replace(/\\/g, "/").toLowerCase();
  if (!fp.startsWith(rp)) return false;

  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  const rootParts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  const relParts = parts.slice(rootParts.length);
  if (!relParts.length) return;

  let container = treeEl;
  let curPath = root.replace(/\\+$/, "");
  for (let i = 0; i < relParts.length - 1; i++) {
    curPath += "\\" + relParts[i];
    const node = container.querySelector(`.tree-node.dir[data-path="${CSS.escape(curPath)}"]`);
    if (!node) break;
    if (!node.classList.contains("open")) {
      await toggleDir(node);
      // 展开/收起状态完全交给 toggleDir 管理，避免加载失败时出现假展开
    }
    container = node.nextElementSibling || container;
  }
  return highlightFile(filePath);
}

function highlightFile(filePath) {
  treeEl.querySelectorAll(".tree-node.active").forEach(n => n.classList.remove("active"));
  const node = treeEl.querySelector(`.tree-node[data-path="${CSS.escape(filePath)}"]`);
  if (node) {
    node.classList.add("active");
    return true;
  }
  return false;
}

/* ---------- 搜索过滤 ---------- */
$("tree-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const nodes = treeEl.querySelectorAll(".tree-node");
  if (!q) {
    nodes.forEach(n => n.classList.remove("hidden"));
    setTreeStatus("");
    return;
  }
  let count = 0;
  nodes.forEach(n => {
    const hit = n.querySelector(".tname").textContent.toLowerCase().includes(q);
    n.classList.toggle("hidden", !hit);
    if (hit) count++;
  });
  setTreeStatus(`匹配 ${count} 项（仅已加载目录）`);
});

/* ============================================================
   打开文件
   ============================================================ */

function showEmpty() {
  state.currentFile = null;
  state.editing = false;
  state.dirty = false;
  state.preview = false;
  updateEditUI();
  $("empty").hidden = false;
  $("error-box").hidden = true;
  $("doc-meta").hidden = true;
  $("preview-banner").hidden = true;
  readerEl.innerHTML = "";
  $("toc").innerHTML = "";
  $("progress").style.setProperty("--p", "0");
  document.title = "青简 · Markdown 阅读器";
}

async function openPath(p) {
  if (!p) return;
  if (state.editing && state.dirty) {
    if (!confirm("当前文件有未保存的修改，放弃并打开其他文件？")) return;
  }
  const ext = extOf(p);
  if (IMAGE_EXTS.has(ext)) {
    renderImage(p);
    return;
  }
  if (!TEXT_EXTS.has(ext) && !MD_EXTS.has(ext)) {
    showError("这种文件类型暂不支持阅读");
    return;
  }
  const data = await apiRead(p);
  if (data.error) { showError(data.error); return; }
  state.currentFile = p;
  state.fileType = MD_EXTS.has(ext) ? "md" : "text";
  state.rawContent = data.content;
  state.curEncoding = data.encoding || "utf-8";
  state.editing = false;
  state.dirty = false;
  state.preview = false;
  updateEditUI();

  $("empty").hidden = true;
  $("error-box").hidden = true;
  $("doc-meta").hidden = false;
  $("preview-banner").hidden = true;
  $("doc-name").textContent = data.name;
  $("doc-dir").textContent = data.path;

  if (state.fileType === "md") {
    renderMarkdown(data.content, data.dir);
  } else {
    readerEl.innerHTML = `<pre style="background:var(--bg-code);border-radius:10px;padding:18px 20px;overflow-x:auto;font-family:var(--font-mono);font-size:0.85em;line-height:1.7;"><code>${esc(data.content)}</code></pre>`;
    $("toc").innerHTML = "";
    state.toc = []; state.headingEls = [];
  }

  contentEl.scrollTo({ top: 0 });
  updateScrollUI();
  document.title = data.name + " · 青简";
  pushRecent(p, data.name);
  /* 若文件不在当前树根下，把文件树切到文件所在目录再定位 */
  const located = await ensureVisible(p);
  if (!located && state.treeRoot) {
    const dir = p.split(/[\\/]/).slice(0, -1).join("/");
    if (dir) {
      await loadTree(dir);
      await ensureVisible(p);
    }
  }
}

function renderImage(p) {
  if (state.editing && state.dirty) {
    if (!confirm("当前文件有未保存的修改，放弃并打开其他文件？")) return;
  }
  state.currentFile = p;
  state.fileType = "image";
  state.editing = false;
  state.dirty = false;
  state.preview = false;
  updateEditUI();
  $("empty").hidden = true;
  $("error-box").hidden = true;
  $("doc-meta").hidden = false;
  $("preview-banner").hidden = true;
  const name = p.split(/[\\/]/).pop();
  $("doc-name").textContent = name;
  $("doc-dir").textContent = p;
  readerEl.innerHTML = `<img src="${fileUrl(p)}" style="max-width:100%;border-radius:6px;box-shadow:var(--shadow);">`;
  $("toc").innerHTML = "";
  state.toc = []; state.headingEls = [];
  contentEl.scrollTo({ top: 0 });
  updateScrollUI();
  document.title = name + " · 青简";
  ensureVisible(p);
}

function showError(msg) {
  state.editing = false;
  state.dirty = false;
  updateEditUI();
  $("empty").hidden = true;
  $("doc-meta").hidden = true;
  $("preview-banner").hidden = true;
  const box = $("error-box");
  box.hidden = false;
  box.textContent = msg;
  readerEl.innerHTML = "";
  $("toc").innerHTML = "";
  state.toc = []; state.headingEls = [];
}

/* ---------- 最近文件 ---------- */
function pushRecent(p, name) {
  state.recent = state.recent.filter(r => r.path !== p);
  state.recent.unshift({ path: p, name });
  if (state.recent.length > 12) state.recent.length = 12;
  try { localStorage.setItem("qj:recent", JSON.stringify(state.recent)); } catch (e) {}
  loadRecent();
}

function loadRecent() {
  try {
    state.recent = JSON.parse(localStorage.getItem("qj:recent") || "[]");
  } catch (e) { state.recent = []; }
  let sec = treeEl.querySelector(".tree-section-recent");
  if (!state.recent.length) { if (sec) sec.remove(); return; }
  if (!sec) {
    sec = document.createElement("div");
    sec.className = "tree-section tree-section-recent";
    sec.textContent = "最近阅读";
    treeEl.insertBefore(sec, treeEl.firstChild);
  }
  const nodes = state.recent
    .filter(r => r.path && r.path.replace(/\\/g, "/").toLowerCase().startsWith((state.treeRoot || "").replace(/\\/g, "/").toLowerCase()))
    .map(r => nodeHtml(r.name, r.path, "file", "md"));
  const old = treeEl.querySelectorAll(".recent-node");
  old.forEach(n => n.remove());
  if (!nodes.length) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = nodes.join("");
  [...wrap.children].forEach(n => n.classList.add("recent-node"));
  sec.after(wrap);
}

/* ============================================================
   编辑模式
   ============================================================ */

let toastTimer = null;
function flash(msg, warn) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("warn", !!warn);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1600);
}

function updateEditUI() {
  const editable = state.currentFile && !state.preview &&
    (state.fileType === "md" || state.fileType === "text");
  const btn = $("btn-edit");
  btn.disabled = !editable;
  btn.classList.toggle("on", state.editing);
  btn.title = state.preview ? "预览模式不可编辑" : (state.editing ? "返回阅读 (Ctrl+E)" : "编辑 (Ctrl+E)");
  const save = $("btn-save");
  save.hidden = !state.editing;
  save.classList.toggle("dirty", state.dirty);
  save.title = state.dirty ? "保存修改 (Ctrl+S)" : "保存 (Ctrl+S)";
}

function enterEdit() {
  if (!state.currentFile || state.preview) return;
  if (state.fileType !== "md" && state.fileType !== "text") return;
  state.editing = true;
  state.dirty = false;
  const ta = document.createElement("textarea");
  ta.id = "editor";
  ta.value = state.rawContent;
  ta.spellcheck = false;
  ta.addEventListener("input", () => {
    state.dirty = true;
    updateEditUI();
  });
  readerEl.replaceChildren(ta);
  $("toc").innerHTML = "";
  state.toc = []; state.headingEls = [];
  updateEditUI();
  ta.focus();
  ta.setSelectionRange(0, 0);
}

function exitEdit() {
  if (!state.editing) return;
  if (state.dirty && !confirm("有未保存的修改，放弃并返回阅读？")) return;
  state.editing = false;
  state.dirty = false;
  updateEditUI();
  if (state.fileType === "md") {
    renderMarkdown(state.rawContent, state.currentDir);
  } else {
    readerEl.innerHTML = `<pre style="background:var(--bg-code);border-radius:10px;padding:18px 20px;overflow-x:auto;font-family:var(--font-mono);font-size:0.85em;line-height:1.7;"><code>${esc(state.rawContent)}</code></pre>`;
  }
  contentEl.scrollTo({ top: 0 });
  updateScrollUI();
}

async function saveEdit() {
  const ta = document.getElementById("editor");
  if (!ta) return;
  const content = ta.value;
  try {
    const res = await fetch("/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: state.currentFile, content, encoding: state.curEncoding }),
    }).then(r => r.json());
    if (res.ok) {
      state.rawContent = content;
      state.dirty = false;
      updateEditUI();
      flash("已保存");
    } else {
      flash("保存失败：" + (res.error || "未知错误"), true);
    }
  } catch (e) {
    flash("保存失败：网络错误", true);
  }
}

$("btn-edit").addEventListener("click", () => {
  state.editing ? exitEdit() : enterEdit();
});
$("btn-save").addEventListener("click", saveEdit);

/* ============================================================
   工具栏与快捷键
   ============================================================ */

function setPathInput(p) {
  $("path-input").value = p;
}

/* 目录跳转 */
$("path-input").addEventListener("keydown", async (e) => {
  if (e.key !== "Enter") return;
  const p = e.target.value.trim();
  if (!p) return;
  const data = await apiList(p);
  if (!data.error) {
    loadTree(p);
  } else {
    openPath(p);
  }
});

$("btn-up").addEventListener("click", async () => {
  if (!state.currentDir) return;
  const data = await apiList(state.currentDir);
  if (data.parent) loadTree(data.parent);
});

$("btn-refresh").addEventListener("click", () => {
  if (state.treeRoot) loadTree(state.treeRoot);
});

/* 主题 */
const THEMES = ["day", "night", "tea"];
const THEME_NAMES = { day: "纸", night: "墨", tea: "茶" };
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("hljs-dark").disabled = t !== "night";
  $("hljs-light").disabled = t === "night";
  $("btn-theme").title = `主题：${THEME_NAMES[t]}（Ctrl+Shift+T）`;
  localStorage.setItem("qj:theme", t);
  state.theme = t;
}
$("btn-theme").addEventListener("click", () => {
  const i = THEMES.indexOf(state.theme);
  applyTheme(THEMES[(i + 1) % THEMES.length]);
});

/* 字号 */
function adjustFont(d) {
  const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fs")) || 17;
  const next = Math.min(20, Math.max(15, cur + d));
  document.documentElement.style.setProperty("--fs", next + "px");
  localStorage.setItem("qj:fs", next);
}
$("btn-font-plus").addEventListener("click", () => adjustFont(1));
$("btn-font-minus").addEventListener("click", () => adjustFont(-1));

/* 行宽 */
const WIDTHS = [640, 720, 820];
let wi = 1;
$("btn-width").addEventListener("click", () => {
  wi = (wi + 1) % WIDTHS.length;
  document.documentElement.style.setProperty("--mw", WIDTHS[wi] + "px");
});

/* 面板开关 */
$("btn-tree").addEventListener("click", () => {
  const app = document.querySelector(".app");
  const isOpen = window.innerWidth <= 860;
  app.classList.toggle("tree-open", isOpen);
  app.classList.toggle("tree-hidden", !isOpen);
  $("btn-tree").classList.toggle("on", !isOpen);
});
$("btn-toc").addEventListener("click", () => {
  const app = document.querySelector(".app");
  const hidden = app.classList.toggle("toc-hidden");
  $("btn-toc").classList.toggle("on", hidden);
});

/* 快捷键 */
document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "k") { e.preventDefault(); $("tree-search").focus(); $("tree-search").select(); }
  else if (e.ctrlKey && k === "\\") { e.preventDefault(); $("btn-tree").click(); }
  else if (e.ctrlKey && e.shiftKey && k === "t") { e.preventDefault(); $("btn-theme").click(); }
  else if (e.ctrlKey && e.shiftKey && k === "d") { e.preventDefault(); $("btn-toc").click(); }
  else if (e.ctrlKey && k === "=") { e.preventDefault(); adjustFont(1); }
  else if (e.ctrlKey && k === "-") { e.preventDefault(); adjustFont(-1); }
  else if (e.ctrlKey && k === "e") { e.preventDefault(); $("btn-edit").click(); }
  else if (e.ctrlKey && k === "s") { e.preventDefault(); if (state.editing) saveEdit(); }
  else if (e.ctrlKey && k === "o") { e.preventDefault(); $("path-input").focus(); $("path-input").select(); }
  else if (e.altKey && k === "arrowup") { e.preventDefault(); $("btn-up").click(); }
});

/* ============================================================
   拖拽预览
   ============================================================ */
["dragover", "drop"].forEach(ev => {
  document.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === "drop") handleDrop(e.dataTransfer.files);
  });
});

function handleDrop(files) {
  if (!files || !files.length) return;
  const f = files[0];
  if (!(f.name.endsWith(".md") || f.name.endsWith(".markdown") || f.name.endsWith(".txt"))) {
    showError("请拖入 .md 或 .txt 文件");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.currentFile = null;
    state.fileType = "md";
    state.editing = false;
    state.dirty = false;
    state.preview = true;
    updateEditUI();
    $("empty").hidden = true;
    $("error-box").hidden = true;
    $("doc-meta").hidden = false;
    $("preview-banner").hidden = false;
    $("doc-name").textContent = f.name;
    $("doc-dir").textContent = "拖拽预览（来自桌面）";
    renderMarkdown(String(reader.result), "");
    contentEl.scrollTo({ top: 0 });
    document.title = f.name + " · 青简";
  };
  reader.readAsText(f);
}

/* ============================================================
   启动
   ============================================================ */
(async function init() {
  applyTheme(state.theme);
  const savedFs = parseFloat(localStorage.getItem("qj:fs"));
  if (savedFs) document.documentElement.style.setProperty("--fs", savedFs + "px");

  const openAtStart = new URLSearchParams(location.search).get("open");

  const info = await fetch("/api/info").then(r => r.json()).catch(() => null);
  if (info) {
    await loadTree(info.root);
    if (openAtStart) {
      await openPath(openAtStart);
    }
  } else {
    setTreeStatus("服务未就绪");
  }
})();

function setTreeStatus(msg) {
  $("tree-status").textContent = msg || "";
}

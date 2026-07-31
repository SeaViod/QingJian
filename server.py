#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
青简 · Markdown 阅读器 本地服务（只读）

用法:
    python server.py                 # 默认浏览 E:\，端口 8973
    python server.py D:\notes        # 指定起始目录
    python server.py D:\notes 9100   # 指定端口
    python server.py --no-browser    # 不自动打开浏览器

依赖: 仅 Python 标准库
"""

import json
import mimetypes
import os
import re
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote, parse_qs

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = "E:\\"

# 前端可读取的文本类型
TEXT_EXTS = {
    ".md", ".markdown", ".mdown", ".txt", ".log", ".json", ".yaml", ".yml",
    ".toml", ".ini", ".cfg", ".conf", ".csv", ".tsv", ".xml", ".html", ".htm",
    ".css", ".js", ".py", ".java", ".c", ".cpp", ".h", ".go", ".rs", ".sh",
    ".bat", ".ps1", ".sql", ".tex", ".rst", ".org",
}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif"}

MAX_READ_BYTES = 4 * 1024 * 1024  # 单文件最大读取 4MB

mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("text/markdown", ".markdown")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/javascript", ".js")


def parse_args(argv):
    root = DEFAULT_ROOT
    port = 8973
    open_browser = True
    for arg in argv[1:]:
        if arg == "--no-browser":
            open_browser = False
        elif arg.isdigit():
            port = int(arg)
        else:
            root = arg
    return root, port, open_browser


def safe_path(raw):
    """校验并归一化路径，拒绝不存在的路径。"""
    if not raw:
        return None
    p = os.path.normpath(unquote(raw))
    if not os.path.exists(p):
        return None
    return p


def list_dir(path, show_hidden=False):
    entries = []
    try:
        names = os.listdir(path)
    except OSError:
        return None
    for name in names:
        if not show_hidden and name.startswith("."):
            continue
        full = os.path.join(path, name)
        try:
            st = os.stat(full)
            entries.append({
                "path": full,
                "name": name,
                "isDir": os.path.isdir(full),
                "size": st.st_size if not os.path.isdir(full) else 0,
                "mtime": int(st.st_mtime),
            })
        except OSError:
            continue
    entries.sort(key=lambda e: (not e["isDir"], e["name"].lower()))
    return entries


def read_text(path):
    """优先 utf-8，失败回退 gbk，兼容 BOM。返回 (内容, 编码, 错误)）"""
    try:
        with open(path, "rb") as f:
            data = f.read(MAX_READ_BYTES + 1)
        if len(data) > MAX_READ_BYTES:
            return None, None, "文件超过 4MB，暂不支持直接阅读"
        if data.startswith(b"\xef\xbb\xbf"):
            data = data[3:]
        for enc in ("utf-8", "gbk", "latin-1"):
            try:
                return data.decode(enc), enc, None
            except UnicodeDecodeError:
                continue
        return None, None, "无法识别文件编码"
    except OSError as e:
        return None, None, str(e)


class Handler(BaseHTTPRequestHandler):
    server_version = "QingJian/1.0"
    ROOT = DEFAULT_ROOT  # 起始目录，创建 server 时设置

    # ---------- 安全校验 ----------
    def _check_host(self):
        """防 DNS rebinding：Host 必须是本机地址"""
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "")

    def _check_origin(self):
        """防跨站请求：POST 携带的 Origin 必须来自本应用页面"""
        origin = self.headers.get("Origin")
        if not origin:
            return True
        port = self.server.server_address[1]
        return origin in (f"http://127.0.0.1:{port}", f"http://localhost:{port}")

    # ---------- 工具 ----------
    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, msg, code=400):
        self._json({"error": msg}, code)

    def _send_static(self, rel):
        """从应用目录提供静态文件，防穿越。"""
        full = os.path.realpath(os.path.join(APP_DIR, rel))
        if not full.startswith(APP_DIR + os.sep) and full != APP_DIR:
            self._err("forbidden", 403)
            return
        try:
            with open(full, "rb") as f:
                data = f.read()
        except OSError:
            self._err("not found", 404)
            return
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---------- 路由 ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        if not self._check_host():
            self._err("forbidden", 403)
            return
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        route = path.split("?", 1)[0]

        try:
            if route in ("/", "/index.html"):
                self._send_static("index.html")
            elif route == "/style.css":
                self._send_static("style.css")
            elif route == "/app.js":
                self._send_static("app.js")
            elif route.startswith("/vendor/"):
                self._send_static(route.lstrip("/"))
            elif route == "/api/list":
                self.api_list(query)
            elif route == "/api/read":
                self.api_read(query)
            elif route == "/api/file":
                self.api_file(query)
            elif route == "/api/info":
                self._json({"root": self.ROOT, "version": "1.0.0"})
            else:
                self._err("not found", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # 兜底，避免连接悬挂
            try:
                self._err(f"server error: {e}", 500)
            except Exception:
                pass

    def api_list(self, query):
        raw = query.get("path", [None])[0]
        if raw is None:
            raw = self.ROOT
        p = safe_path(raw)
        if p is None:
            self._err("路径不存在", 404)
            return
        if not os.path.isdir(p):
            self._err("不是目录", 400)
            return
        entries = list_dir(p, show_hidden=query.get("hidden", ["0"])[0] == "1")
        parent = os.path.dirname(p) if p != os.path.dirname(p) else None
        if os.path.dirname(p) == p:  # 盘符根
            parent = None
        self._json({"path": p, "parent": parent, "entries": entries})

    def api_read(self, query):
        raw = query.get("path", [None])[0]
        p = safe_path(raw)
        if p is None:
            self._err("路径不存在", 404)
            return
        if os.path.isdir(p):
            self._err("这是目录", 400)
            return
        ext = os.path.splitext(p)[1].lower()
        if ext in IMAGE_EXTS:
            self._err("这是图片，请用打开方式查看", 400)
            return
        content, enc, err = read_text(p)
        if err:
            self._err(err, 400)
            return
        st = os.stat(p)
        self._json({
            "path": p,
            "name": os.path.basename(p),
            "dir": os.path.dirname(p),
            "mtime": int(st.st_mtime),
            "encoding": enc,
            "content": content,
        })

    # ---------- 写接口（仅限编辑文本文件） ----------
    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path
        try:
            if not self._check_host() or not self._check_origin():
                self._err("forbidden", 403)
                return
            if route == "/api/write":
                self.api_write()
            else:
                self._err("not found", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            try:
                self._err(f"server error: {e}", 500)
            except Exception:
                pass

    def api_write(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            length = 0
        if length <= 0 or length > MAX_READ_BYTES:
            self._err("无效内容", 400)
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            self._err("无效请求", 400)
            return
        p = safe_path(body.get("path"))
        if p is None:
            self._err("路径不存在", 404)
            return
        if os.path.isdir(p):
            self._err("这是目录", 400)
            return
        ext = os.path.splitext(p)[1].lower()
        if ext not in TEXT_EXTS:
            self._err("该类型不支持编辑", 403)
            return
        content = body.get("content")
        if not isinstance(content, str):
            self._err("无效内容", 400)
            return
        encoding = body.get("encoding") or "utf-8"
        if encoding not in ("utf-8", "gbk", "latin-1"):
            encoding = "utf-8"
        try:
            with open(p, "w", encoding=encoding, newline="") as f:
                f.write(content)
        except OSError as e:
            self._err(str(e), 500)
            return
        self._json({"ok": True, "path": p})

    def api_file(self, query):
        raw = query.get("path", [None])[0]
        p = safe_path(raw)
        if p is None:
            self._err("路径不存在", 404)
            return
        if os.path.isdir(p):
            self._err("这是目录", 400)
            return
        try:
            with open(p, "rb") as f:
                data = f.read(MAX_READ_BYTES + 1)
        except OSError as e:
            self._err(str(e), 400)
            return
        ctype = mimetypes.guess_type(p)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # ---------- 日志 ----------
    def log_message(self, fmt, *args):
        out = sys.stdout
        if out is None:  # 无控制台窗口时静默
            return
        try:
            out.write(f"[{self.log_date_time_string()}] {fmt % args}\n")
            out.flush()
        except Exception:
            pass


def create_server(root=None, port=0):
    """创建只读文件服务，返回 (httpd, 实际端口)。port=0 时由系统分配。"""
    r = os.path.abspath(root) if root else DEFAULT_ROOT
    if not os.path.isdir(r):
        raise ValueError(f"起始目录不存在: {r}")
    Handler.ROOT = r
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    return httpd, httpd.server_address[1]


def _log(msg):
    out = sys.stdout
    if out is not None:
        try:
            out.write(msg + "\n")
            out.flush()
        except Exception:
            pass


def main():
    root, port, open_browser = parse_args(sys.argv)
    global ROOT
    ROOT = os.path.abspath(root)
    if not os.path.isdir(ROOT):
        _log(f"起始目录不存在: {ROOT}")
        sys.exit(1)

    Handler.ROOT = ROOT

    server = None
    for p in range(port, port + 8):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", p), Handler)
            port = p
            break
        except OSError:
            continue
    if server is None:
        _log(f"端口 {port}-{port + 7} 均被占用，请指定其他端口")
        sys.exit(1)

    url = f"http://127.0.0.1:{port}/"
    _log("=" * 46)
    _log("  青简 · Markdown 阅读器")
    _log(f"  浏览根目录: {ROOT}")
    _log(f"  打开地址:   {url}")
    _log("  关闭方式:   关闭本窗口 / Ctrl+C")
    _log("=" * 46)

    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log("\n再见。")
        server.server_close()


if __name__ == "__main__":
    main()

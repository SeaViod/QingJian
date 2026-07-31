#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""青简 · Markdown 阅读器 桌面版入口（打包成 exe 后双击即用）

用法：
  QingJian.exe                    打开应用（默认浏览 E:\\）
  QingJian.exe "D:\\notes\\a.md"  直接打开指定文件，文件树定位到其目录
  QingJian.exe --install-assoc    将 .md / .markdown 关联为青简打开
  QingJian.exe --remove-assoc     移除关联

单实例：同时只运行一个窗口。重复双击文件时，路径会转交已运行的实例。

环境变量（主要用于自动化测试）：
  QJ_ROOT      起始目录，默认 E:\\
  QJ_TEST      非空时 10 秒后自动关闭窗口
  QJ_PORT_FILE 将实际端口写入该文件
"""

import glob
import json
import os
import sys
import tempfile
import threading
import time
import traceback
import uuid

APP_NAME = "QingJian"
TEMP_DIR = tempfile.gettempdir()
LOCK_PATH = os.path.join(TEMP_DIR, "qingjian.lock")
REQ_DIR = os.path.join(TEMP_DIR, "qingjian_open")


def base_path():
    """PyInstaller onefile 解压目录 / 源码目录"""
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def _write_log(msg):
    try:
        log_path = os.path.join(TEMP_DIR, "qingjian_error.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        pass


def _exe_path():
    """当前程序路径：打包后为 exe，源码模式指向同目录 QingJian.exe"""
    if getattr(sys, "frozen", False):
        return sys.executable
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "QingJian.exe")


def _msgbox(title, text):
    if os.environ.get("QJ_NO_MSG"):  # 自动化测试时跳过弹窗
        return
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x40)  # MB_ICONINFORMATION
    except Exception:
        pass


def _notify_shell():
    try:
        import ctypes
        SHCNE_ASSOCCHANGED = 0x08000000
        ctypes.windll.shell32.SHChangeNotify(SHCNE_ASSOCCHANGED, 0, None, None)
    except Exception:
        pass


# ============================================================
# 文件关联
# ============================================================

def install_assoc():
    """将 .md / .markdown 关联到青简（仅当前用户，无需管理员）"""
    import winreg

    exe = _exe_path()
    if not os.path.exists(exe):
        raise SystemExit(f"找不到 QingJian.exe：{exe}")
    command = f'"{exe}" "%1"'
    icon = f'"{exe}",0'
    progid = "QingJian.Markdown"

    for ext in (".md", ".markdown"):
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{ext}") as k:
            winreg.SetValue(k, "", winreg.REG_SZ, progid)
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{ext}\OpenWithProgids") as k:
            winreg.SetValueEx(k, progid, 0, winreg.REG_SZ, "")

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{progid}") as k:
        winreg.SetValue(k, "", winreg.REG_SZ, "青简 Markdown 文档")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{progid}\DefaultIcon") as k:
        winreg.SetValue(k, "", winreg.REG_SZ, icon)
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{progid}\shell\open\command") as k:
        winreg.SetValue(k, "", winreg.REG_SZ, command)

    _notify_shell()
    return f"已设置：.md / .markdown 默认用青简打开\n\n{exe}"


def remove_assoc():
    """移除青简的文件关联（保留其他程序的关联）"""
    import winreg

    progid = "QingJian.Markdown"
    for ext in (".md", ".markdown"):
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{ext}", 0, winreg.KEY_SET_VALUE) as k:
                try:
                    winreg.DeleteValue(k, "")
                except OSError:
                    pass
        except OSError:
            pass
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\{ext}\OpenWithProgids", 0, winreg.KEY_SET_VALUE) as k:
                try:
                    winreg.DeleteValue(k, progid)
                except OSError:
                    pass
        except OSError:
            pass
    for key in (
        rf"Software\Classes\{progid}\shell\open\command",
        rf"Software\Classes\{progid}\shell\open",
        rf"Software\Classes\{progid}\shell",
        rf"Software\Classes\{progid}\DefaultIcon",
        rf"Software\Classes\{progid}",
    ):
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key)
        except OSError:
            pass

    _notify_shell()
    return "已移除青简的默认关联\n\n如需恢复其他程序，可在文件上右键 → 打开方式 中选择。"


# ============================================================
# 单实例
# ============================================================

def _pid_alive(pid):
    """安全探测进程是否存活（Windows 上 os.kill(pid,0) 会真的终止进程，不可用）"""
    import ctypes
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not h:
        return False
    ctypes.windll.kernel32.CloseHandle(h)
    return True


def become_primary():
    """尝试成为主实例。返回 (是否为主实例, 锁文件句柄)"""
    try:
        with open(LOCK_PATH, "r", encoding="ascii") as f:
            old = f.read().strip()
        if old.isdigit() and _pid_alive(int(old)):
            return False, None
    except (OSError, ValueError):
        pass
    try:
        lf = open(LOCK_PATH, "w", encoding="ascii")
        lf.write(str(os.getpid()))
        lf.flush()
        return True, lf
    except OSError:
        return False, None


def send_open_request(path):
    """把路径交给已运行的主实例"""
    try:
        os.makedirs(REQ_DIR, exist_ok=True)
        req = os.path.join(REQ_DIR, uuid.uuid4().hex + ".json")
        with open(req, "w", encoding="utf-8") as f:
            json.dump({"path": path}, f)
        time.sleep(2.0)  # 给主实例一点处理时间
    except OSError:
        pass


def poll_open_requests(evaluate):
    """轮询转交请求，evaluate(js) 负责把路径送进前端"""
    try:
        os.makedirs(REQ_DIR, exist_ok=True)
    except OSError:
        pass
    while True:
        try:
            for f in glob.glob(os.path.join(REQ_DIR, "*.json")):
                try:
                    with open(f, "r", encoding="utf-8") as fh:
                        req = json.load(fh)
                    p = req.get("path")
                    if p:
                        evaluate(json.dumps(p))
                except Exception:
                    pass
                finally:
                    try:
                        os.remove(f)
                    except OSError:
                        pass
        except Exception:
            pass
        time.sleep(0.6)


# ============================================================
# 入口
# ============================================================

def main():
    args = sys.argv[1:]
    if "--install-assoc" in args:
        _msgbox("青简", install_assoc())
        return
    if "--remove-assoc" in args:
        _msgbox("青简", remove_assoc())
        return

    open_file = None
    for arg in args:
        if arg.startswith("-"):
            continue
        p = os.path.abspath(arg)
        if os.path.isfile(p):
            open_file = p

    # 单实例：已有主实例则转交路径并退出
    is_primary, lock_file = become_primary()
    if not is_primary:
        if open_file:
            send_open_request(open_file)
        return

    stop_event = threading.Event()

    try:
        import server

        if open_file:
            root = os.path.dirname(open_file)
        else:
            root = os.environ.get("QJ_ROOT") or "E:\\"
        httpd, port = server.create_server(root=root)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()

        port_file = os.environ.get("QJ_PORT_FILE")
        if port_file:
            try:
                with open(port_file, "w", encoding="ascii") as f:
                    f.write(str(port))
            except Exception:
                pass

        import webview
        from urllib.parse import quote

        url = f"http://127.0.0.1:{port}/"
        if open_file:
            url += "?open=" + quote(open_file)

        kwargs = dict(
            title="青简 · Markdown 阅读器",
            url=url,
            width=1280,
            height=840,
            min_size=(960, 620),
            background_color="#F0F1EA",
        )
        window = webview.create_window(**kwargs)

        # 前端就绪前不投递转交请求
        ready = {"v": False}
        window.events.loaded += lambda: ready.__setitem__("v", True)

        def evaluate(js_path):
            if ready["v"]:
                try:
                    window.evaluate_js(f"window.openPath({js_path})")
                except Exception:
                    pass

        threading.Thread(target=poll_open_requests, args=(evaluate,), daemon=True).start()

        if os.environ.get("QJ_TEST"):
            threading.Timer(10, window.destroy).start()

        webview.start()
        httpd.shutdown()
        httpd.server_close()
    except Exception:
        _write_log(traceback.format_exc())
        raise
    finally:
        if lock_file:
            try:
                lock_file.close()
                os.remove(LOCK_PATH)
            except OSError:
                pass


if __name__ == "__main__":
    main()

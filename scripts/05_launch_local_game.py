#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# 注: 本文件为 raw 语义说明, 路径写作 C:/src/... 避免 \s 转义警告。
"""
05_launch_local_game.py
=====================================================================
功能: 一键启动本地网页游戏 —— 起 HTTP 服务并自动打开默认浏览器。

为什么需要它(用户实测 file:// 打开 index.html 是空白页):
  1) index.html 用根绝对路径 /src/main.tsx、/vendor/...、/fragment-host/...,
     在 file:// 下被解析到盘符根目录(C:/src/main.tsx), 文件不存在;
  2) 更根本: ES module + importmap 在 file:// 协议下被浏览器 CORS 拦截
     (origin=null), 双击 HTML 无法运行模块化网页。必须经 HTTP 提供。

做法:
  复用 04_local_server.py 的 Handler(它精确复刻了 Forge 预览服务器对
  `?module` 资源与真实二进制的区分语义), 在 127.0.0.1:8899 起服务,
  再调系统默认浏览器打开。已运行则直接复用, 不重复起进程。

用法:
  python scripts/05_launch_local_game.py
  或双击 scripts/05_launch_game.bat
  停止: 在运行窗口按 Ctrl+C
=====================================================================
"""
import importlib.util
import os
import socket
import sys
import threading
import time
import webbrowser
import http.server

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8899
URL = f"http://127.0.0.1:{PORT}/"


def load_handler_class():
    """动态加载 04_local_server.py(文件名数字开头, 不是合法模块名)。"""
    path = os.path.join(HERE, "04_local_server.py")
    spec = importlib.util.spec_from_file_location("local_server_04", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def port_in_use(port):
    s = socket.socket()
    s.settimeout(0.3)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def main():
    mod = load_handler_class()
    if port_in_use(PORT):
        print(f"[i] 端口 {PORT} 已有服务在运行, 直接打开浏览器。")
    else:
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), mod.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        print(f"[+] 本地服务已启动: {URL}")
    print(f"[+] 正在打开浏览器: {URL}")
    print("[i] 游戏在浏览器里运行; 关闭本窗口或 Ctrl+C 停止服务。")
    webbrowser.open(URL)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[+] 已停止。")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
10_serve_mvp.py
=====================================================================
功能: 为 scripts/mvp_air_to_ground.html 提供局域网静态服务。
      手机 / 同一 WiFi 下的设备可直接打开游玩。

用法:
  python scripts/10_serve_mvp.py            # 默认 0.0.0.0:8000
  python scripts/10_serve_mvp.py 8123       # 指定端口

启动后自动打印所有可用的局域网访问地址。
仅提供项目根目录内的静态文件，带 no-cache 头方便迭代调试。
=====================================================================
"""
import http.server
import os
import socket
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # C:\src\flight


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[mvp] " + (fmt % args) + "\n")


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("223.5.5.5", 80))       # 不发包，只让系统选出口网卡
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    url = "/scripts/mvp_air_to_ground.html"
    print(f"serving {ROOT} at http://0.0.0.0:{port}/", flush=True)
    for ip in lan_ips():
        print(f"  LAN: http://{ip}:{port}{url}", flush=True)
    print(f"  LOCAL: http://127.0.0.1:{port}{url}", flush=True)
    srv.serve_forever()

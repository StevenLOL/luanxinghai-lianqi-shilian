#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
04_local_server.py
=====================================================================
功能: 为 local_site/ 提供本地静态服务, 精确复刻 Forge 预览服务器对资源的
      `?module` 行为, 用于验证「端侧自托管网页端游玩」。

关键路由:
  / -> index.html
  /fragment-host/1/host.js -> 运行时(771KB, 内含 tailwind 编译器)
  /src/**.ts(x) -> 已转译为 JS 的源码, 以 text/javascript 返回
  /assets/<path>?v=<sha>&module -> 返回 JS 包装(export default new URL(...))
  /assets/<path>?v=<sha>        -> 返回真实二进制(png/mp3)

用法: python scripts/04_local_server.py 8899
=====================================================================
"""
import http.server
import mimetypes
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
OTHERS = os.path.join(os.path.dirname(HERE), "others")
ROOT = os.path.join(OTHERS, "local_site")
RAW = os.path.join(OTHERS, "assets_raw")   # 真实二进制
WRAP = os.path.join(OTHERS, "assets_dl")   # JS 包装

mimetypes.add_type("text/javascript", ".ts")
mimetypes.add_type("text/javascript", ".tsx")
mimetypes.add_type("text/javascript", ".mjs")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)
        # 修复: 裸参数 `?module`(无 =)默认被 parse_qs 丢弃, 需 keep_blank_values
        qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        is_module = "module" in qs

        # 资源: 真实二进制 vs JS 包装
        if path.startswith("/assets/"):
            logical = path.lstrip("/")            # assets/sounds/engine.mp3
            flat = logical.replace("/", "_")
            src = os.path.join(WRAP if is_module else RAW, flat)
            if os.path.exists(src):
                data = open(src, "rb").read()
                ctype = "text/javascript; charset=utf-8" if is_module else (
                    "audio/mpeg" if flat.endswith(".mp3") else "image/png")
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_error(404, "asset not found: " + flat)
            return

        # TS/TSX 强制 JS MIME
        if path.endswith((".ts", ".tsx")):
            f = os.path.join(ROOT, path.lstrip("/").replace("/", os.sep))
            if os.path.exists(f):
                data = open(f, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_error(404)
            return

        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("[srv] " + (fmt % args) + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"serving {ROOT} at http://127.0.0.1:{port}/")
    srv.serve_forever()

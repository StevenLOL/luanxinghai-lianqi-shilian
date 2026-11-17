#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
03_build_local_mirror.py
=====================================================================
功能: 把下载好的 fighter 源码/资源重组为一个自托管的本地站点 local_site/,
      用于验证「端侧网页端离线游玩」的可行性。

原理:
  预览页 index.html 用 importmap 把 react/react-dom 指向 esm.sh, 并用
  /fragment-host/1/host.js 作为运行时。host.js 会读取 main.tsx 里的 mount()
  配置, 再按需 import entry(TSX)、lib 与资源。所以本地镜像要保证:
    1) /fragment-host/1/host.js 可访问
    2) main.tsx / src/** 保持相对路径
    3) 资源 JS 包装(new URL(...))里的相对路径能解析到 assets_dl/ 包装文件
    4) react 通过 importmap 走本地 npm 包(由 04 脚本安装)或 esm.sh
  本脚本先构造目录与 index.html, react 解析留给运行环境。

用法: python scripts/03_build_local_mirror.py
输出: others/local_site/
=====================================================================
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OTHERS = os.path.join(os.path.dirname(HERE), "others")
SRC = os.path.join(OTHERS, "game_src_tree")
ASSETS = os.path.join(OTHERS, "assets_dl")
OUT = os.path.join(OTHERS, "local_site")

if os.path.exists(OUT):
    shutil.rmtree(OUT)
os.makedirs(OUT, exist_ok=True)

# 1) host 运行时
os.makedirs(os.path.join(OUT, "fragment-host", "1"), exist_ok=True)
shutil.copy(os.path.join(SRC, "host.js"), os.path.join(OUT, "fragment-host", "1", "host.js"))

# 2) src 树
shutil.copytree(os.path.join(SRC, "src"), os.path.join(OUT, "src"))
shutil.copy(os.path.join(SRC, "index.css"), os.path.join(OUT, "index.css"))
shutil.copy(os.path.join(SRC, "package.json"), os.path.join(OUT, "package.json"))

# 3) 资源包装(assets_dl 已扁平, 但 import 路径是相对多级的; 这里按 logicalPath 还原目录)
import json
payload = json.load(open(os.path.join(OTHERS, "share_payload.json"), "r", encoding="utf-8"))
for a in payload["fragment"]["assets"]:
    logical = a["logicalPath"]           # assets/sounds/engine.mp3
    flat = logical.replace("/", "_")     # assets_sounds_engine.mp3
    src_f = os.path.join(ASSETS, flat)
    dst_f = os.path.join(OUT, logical + "?module".replace("?", ""))  # placeholder
    # 真实目标: 源码 import '...engine.mp3?v=..&module' -> 浏览器请求路径 /assets/sounds/engine.mp3
    dst = os.path.join(OUT, logical)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(src_f):
        shutil.copy(src_f, dst)

# 4) index.html (react 走 esm.sh, 与线上一致)
html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fighter - local mirror</title>
<script type="importmap">{"imports":{
  "react":"https://esm.sh/react@19.2.8",
  "react/":"https://esm.sh/react@19.2.8/",
  "react-dom":"https://esm.sh/react-dom@19.2.8?external=react",
  "react-dom/":"https://esm.sh/react-dom@19.2.8&external=react/"
}}</script>
<link rel="modulepreload" href="/fragment-host/1/host.js" crossorigin />
</head><body style="margin:0">
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body></html>
"""
with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as fh:
    fh.write(html)

print("built:", OUT)
for root, dirs, files in os.walk(OUT):
    for f in sorted(files):
        p = os.path.join(root, f)
        print("  ", os.path.relpath(p, OUT), os.path.getsize(p))

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
01_fetch_fragment.py
=====================================================================
功能: 从 UI8 Forge 的签名预览 URL 递归抓取 fragment(fighter) 的完整源码与资源。

背景:
  forge.ui8.ai 的公开分享页(/share/...)本身只是 React 查看器外壳。
  真正的游戏代码通过 POST /api/v1/fragments/<id>/share/preview 拿到一个
  带签名的临时预览根 URL, 该 URL 下以原项目目录结构提供 .tsx/.ts/.png/.mp3。
  本脚本从 game_preview.html 出发, 解析 <link>/<script> 与源码中的
  import '...' / new URL / 资源字符串, 递归下载到本地 game_src_tree/, 并
  把带 ?v=hash 的版本参数保留到文件名映射, 便于离线重建。

用法:
  python scripts/01_fetch_fragment.py

依赖: 仅标准库 + 本机 curl(走系统代理/证书更稳)。
输出: others/game_src_tree/  (镜像原项目结构)
      others/fetch_manifest.json (下载清单: url, 本地路径, 字节数, sha256)
注意: 签名 URL 有 expiresAt(约 10 分钟), 过期需重新 POST preview 更新 BASE。
=====================================================================
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from urllib.parse import urljoin, urlparse, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
OTHERS = os.path.join(os.path.dirname(HERE), "others")
PREVIEW_JSON = os.path.join(OTHERS, "share_preview.json")
OUT_DIR = os.path.join(OTHERS, "game_src_tree")
MANIFEST = os.path.join(OTHERS, "fetch_manifest.json")

with open(PREVIEW_JSON, "r", encoding="utf-8") as fh:
    BASE = json.load(fh)["url"].rstrip("/") + "/"

os.makedirs(OUT_DIR, exist_ok=True)

# 已经有 hash 版本的主组件作为种子
SEEDS = [
    "index.html",
    "src/main.tsx",
    "src/components/fighter-jet-eject.tsx?v=62ba7fa637f1bf928a7b0a2160cef13fd9f42f0c1feabf564bc86f439b904b2d",
    "src/components/fighter-jet-eject.tsx",
    "package.json",
    # preview html 本身转发到下面的入口
    "./src/main.tsx",
]

# 从源码文本里抽取相对路径依赖(import/url/asset)
PATTERNS = [
    re.compile(r"""from\s+['"](\.[^'"]+)['"]"""),
    re.compile(r"""import\s*\(\s*['"](\.[^'"]+)['"]\s*\)"""),
    re.compile(r"""import\s+['"](\.[^'"]+)['"]"""),
    re.compile(r"""['"](\.\.?/[^'"\s]+\.(?:tsx?|jsx?|png|jpe?g|gif|webp|mp3|ogg|wav|json|css))['"]"""),
    re.compile(r"""['"]((?:assets|sounds|public|src)/[^'"\s]+\.(?:png|jpe?g|gif|webp|mp3|ogg|wav|tsx?|jsx?|json|css))['"]"""),
]


def fetch(url):
    """用 curl 下载二进制, 返回 (bytes, status)。"""
    p = subprocess.run(
        ["curl", "-sSL", "-A", "Mozilla/5.0", "-w", "\n%{http_code}", url],
        capture_output=True,
    )
    body = p.stdout
    if b"\n" not in body:
        return b"", 0
    data, code = body.rsplit(b"\n", 1)
    return data, int(code.decode(errors="ignore"))


def local_path_for(path):
    """把带 query 的 URL 路径映射成本地文件路径(去掉 ?v= 但保留目录结构)。"""
    clean = path.split("?")[0]
    clean = unquote(clean).lstrip("./")
    if clean.startswith("/"):
        clean = clean[1:]
    if clean == "" or clean.endswith("/"):
        clean += "index.html"
    return os.path.join(OUT_DIR, clean.replace("/", os.sep))


BASE_PATH = urlparse(BASE).path.rstrip("/")  # /api/fragment-preview/<token>


def normalize(ref, parent):
    """把相对引用解析为相对 BASE 的路径字符串。

    修复: urljoin 后的绝对路径包含签名 token 前缀(BASE_PATH), 必须剥掉,
    否则会拼成 .../token/api/fragment-preview/token/... 导致 404。
    """
    ref = ref.strip()
    if ref.startswith("http"):
        parsed = urlparse(ref)
        if "forge.ui8.ai" not in parsed.netloc:
            return None  # 外部 CDN(esm.sh)不抓
        path = unquote(parsed.path)
    else:
        full = urljoin(urljoin(BASE, parent), ref)
        parsed = urlparse(full)
        if "forge.ui8.ai" not in parsed.netloc:
            return None
        path = unquote(parsed.path)
    # 剥掉签名根前缀
    if path.startswith(BASE_PATH + "/"):
        path = path[len(BASE_PATH) + 1:]
    elif path == BASE_PATH:
        path = "index.html"
    return path.lstrip("/")


def refs_from_text(text, parent):
    found = set()
    for pat in PATTERNS:
        for m in pat.finditer(text):
            p = normalize(m.group(1), parent)
            if p:
                found.add(p)
    return found


manifest = {}
queue = list(SEEDS)
visited = set()

while queue:
    rel = queue.pop(0)
    rel = rel.lstrip("./")
    if rel in visited:
        continue
    visited.add(rel)

    url = BASE + rel
    data, code = fetch(url)
    if code != 200 or len(data) == 0:
        manifest[rel] = {"status": code, "error": "not found or empty"}
        continue

    lpath = local_path_for(rel)
    os.makedirs(os.path.dirname(lpath), exist_ok=True)
    with open(lpath, "wb") as fh:
        fh.write(data)

    entry = {
        "url": url,
        "local": os.path.relpath(lpath, OTHERS).replace("\\", "/"),
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "status": 200,
    }
    manifest[rel] = entry

    # 只解析文本类文件的依赖
    if re.search(r"\.(html|tsx?|jsx?|json|css|js|map)$", rel):
        try:
            text = data.decode("utf-8", errors="ignore")
        except Exception:
            text = ""
        for child in refs_from_text(text, rel):
            if child not in visited:
                queue.append(child)

with open(MANIFEST, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)

ok = sum(1 for v in manifest.values() if v.get("status") == 200)
print(f"downloaded {ok} files, {len(manifest)} total refs -> {OUT_DIR}")
for k, v in manifest.items():
    if v.get("status") == 200:
        print(f"  OK  {v['bytes']:>8}  {k}")
    else:
        print(f"  --  {k}  status={v.get('status')}")

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
02_fetch_assets.py
=====================================================================
功能: 按 share_payload.json 里列出的 32 个资源(logicalPath + sha256),
      从签名预览根 URL 下载 fighter 游戏的全部图片与音效资源。

资源在源码中以 `import url from '../../assets/xxx?v=<sha256>&module'`
引用, 预览服务器据此返回真实文件或转译后的 JS 模块, 因此必须带
`?v=<sha256>` 查询参数; 不带参数会 404(已在 01 脚本中踩坑验证)。

修复记录(规则9 举一反三):
  初版误用 `curl -o /tmp/x.bin` 把响应体写文件, 而 stdout 只剩 -w 的
  http_code, 导致把状态码当成文件内容(1 字节)。本版改为直接读 stdout
  的二进制响应体, 再用 rsplit(b'\n',1) 分离追加的状态码。

用法: python scripts/02_fetch_assets.py
输出: others/assets_dl/  (扁平化文件名, 目录用 _ 连接)
      others/assets_manifest.json
=====================================================================
"""
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OTHERS = os.path.join(os.path.dirname(HERE), "others")
OUT = os.path.join(OTHERS, "assets_dl")
os.makedirs(OUT, exist_ok=True)

payload = json.load(open(os.path.join(OTHERS, "share_payload.json"), "r", encoding="utf-8"))
base = json.load(open(os.path.join(OTHERS, "share_preview.json"), "r", encoding="utf-8"))["url"].rstrip("/") + "/"
assets = payload["fragment"]["assets"]

manifest = {}
for a in assets:
    logical = a["logicalPath"]
    sha = a["sha256"]
    url = base + logical + "?v=" + sha + "&module"
    # 关键: 不使用 -o, 让响应体走 stdout; -w 追加状态码
    p = subprocess.run(
        ["curl", "-sSL", "-A", "Mozilla/5.0", "-w", "\n%{http_code}", url],
        capture_output=True,
    )
    body = p.stdout
    if b"\n" not in body:
        manifest[logical] = {"status": -1, "error": "empty response"}
        continue
    data, code_raw = body.rsplit(b"\n", 1)
    try:
        code = int(code_raw.decode(errors="ignore").strip())
    except ValueError:
        code = -1
    ok = code == 200 and len(data) > 10
    name = logical.replace("/", "_")
    fpath = os.path.join(OUT, name)
    if ok:
        with open(fpath, "wb") as fh:
            fh.write(data)
    manifest[logical] = {
        "status": code,
        "bytes_expected": a.get("byteSize"),
        "bytes_got": len(data),
        "sha256": sha,
        "local": "assets_dl/" + name if ok else None,
        "head": data[:80].decode("latin-1", errors="ignore") if ok else "",
    }
    print(f"{'OK' if ok else 'FAIL':4} got={len(data):>8} exp={a.get('byteSize'):>8} {logical}")

with open(os.path.join(OTHERS, "assets_manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)

ok_n = sum(1 for v in manifest.values() if v.get("status") == 200 and v.get("bytes_got", 0) > 10)
print(f"\nOK {ok_n}/{len(assets)} assets -> {OUT}")

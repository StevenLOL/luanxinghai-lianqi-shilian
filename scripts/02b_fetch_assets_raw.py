#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
02b_fetch_assets_raw.py
=====================================================================
功能: 下载 fighter 的真实二进制资源(图片/音效)。

发现(规则9 举一反三):
  `?v=<sha>&module` 返回的是 JS 包装:
    export default new URL("...?v=<sha>", import.meta.url).href
  真实二进制在去掉 `&module`、仅保留 `?v=<sha>` 的 URL 上。
  本脚本据此下载原始 png/mp3, 并校验字节数与 manifest 一致、计算 sha256。

用法: python scripts/02b_fetch_assets_raw.py
输出: others/assets_raw/  校验: others/assets_raw_manifest.json
=====================================================================
"""
import hashlib
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
OTHERS = os.path.join(os.path.dirname(HERE), "others")
OUT = os.path.join(OTHERS, "assets_raw")
os.makedirs(OUT, exist_ok=True)

payload = json.load(open(os.path.join(OTHERS, "share_payload.json"), "r", encoding="utf-8"))
base = json.load(open(os.path.join(OTHERS, "share_preview.json"), "r", encoding="utf-8"))["url"].rstrip("/") + "/"
assets = payload["fragment"]["assets"]

manifest = {}
for a in assets:
    logical = a["logicalPath"]
    sha = a["sha256"]
    # 关键: 预览服务器的 JS 包装里 `new URL("../assets/xxx", import.meta.url)`
    # 会从 /assets/sounds/xxx?module 解析到 /assets/assets/sounds/xxx。
    # 真实二进制路径 = base + "assets/" + logicalPath + "?v=<sha>"。
    url = base + "assets/" + logical + "?v=" + sha  # 不带 &module
    p = subprocess.run(
        ["curl", "-sSL", "-A", "Mozilla/5.0", "-w", "\n%{http_code}", url],
        capture_output=True,
    )
    body = p.stdout
    data, code_raw = body.rsplit(b"\n", 1)
    code = int(code_raw.decode(errors="ignore").strip())
    actual_sha = hashlib.sha256(data).hexdigest()
    ok = code == 200 and actual_sha == sha
    name = logical.replace("/", "_")
    if ok:
        with open(os.path.join(OUT, name), "wb") as fh:
            fh.write(data)
    manifest[logical] = {
        "status": code,
        "bytes": len(data),
        "expected_bytes": a.get("byteSize"),
        "sha_match": actual_sha == sha,
        "sha": sha,
        "mime": a.get("mime"),
        "local": "assets_raw/" + name if ok else None,
    }
    print(f"{'OK' if ok else 'FAIL':4} {len(data):>8}/{a.get('byteSize'):>8} sha={actual_sha[:8]}=={sha[:8]} {logical}")

with open(os.path.join(OTHERS, "assets_raw_manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=2)
print(f"\nOK {sum(1 for v in manifest.values() if v.get('sha_match'))}/{len(assets)} -> {OUT}")

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
06_clarity_compare.py
=====================================================================
功能: 生成不同"清晰度参数"组合的 main.tsx, 通过本地服务器逐组截图,
      用真实画面对比 pixelSize / spread / bloom-grain / view 的影响。

原理:
  local_site/src/main.tsx 里的 mount({...}) 配置含 "values":{...},
  其中 pixelSize/spread/bloom/grain/view/jetScale 就是渲染参数。
  本脚本备份原文件, 对每组参数做精确字符串替换, 用 Chrome headless
  截图, 最后恢复原文件(try/finally 保证不破坏可玩副本)。

前置: 本地服务器在 127.0.0.1:8899 运行(05_launch 或 04)。
用法: python scripts/06_clarity_compare.py
输出: others/clarity/*.png + others/clarity/report.json
=====================================================================
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
OTHERS = os.path.join(os.path.dirname(HERE), "others")
MAIN = os.path.join(OTHERS, "local_site", "src", "main.tsx")
OUT = os.path.join(OTHERS, "clarity")
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
URL = "http://127.0.0.1:8899/"

# 每组: 名称 + 要覆盖的 values 键
VARIANTS = [
    ("00_baseline",   {}),                                                    # px3, 现状
    ("01_px1",        {"pixelSize": 1}),                                      # 最高缓冲分辨率
    ("02_px1_nofx",   {"pixelSize": 1, "bloom": 0, "grain": 0, "vignette": 0}),# 最高分辨率 + 关软滤镜
    ("03_spread4",    {"spread": 4}),                                         # 切片间距拉大(伪3D层数感)
]

original = open(MAIN, "r", encoding="utf-8").read()


def make_variant(src, params):
    """只替换 values 块里的键, 用负向断言避免误改 story.default。"""
    out = src
    for k, v in params.items():
        val = json.dumps(v)  # 数字/字符串都能正确序列化
        # values 块内的 "key":current —— 用前后文锚定到 values 区段
        pat = re.compile(r'("values":\{[^\n]*?"' + re.escape(k) + r'":)([^,}\n]+)')
        out, n = pat.subn(lambda m: m.group(1) + val, out, count=1)
        if n == 0:
            print(f"  ! key {k} not replaced")
    return out


def _shoot_once(png, budget):
    """截一张; 用系统临时 profile, 用完即删。"""
    profile = tempfile.mkdtemp(prefix="fighter_clarity_")
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--hide-scrollbars", "--window-size=1280,800",
           f"--user-data-dir={profile}",
           f"--virtual-time-budget={budget}", f"--screenshot={png}", URL]
    try:
        subprocess.run(cmd, capture_output=True, timeout=120)
    except subprocess.TimeoutExpired:
        pass
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    return os.path.getsize(png) if os.path.exists(png) else 0


def screenshot(name):
    """重试直到拿到"有内容"的帧。

    根因(规则9, 第三轮, 最终): 蓝色/纯色帧不是错误 —— 游戏在自动演示,
    某些时刻相机指向天空或俯冲, 画面本就是纯色(~5.9KB)。真实场景帧
    一般 >100KB。前两轮归咎 profile 锁 / 虚拟时间是误诊。正解: 多次
    截图 + 按文件大小判定, 取第一个 >60KB 的帧。
    """
    png = os.path.join(OUT, name + ".png")
    best = 0
    for attempt, budget in enumerate([8000, 5000, 11000, 3000, 9000]):
        size = _shoot_once(png, budget)
        best = max(best, size)
        if size > 60000:
            return png, size
        print(f"    retry {name} attempt={attempt} budget={budget} size={size} (sky-only?)")
    return png, best


def main():
    os.makedirs(OUT, exist_ok=True)
    results = {}
    try:
        for name, params in VARIANTS:
            variant = make_variant(original, params)
            with open(MAIN, "w", encoding="utf-8") as fh:
                fh.write(variant)
            time.sleep(0.3)  # 让服务器读到新文件
            png, size = screenshot(name)
            results[name] = {"params": params, "png": os.path.basename(png), "bytes": size}
            print(f"  {name:16} {size:>8}B  {params}")
    finally:
        # 关键: 无论发生什么都要恢复原文件, 否则可玩副本被改坏
        with open(MAIN, "w", encoding="utf-8") as fh:
            fh.write(original)
        print("[+] main.tsx 已恢复原状")

    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)
    print(f"[+] 对比图在 {OUT}")


if __name__ == "__main__":
    main()

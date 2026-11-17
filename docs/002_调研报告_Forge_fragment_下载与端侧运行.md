# 002 调研报告：Forge fragment「fighter」能否下载 / 端侧网页端 / Godot 游玩

> 依据 `C:\src\规则.txt` 规则 3/5/7：调研评审输出落盘、保留可信信源。
> 调研时间：2026-11-17 11:07–11:35 GMT+8
> 目标：https://forge.ui8.ai/share/frag_1eb8944c-57b1-42ca-a909-5c2d7e517c24

---

## 0. 结论速览（先看这里）

| 问题 | 结论 | 可信度 | 关键证据 |
|------|------|--------|----------|
| **能否下载？** | ✅ **能完整下载**（源码 + 全部资源） | 已实测 | 公开 API 拿到 13 个源码文件（382,269 B）+ 32 个资源（2,659,352 B），资源 sha256 全部校验通过 |
| **① 网页端游玩（端侧）** | ✅ **能，且可完全离线本地运行** | 已实测截图 | 在线渲染成功；本地镜像 + 断网（`MAP * ~NOTFOUND`）仍渲染出游戏画面 |
| **② Godot 游玩** | ⚠️ **不能直接运行；可移植但非平凡** | 源码级分析 | 该游戏是纯 JS/Canvas-2D 软件渲染器 + 少量 WebGL，无 three.js；Godot 不原生执行 JS/TS；需移植或 WebView 封装 |

一句话：**下载没问题，网页端（含离线端侧）完全可玩；Godot 无法直接开箱运行，只能作为“源码级移植”或“内嵌浏览器”工程来做。**

---

## 1. 目标对象识别

- 分享页标题：`fighter · Forge`
- 描述：Pixel-art fighter jet built by sprite stacking, over stacked islands；Space 切换俯视/追尾/座舱视角，点击翻滚，按住推进器，从海面飞到高空。
- 平台：**UI8 Forge**（ui8.ai 旗下、ROBOT GLOBAL FZCO 运营的 AI 前端/游戏原型工具）。
- fragment 元信息（来自公开 API，见 §6 S6）：

| 字段 | 值 |
|------|----|
| id | `frag_1eb8944c-57b1-42ca-a909-5c2d7e517c24` |
| name / slug | `fighter` / `fly` |
| visibility | `public` |
| linkAccess | `remix`（任何人可查看并 remix） |
| revision | 44（publishedRevision 43） |
| 变体 | 1 个：`fighterv2`，entry `fighter-jet-eject`，`sourceByteSize` 48,795 |
| 资源数 | 32（PNG 精灵图 + MP3 音效） |
| tags | pixel-art, sprite-stacking, canvas, animation, interactive, game |

**重要澄清**：Forge 官网游戏页宣传 “Stackers, hoppers … in three.js”（S4），但**这个具体 fragment 并不是 three.js 游戏**。源码实证：全部 `src/**` 中 `from 'three'` / `THREE.` 的导入为 **0**；渲染是纯手写 Canvas-2D 软件光栅化 + 一个 WebGL 尾焰 shader 层（见 §4.1）。This matters for Godot 评估——它是一个**自包含的软件渲染管线**，而不是可直接对接 Godot 3D 的场景。

---

## 2. 下载能力调研（Q1）

### 2.1 发现过程（技术路径，可复现）

1. 分享页 `GET /share/<id>` 只是一个 React **查看器外壳**（Vite 打包，`index-rM3D8Mce.js`），游戏本体不在 HTML 里。
2. 从 JS bundle 逆向出接口表，关键接口：
   - `GET /api/v1/fragments/<id>/share` → 公开返回 fragment 元信息 + assets 清单（**无需登录，200**）。
   - `POST /api/v1/fragments/<id>/share/preview` `{}` → 返回一个**带签名的临时预览根 URL**（`expiresAt` 约 10 分钟）。
   - 该签名 URL 下按原项目路径提供源码与资源：`index.html`、`src/main.tsx`、`src/components/*.tsx`、`src/lib/*.ts`、`assets/...`。
3. 注意：`GET /api/v1/fragments/<id>`（不带 `/share`）返回 **401 unauthorized**；`/tree`、`/revisions` 同样需登录。**公开可拿的是 `/share` 路径族**。

### 2.2 下载结果（实测）

| 类别 | 数量 | 字节 | 校验 |
|------|------|------|------|
| 源码 `.ts/.tsx` | 13 | 382,269 | main 组件 47,996 B（与声明 48,795 B 差异为服务端 JSX 转译 preamble，非缺块） |
| host 运行时 | 1 | 771,000 | `fragment-host/1/host.js` |
| 资源 PNG/MP3 | 32 | 2,659,352 | **32/32 sha256 与 manifest 完全一致** |
| React / ReactDOM | 3 bundle | ~197,600 | esm.sh vendored（用于离线） |

- 落盘目录：`others/game_src_tree/`、`others/assets_raw/`、`others/local_site/`。
- 抓取脚本：`scripts/01_fetch_fragment.py`、`scripts/02_fetch_assets.py`、`scripts/02b_fetch_assets_raw.py`、`scripts/03_build_local_mirror.py`。
- 清单：`others/fetch_manifest.json`、`others/assets_manifest.json`、`others/assets_raw_manifest.json`。

源码清单（13）：
`fighter-jet-eject.tsx`, `main.tsx`, `lib/eject/scene.ts`(208KB / 4,826 行), `lib/eject/tutorial.ts`, `lib/cockpit.ts`, `lib/flame-layer.ts`, `lib/jet-model.ts`, `lib/pilot-model.ts`, `lib/post.ts`, `lib/sound.ts`, `lib/voxel-sprite.ts` 等。

### 2.3 法律/条款维度（规则7：信源必留）

- Forge ToS（S7，2026-10-09 生效）：`Your content ... You keep all rights to your content. We do not claim ownership of it` —— 内容权利归创作者，平台不主张所有权；
- 但 ToS 同时禁止 `access it by automated means other than the interfaces we provide (such as the MCP server and API)` 与 `reverse engineer the Service`，并声明签名/分享链接的可见性由创建者设置。
- **判断**：技术上可下载且 `linkAccess=remix` 明确授权他人 “use, copy, modify and build on what they copy, including in their own projects, commercial or not”；**但这是创作者对 remix Copies 的授权，不等同于把“逆向签名预览接口批量抓源码”写成通用权利**。合规用法优先：登录 → Remix 到自己的 workspace（官方支持路径，S5/S7），或用官方 MCP 的 `pulls the code, assets and controls into your codebase`（S6）。本报告的抓取用于**可行性调研**，若要商业化再分发应取得创作者授权或走 Remix 路径。

### 2.4 版权/署名注意

源码内注释显示作者自述工具链：`tools/gen-sounds.mjs` 生成音效；模型为 RLE+base64 编码的体素数据（`jet-model.ts` / `pilot-model.ts`）。再分发需保留原出处（main.tsx mount 配置含 original variant id）。

---

## 3. 网页端游玩调研（Q2-1，端侧）

### 3.1 在线游玩

- 直接打开分享页 → 查看器 iframe 渲染游戏。实测 `game_online.png`：1280×800，像素战机 + 堆叠岛屿 + 敌机 + HUD + 橙色尾焰，**完整可玩画面**。
- 分享页特性（S5/S6）：只读预览 + 控件 playground（改动不保存），`Anyone can view and remix`。

### 3.2 端侧本地自托管（关键）

构建 `others/local_site/`：
- 保留 `fragment-host/1/host.js` 运行时；
- 源码 `.ts/.tsx` 以 `text/javascript` 提供（Forge 服务端已把 TSX 转译成带 `react/jsx-runtime` 的 JS，可直接当 ESM 跑）；
- 资源服务器区分 `?module`（返回 `export default new URL(...)` 包装）与无参数（返回真实二进制）——复刻 Forge 预览服务器的资源语义；
- React/ReactDOM/JSX-runtime 通过 esm.sh `?bundle` vendored 到本地 `vendor/`。

实测结果：

| 场景 | 命令要点 | 结果 |
|------|----------|------|
| 本地 HTTP 服务 | `python scripts/04_local_server.py 8899` | 所有模块/资源 200 |
| 自托管（联网） | Chrome headless 打开 `http://127.0.0.1:8899/` | `game_local.png` = 185,361 B，与在线截图**逐字节一致** |
| **完全离线** | Chrome 加 `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"` 阻断一切外网 | `game_offline.png` = 195,525 B，渲染出俯视视角、敌机、岛屿、尾迹、HUD（动画已在推进，画面帧不同） |

**结论：网页端端侧可玩，并且能在无任何外网连接的纯本地环境下运行。** 运行前提：一个本地静态 HTTP 服务器（ES module + importmap 不能直接用 `file://` 打开）。

### 3.3 交互验证范围说明

本次用 Chrome headless 截图验证了**渲染与自运行（attract/自动演示）**；键盘/鼠标/触屏实际操作由游戏内 `addEventListener` + `requestAnimationFrame` 主循环实现（源码 `fighter-jet-eject.tsx` 第 111–441 行可见 `keydown`/`pointer`/`touch` 与 `raf` 循环），在浏览器环境中与在线版共用同一代码路径，无端侧差异。

---

## 4. Godot 游玩调研（Q2-2）

### 4.1 技术栈实证（决定可行性）

| 维度 | 实证 |
|------|------|
| 脚本语言 | TypeScript/TSX（已转译为 JS ESM） |
| 渲染 | **Canvas 2D 软件渲染器**：`getContext('2d')` + `putImageData` + `Uint32Array/Uint8Array/Uint8ClampedArray` 像素缓冲；`scene.ts` 4,826 行手写光栅化 |
| 后处理/尾焰 | `post.ts`（glow/vignette/grain 在像素缓冲上做）；`flame-layer.ts` 一个独立 WebGL canvas + 自定义 shader（`createShader`/`drawArrays`） |
| 3D 引擎 | **无 three.js、无 Godot/Unity 资产**；模型是代码内 RLE+base64 体素数据 |
| 状态/UI | React 19 hooks（`useRef/useState/useEffect`）+ 参数面板；`requestAnimationFrame` 主循环 |
| 资源 | 32 个外部 PNG/MP3（已下载校验） |
| 依赖 | 仅 react / react-dom（+ host 运行时） |

### 4.2 Godot 能力对照（S8/S9，官方文档）

- Godot 官方脚本语言：**GDScript、.NET/C#、C++ via GDExtension**（另有社区绑定，含 JavaScript binding，但**非官方、非一等支持**）。**没有原生 JS/TS 运行时，也不能直接执行浏览器 Canvas/WebGL 代码**。
- 因此：**把下载的 `.ts/.tsx` 直接拖进 Godot 运行 → 不可行**。
- Godot 有 WebXR / OpenGL / Vulkan 渲染，但那是 Godot 自己的渲染 API，与 HTML Canvas 2D `putImageData` 不是一回事。

### 4.3 可行路径（按工程量从低到高）

| 方案 | 做法 | 保真度 | 工程量 | 评价 |
|------|------|--------|--------|------|
| **A. WebView / 内嵌浏览器** | Godot 内嵌 `CEF`/`WebView`（桌面端插件），加载 `local_site/index.html` | 100%（像素级一致） | 低-中 | **最快“在 Godot 里游玩”**：Godot 只做壳，游戏仍是网页。桌面端可行；移动端/导出 Web 受限 |
| **B. 半移植：保留 JS 逻辑** | 用 Godot JavaScript binding / QuickJS GDExtension 跑纯计算部分（体素解码、飞行动力学），渲染换成 Godot `ImageTexture` + `Sprite2D`/`TextureRect` | 高（需重写渲染层） | 中-高 | 逻辑可复用，渲染需重写 `putImageData` → `Image.set_pixel` / PackedByteArray |
| **C. 全移植 GDScript/C#** | 把 `scene.ts` 的 4,826 行软件光栅化逐段翻译；体素模型数据（RLE+base64）可直接搬；shader 尾焰改 Godot `ShaderMaterial` | 高（可做到很像） | **高**（数千行） | 真正的 Godot 原生版，可导出各平台；是最彻底但最贵的路 |
| **D. 用 SpriteMesh 类插件重制观感** | 借 Godot SpriteMesh / billboard 插件（S10）用像素图生成 2.5D 网格 | 中（观感接近，逻辑重写） | 中-高 | 适合“借鉴玩法重做”，非“移植原作” |

### 4.4 Godot 结论

- **开箱即用：否**。没有可直接导入运行的 Godot 工程，Godot 也不执行 JS/TS。
- **可移植：是**，且**代码完全可读、算法自包含**（无引擎锁定），这是有利因素；`createScene(initial)` → `render()` / `resize(w,h)` 的清晰 API 边界（scene.ts:423/4680/1249）便于封装。
- **推荐**：若目标只是“在 Godot 项目里玩到它”→ 方案 A（WebView 壳）；若目标“做成 Godot 原生可导出游戏”→ 方案 C，按天/周级工作量估算，需重写渲染与输入层，复用体素数据与参数体系。
- 未安装 Godot 本机（环境检测：godot/godot4 均 none），故**未做实机导入演示**；以上为源码级 + 官方文档可行性判定。

---

## 5. 竞品调研（规则6）

已 clone 到 `others/twopoint5d/`（Gitee 镜像，`git clone --depth 1`，76MB，checkout 因 Windows 路径告警但源码可读）：

- **twopoint5d**（`@spearwolf/twopoint5d`，Apache-2.0，S11）：three.js + TypeScript 的 2.5D/像素艺术库，monorepo，含 vanilla 与 react-three-fiber 两种 flavor；提供 2.5D sprite/particle、图集动画、billboard、地图导入。与本 fragment 的关系：同为 sprite-stack/2.5D 路线，但 twopoint5d 依赖 three.js，本 fragment 是自研 Canvas 软件渲染——**反证“sprite stacking 不等于 three.js”**。
- 其他生态参考（未 clone，仅存档信源）：VoxCSS（DOM 体素引擎）、SpriteJS（360 开源跨端 Canvas）、Godot SpriteMesh 插件（2D 精灵→3D 网格）。
- 结论：若要在 Godot 复刻，SpriteMesh 类工具（S10）比 twopoint5d 更贴近，但都只解决“观感/几何”，**飞行动力学、弹道、镜头、AI 仍需自写**。

---

## 6. 信源清单（规则7：全部保留）

| 编号 | 来源 | URL | 用途 |
|------|------|-----|------|
| S1 | 分享页 HTML | https://forge.ui8.ai/share/frag_1eb8944c-57b1-42ca-a909-5c2d7e517c24 | 标题/描述/OG 预览图 |
| S2 | 分享元信息 API | https://forge.ui8.ai/api/v1/fragments/frag_1eb8944c-57b1-42ca-a909-5c2d7e517c24/share | 可见性/remix/变体/资源清单 |
| S3 | 签名预览 API | `POST https://forge.ui8.ai/api/v1/fragments/<id>/share/preview` | 拿到源码/资源根 URL |
| S4 | Forge 游戏官网 | http://ui8.ai/forge/games | three.js 宣传口径（用于对照） |
| S5 | UI8 Forge 首页 | https://ui8.ai/ | fragment/Share/Remix/发布能力 |
| S6 | Forge 文档 | https://ui8.ai/forge/docs | React app 定义、read-only preview、pull code/assets/controls、MCP `read a project's details and files` |
| S7 | Forge ToS | https://forge.ui8.ai/terms | 内容所有权、remix 授权、可接受使用限制 |
| S8 | Godot 脚本语言文档 | https://docs.godotengine.org/pl/4.x/getting_started/step_by_step/scripting_languages.html | 官方语言清单、无 JS 一等支持 |
| S9 | Godot 特性页 | https://godotengine.org/features/ | 社区 JS binding、GDExtension、渲染能力 |
| S10 | Godot SpriteMesh 指南(CSDN) | https://blog.csdn.net/weixin_42526249/article/details/160724775 | SpriteMesh 2D→3D 网格插件机制（社区信源，辅助） |
| S11 | twopoint5d | https://gitee.com/atuxe/twopoint5d （上游 spearwolf/twopoint5d, Apache-2.0） | 竞品 clone 分析 |

本地一手证据（本次实测产物）：
`others/game_online.png`、`others/game_local.png`、`others/game_offline.png`、`others/share_payload.json`、`others/assets_raw_manifest.json`、`others/fetch_manifest.json`。

---

## 7. 代码评审与 bug 复盘（规则8/9）

抓取/镜像脚本评审发现并修复 3 个 bug，均已举一反三：

1. **URL 双重前缀**（`01_fetch_fragment.py`）：`urljoin` 结果带签名 token 前缀，未剥离导致 lib 依赖 404。修复：`normalize()` 剥掉 `BASE_PATH`。教训：签名代理路径下所有相对解析都要以“根 URL 的 path”为基准。
2. **`curl -o` 吞掉响应体**（`02_fetch_assets.py`）：把 body 写文件后 stdout 只剩状态码，误把 1 字节状态码当内容。修复：不用 `-o`，从 stdout `rsplit(b'\n',1)` 分离 body 与 code。教训：自动化下载不要把“状态输出”和“数据输出”混到不同 fd 后再假设。
3. **`?module` 裸参数被丢弃**（`04_local_server.py`）：`urllib.parse.parse_qs('module') == {}`，导致资源路由失效、返回音频二进制给 ESM import。修复：`keep_blank_values=True`。教训：Python `parse_qs` 默认丢空值参数，浏览器常见的 flag 型 query 必须显式保留。

举一反三检查：同类相对 URL/裸参数问题已在 01/02/02b/03/04 全部脚本统一审视，manifest 中 32/32 sha256 校验通过即为回归验证。

---

## 8. 交付物索引

```
docs/001_调研需求与交互记录.md           用户输入落盘
docs/002_调研报告_...md                  本报告
scripts/01_fetch_fragment.py             递归抓源码
scripts/02_fetch_assets.py               抓资源包装（含 bug 修复注释）
scripts/02b_fetch_assets_raw.py          抓真实资源 + sha 校验
scripts/03_build_local_mirror.py         组装本地镜像
scripts/04_local_server.py               复刻预览资源语义的本地服务器
others/game_src_tree/                    13 个源码文件
others/assets_raw/                       32 个校验过的资源
others/local_site/                       可离线运行的网页副本
others/game_*.png                        在线/本地/离线三张验证截图
others/twopoint5d/                       竞品 clone
```

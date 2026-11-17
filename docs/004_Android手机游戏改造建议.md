# 004 把 fighter fragment 改造成 Android 手机游戏：建议方案

> 规则 3/5/7：调研输出落盘、信源保留。
> 时间：2026-11-17 11:49 GMT+8
> 背景：已完整下载源码/资源（见 002），用户计划改造为 Android 手机游戏。

---

## 0. 一句话建议

**不要重写游戏**。这个 fragment 本身就是“为触屏而生”的网页游戏——源码已内置手机检测、单指操控、点按翻滚、屏幕按钮、手柄支持。最佳路径是 **Capacitor 把已离线可玩的 `local_site/` 打包成 Android App**（几天级、保真 100%），先跑通真机；只有当需要原生性能/商店深度集成时，再考虑 Godot/WebView 原生化或源码级移植。

---

## 1. 关键前提：游戏已原生支持手机（源码实证）

来自 `src/components/fighter-jet-eject.tsx`（一手源码，本地已落盘）：

| 证据 | 行号/代码 | 含义 |
|------|-----------|------|
| 触屏检测 | `:112` `window.matchMedia('(pointer: coarse)').matches` → `setFingerScreen(true)` | 自动识别手机/平板 |
| 屏幕按钮开关 | `:114` `touchControls === 'on' \|\| (touchControls === 'auto' && fingerScreen)` | 默认 auto，手机上自动显示 |
| 单指驾驶 | `:565-570` `byFinger(e)` = `e.pointerType === 'touch'`；一指按下即持续转向 | 为触屏重写过操控，不是简单映射鼠标 |
| 点按翻滚 | `:568` `endFinger(e, tap)` 注释 “a quick tap rolls” | 移动端专属手势 |
| 屏幕按钮 | `:586-626` Hold Gun / Boost / Missile，`setPointerCapture` | 多指并发、按钮触摸不外泄 |
| 手柄支持 | `:41-72` / `:365` 教程文案含 `Left stick` / `Hold X` | 可外接手柄 |
| 音频合规 | `:98` `// the sound waits for a click, a touch or a key before it may start` | 满足移动浏览器/WebView 自动播放策略（首次交互解锁） |
| 控件参数 | `main.tsx` mount 配置 `touchControls: 'auto'`, `view: 'chase'` 等 | 打包时可直接改默认参数 |

**结论**：Android 化的主要工作是“包装 + 适配 + 调优”，不是“重做操控”。这点决定整个方案的成本。

---

## 2. 本机环境核查（规则 13，举一反三后确认）

| 项目 | 实测结果 | 备注 |
|------|----------|------|
| Android SDK | `E:\AndroidSDK\`，含 platforms `android-31/33/34/35/36/37.0`、build-tools `34.0.0~36.1.0`、cmdline-tools latest、NDK | 齐全 |
| adb | `E:\AndroidSDK\platform-tools\adb.exe`，version `36.0.0-13206524`（1.0.41） | 规则10：调试先开网络调试（无线 adb） |
| 设备 | `adb devices` 当前**无连接设备** | 真机验证前需连接或开 Wi-Fi 调试 |
| Java | OpenJDK 17.0.20.1 | 满足 Capacitor/AGP 要求 |
| Node/npm | v22.22.2 / 10.9.7 | 满足 Capacitor v8 |
| gradle | PATH 中无 | Capacitor 生成的项目自带 Gradle Wrapper，无需全局 gradle |
| Android Studio | 本机未确认（未安装也可命令行构建；建议装以获得签名/打包 GUI） | 可用 `npx cap open android` |
| 离线网页副本 | `C:\src\flight\others\local_site\`，已断网实测可玩（002 §3.2） | 直接作为 `webDir` |

---

## 3. 方案对比与推荐

| 方案 | 做法 | 保真度 | 周期 | 风险 | 适合 |
|------|------|--------|------|------|------|
| **A. Capacitor 包装（强推荐起步）** | `webDir=local_site`，`npx cap add android`，一次构建出 APK/AAB | **100%**（同一套代码） | 天级 | 低；需真机调性能/全屏 | 快速上架、验证市场 |
| **B. 裸 WebView（手写壳）** | 自己写 `Activity` + `WebView` 加载 assets | 100% | 天级 | 中；桥接/全屏/返回键要自己处理 | 想零 npm 依赖、完全可控 |
| **C. CEF WebView（gdCEF）** | Godot 内嵌 Chromium（002 §4.4 A） | 100% | 周级 | 中；CEF 产物 ~500MB、不支持 Android | 桌面+移动统一工程，非纯 Android 首选 |
| **D. GodotJS 半移植** | 用 GodotJS 跑 JS 逻辑、重写渲染（002 §4.4 B） | 高 | 周~月 | 高；GodotJS beta、4.7 WIP | 要原生工程且复用 JS 算法 |
| **E. 全原生重写（GDScript/C#/Kotlin）** | 翻译 `scene.ts` 4,826 行 + 用 32 个已校验资源 | 高（可很像） | 月级 | 高；工作量大 | 长期原生产品、极致性能 |

**推荐：A → 真机验证 → 视需要局部叠加原生能力（广告/内购/成就用 Capacitor 插件），不要一上来走 D/E。**

### 为什么 A 是首选（信源支撑）

- Capacitor 官方：设计为“drop into any modern JavaScript web app”，要求仅 `package.json` + 构建产物目录 + `index.html`（S1），`npx cap add android` / `npx cap sync` 把 web bundle 拷进原生工程（S1）。
- Capacitor 用系统 WebView 承载 web app —— 正是我们已在浏览器验证过的运行环境；游戏所需 API（Canvas2D、WebGL、Pointer Events、matchMedia）都是标准 WebView 能力。
- 离线完全可行：所有源码/资源/React 已在 `local_site/` 本地化（002 §3.2 断网实测），WebView 从 assets 加载，无需网络。

---

## 4. 落地步骤（按此顺序做）

### Step 1 — 准备工作目录（规则 12：复用已下载，不重复下载）

```bash
cd C:/src/flight
mkdir -p android_app && cp -r others/local_site/* android_app/www/
```

`www/` 即 Capacitor 的 `webDir`。确认 `www/index.html` 存在且有 `<head>`（Capacitor 要求，S1）。

### Step 2 — 初始化 Capacitor（命令来自官方文档 S1）

```bash
cd android_app
npm init -y
npm i @capacitor/core
npm i -D @capacitor/cli
npx cap init
npm i @capacitor/android
npx cap add android
```

`capacitor.config.ts` 建议（键值来自官方 schema S2）：

```ts
import { CapacitorConfig } from '@capacitor/cli'
const config: CapacitorConfig = {
  appId: 'com.yourdomain.fighter',   // 反域名，自行替换
  appName: 'Fighter',
  webDir: 'www',
  loggingBehavior: 'debug',          // 发布改 'none'
  android: {
    allowMixedContent: false,        // 全本地资源，保持 false（S2）
    zoomEnabled: false,              // 游戏禁止缩放（S2）
    minWebViewVersion: 60,           // 官方默认/下限（S2）
  },
}
export default config
```

### Step 3 — 同步并构建

```bash
npx cap sync
npx cap open android     # 用 Android Studio 打开（若无 AS，可 ./gradlew assembleDebug）
```

### Step 4 — 真机调试（严格执行规则 10/11）

```bash
# 无线调试（Android 11+）：先 USB 连接一次开启
E:/AndroidSDK/platform-tools/adb.exe tcpip 5555
E:/AndroidSDK/platform-tools/adb.exe connect <手机IP>:5555
E:/AndroidSDK/platform-tools/adb.exe devices        # 确认设备在线

# logcat 必须落盘再从本地读（规则11）
E:/AndroidSDK/platform-tools/adb.exe logcat > C:/src/flight/others/android_logcat.txt
```

在真机重点验证：横屏全屏、触控转向/翻滚/屏钮、帧率、音频解锁、退出/返回键行为。

### Step 5 — 游戏内适配（可选，改 `local_site` 源码后重新 sync）

- 默认横屏：`capacitor.config.ts` 无直接键，在 `android/app/src/main/AndroidManifest.xml` 给 activity 加 `android:screenOrientation="landscape"`；或 `@capacitor/screen-orientation` 插件。
- 全屏/沉浸式：隐藏状态栏（`@capacitor/status-bar` 的 `hide()`）。
- 参数：`main.tsx` mount 配置里把 `touchControls: 'auto'`、`view: 'chase'`、`pixelSize` 等调成手机体验值（源码已支持，见 §1）。
- 返回键：Capacitor `App.addListener('backButton', ...)` 处理退出确认。

---

## 5. 主要技术风险与对策

| 风险 | 说明 | 对策 |
|------|------|------|
| **Canvas2D 软件渲染性能** | `scene.ts` 是 CPU 逐像素光栅化，中低端机可能掉帧 | 真机测帧率；调 `pixelSize`（源码支持 0=auto/最大12）降分辨率；必要时用方案 E 局部 GPU 化 |
| **WebGL 尾焰兼容** | `flame-layer.ts` 用 WebGL shader；部分 WebView 需开硬件加速 | Capacitor WebView 默认硬件加速；真机验证 shader；失败可切 `flameStyle:'pixel'`（源码参数，绕过 WebGL） |
| **音频延迟/解锁** | WebView 音频有延迟；自动播放需用户手势 | 源码已实现“首次触摸解锁”（§1）；如需低延迟音效改原生音频插件 |
| **商店合规** | WebView 套壳上架需有足够原生体验 | 加原生启动屏、设置、存档、成就；遵循 Google Play 政策（信源 S3） |
| **版权** | 源码权利归原作者（002 §2.3） | 上架前取得授权或按 Remix 条款；保留出处 |

---

## 6. 信源清单（规则 7）

| 编号 | 来源 | URL | 用途 |
|------|------|-----|------|
| S1 | Capacitor 官方 Getting Started | https://capacitorjs.com/docs/getting-started | npm 安装、`npx cap init/add android/sync`、webDir/index.html 要求（官方原文命令） |
| S2 | Capacitor Configuration | https://capacitorjs.com/docs/config | `appId/appName/webDir/loggingBehavior/android.{allowMixedContent,zoomEnabled,minWebViewVersion,buildOptions}` schema |
| S3 | Google Play 政策（WebView/最低功能） | https://support.google.com/googleplay/android-developer/answer/9859152 | 套壳上架合规（需人审确认最新条款） |
| S4 | 本机一手 | `fighter-jet-eject.tsx` 源码行 97/112/114/565-626；`adb devices`/`adb version`；Android SDK 目录 | 触屏支持与环境结论 |
| S5 | 本系列报告 | `docs/002_调研报告...md` §3.2/§4 | 离线网页副本与 Godot 对照 |

---

## 7. 建议的下一步（给用户）

1. **先做 Step 1–4 的最小 APK**，用你自己的手机跑起来（今天内可完成）；
2. 真机若 60fps 稳定 → 直接走上架流程（Capacitor 插件补原生能力）；
3. 若掉帧 → 先调 `pixelSize`/`flameStyle` 参数，再评估是否值得做方案 E 的渲染层 GPU 化；
4. 上架前务必解决授权问题（002 §2.3）。

我可以直接帮你生成 `android_app/` 的 Capacitor 工程骨架与 `capacitor.config.ts`，你只需提供包名（appId）与是否要横屏锁定。

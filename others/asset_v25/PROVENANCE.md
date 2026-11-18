# 背视角剑仙素材溯源（v2.5）

- 资产名：`sword_immortal_back`
- 生成日期：2026-11-18
- 路线：`host-image_gen`（本机 WorkBuddy ImageGen；无 API key，宿主自带图像工具）
- 参考图（按附加顺序）：
  1. `scripts/assets/sword_immortal_cut.png` — 同一角色的已批准正面游戏素材，复制身份、发髻、服饰、配色与比例。
  2. `scripts/assets/beast_cut.png` — 同游戏已批准的水墨风 peer 素材，只参考笔触、描边和画布占位。
- 提示词：`others/asset_v25/spec_back/prompt.txt`
- 规格：`others/asset_v25/spec_back/spec.json`
- 成本提示：图像工具报告单张约 5–10 积分；本次共生成 4 张候选（1 张初版 + 3 张飞剑朝向修正），最终采用第 4 张。
- 飞剑朝向修正过程：
  1. `raw/Create_exactly_ONE_square_imag_2026-11-18T02-23-44.png`：初版，脚下飞剑斜跨画面，用户指出朝向错误。
  2. `raw2/Edit_the_attached_image__keepi_2026-11-18T02-30-33.png`：局部编辑失败，飞剑仍斜向。
  3. `raw3/Create_exactly_ONE_square_1024_2026-11-18T02-31-21.png`：重新生成后飞剑竖直但剑尖朝下（朝镜头），仍与角色朝向相反。
  4. `raw4/Edit_ONLY_the_flying_sword_und_2026-11-18T02-32-07.png`：**最终采用**；脚下飞剑剑尖朝画面上方/场景深处，与角色背向一致，剑柄在脚下。

## 后处理

- `scripts/09_prepare_sword_back.js`：清掉生成图右下角工具水印（x≥845, y≥935，仅背景区域），再做绿幕抠图与边缘溢色抑制。
- 游戏实际加载：`scripts/assets/sword_immortal_back_cut.png`（保留原始 1024×1024 构图，与正面素材显示尺度一致）。
- 清水印绿幕源图：`others/asset_v25/back_clean_green.png`。
- 素材审批产物：`others/asset_v25/master_back/`（master.png / master_rgba.png / master.json）。

## QA 观察

- 目视确认：脸部不可见，发髻、玉簪、青白长袍、腰带玉佩、飞剑与青色剑气均延续；无裁切、无水印、无文字。
- 自研抠图最终结果（raw4）：`watermark cleared 1.52%, green keyed 74.96%, softened 2.41%`。角色与飞剑完整，右下水印消失，脚下飞剑剑尖朝上且强烈透视缩短。
- `master_still.py approve` 报告（逐字保留）：
  ```text
  warning: 8.3% of the subject's colours lean to the key #00FF00 (more than 0.5%): check that those parts survive keying; for purple or pink designs use --key green or blue
  ```
- 决策：`master_rgba.png` 的青色剑气/衣摆绿色溢色比自研抠图更明显，且 `master_back/` 基于第 1 张初版（飞剑斜向），因此仅作早期参数留档；游戏内采用 raw4 经 `scripts/09_prepare_sword_back.js` 输出的 `_cut.png`。

## 已知限制

- 仍是静态 master still，没有背视角动作帧；当前 MVP 只需要第三人称跟随静态显示，够用。
- 后续若要转身/侧身动作，需另出 side/front 面向 master 或走动画流程，不要拿这张背视图硬翻转。

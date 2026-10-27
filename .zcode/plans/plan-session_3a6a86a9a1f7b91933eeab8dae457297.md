# 方案：修复 ICO 朝向 + 纸飞机品牌图标全套落地 + 打包提速

## 背景与已确认事实（含上轮结论修正）

- **朝向问题定位（本轮修正）**：你截图红框指向的 `icon.ico` / `icon_installer.ico` 确实是**上下颠倒**的。根因是我重建 ICO 时的 GDI+ 行序问题：`Image.FromFile` 加载的位图与 `new Bitmap` 新建位图的 `LockBits` 行序不一致，原样写进自底向上的 DIB 条目就整体垂直翻转。影响面：**Windows 任务栏、托盘（tray_icon.ico）、安装器图标全是反的**；`icon.png`/`icon_windows.png`/`icon_installer.png`/`icons/*.png` 是品牌包字节副本，**未翻转、正确**（已 Read 原图核实）；`icon.icns`/`icon_installer.icns` 是 kit `macos.icns` 字节副本，待核验。我上轮"磁盘文件没翻"的结论只验证了 PNG 就外推，是错的。
- 纸飞机迁移只完成一半：UI 内联 SVG、`public/` 图标集、Web favicon 共 20+ 处仍是旧 Z 标；`packages/web/test/webRemoteControlBootstrapShell.test.ts:43-46` 的 favicon 一致性断言当前是红的。
- 计划模式前已完成未提交：`App.tsx`/`ZCodeAppLogo.tsx` 改引 `app-logo-dark.svg`、`electron-builder.config.js`（beforePack 清理 out/ + `ZCODE_SKIP_ASAR_SOURCEMAP_CLEANUP` 开关 + 缺失模块日志 + 注入目录即时清理）、`bundle.mjs`（环境变量文档）。分别并入提交 2、3。

---

## 一、Phase 0：修复 ICO 朝向（最优先）

1. 用品牌包 `app-dark-{16,24,32,48,64,128,256}.png` 重建 `packages/desktop/build/icon.ico` 与 `icon_installer.ico`：条目像素**行序修正**（对 GDI+ 位图先 `RotateFlip(RotateNoneFlipY)` 再 LockBits，或等价地反转行拷贝），仍为 classic 32bpp BGRA BMP 条目（NSIS 不读 PNG 压缩条目）。
2. 重铸后**逐条目像素级回验**：解出每个条目与 kit 对应尺寸 PNG 比对，必须与**未翻转版**完全一致（同时断言与翻转版不一致），杜绝再翻。
3. 核验 `icon.icns`/`icon_installer.icns`：解出最大尺寸条目与 `app-dark-1024.png` 像素比对；若字节副本确实未翻则不动。
4. 全量一致性表：`build/` 每个资产 → md5/像素关系 → 朝向结论，作为提交 1 的描述。

## 二、图标全套替换（其余槽位）

### A. UI 内联旧 Z SVG（7 处 → 统一图形源）

新增唯一图形源 `packages/ui/src/assets/provider-icons/app-logo-dark.svg`（品牌包 app-dark.svg 原样），TSX 组件统一 import，消除内联漂移：

| 文件 | 槽位 |
|---|---|
| `packages/ui/src/root/RootStartupLoading.tsx:28-50,54-89` | `ZCodeStartupLogo`/`ZCodeStartupLogoBadge`（**桌面标题栏 + 启动 loading 实际渲染处**） |
| `packages/ui/src/components/ui/ZCodeAboutLogo.tsx:3-25` | `ZCodeAboutLogo`（欢迎页/登录页/分享卡） |
| `packages/ui/src/components/ui/ZCodeAboutLogo.tsx:27-70` | `ZCodeWordmarkLogo` → kit `logo/wordmark-*.svg` |
| `packages/ui/src/components/.../WindowsTopLeftLogo.tsx:28` | 设置页左上 `data-testid="settings-logo"` |
| `packages/ui/src/assets/Z.svg` | 对话空态发光 Z 图形 |
| `packages/desktop/src/renderer/index.html:110-133` | Electron 首屏 startup logo（内联 path 替换） |
| `packages/desktop/src/main/aboutWindow.ts:179-190` | mac 关于窗自绘面板（内联替换） |
| `packages/web/index.html:212-230` | Web 远控启动壳内联 Z SVG（内联替换） |

随组件替换自动生效：`WelcomeScreen.tsx:484`、`OnboardingWelcomeView.tsx:25`、`OccupationOnboardingVisual.tsx:54`、`HighspeedShareNoticeCard.tsx:78`、`WebLoginPage.tsx:21`、`webRemoteControlBrand.tsx:7`。`App.tsx:1282 → DesktopTopOverlay.tsx:70` 的 `appLogoUrl` 保持现状（标题栏实际由 `ZCodeStartupLogo` 渲染，已在列表）。

### B. `public/` 静态图标集 + Web favicon（修掉红测试）

| 文件 | 动作 |
|---|---|
| `public/logo/icons/{16…512}x*.png` + `1024x1024.png` | ← kit `app-dark-*.png` |
| `public/logo/icons/icon.ico` | 用**修正后的同一重建流程**（与 `build/icon.ico` 字节一致，测试断言两者相同） |
| `public/logo/icons/icon.icns` | ← kit `macos.icns` |
| `public/icon_512@2x.png` | ← `app-dark-512.png`（`UpdateStatusDialog.tsx:16,108`） |
| `packages/web/public/favicon.ico` | 同一重建流程（先读 `webRemoteControlBootstrapShell.test.ts:38-46` 确认断言细节再对齐） |
| `packages/web/index.html:8-11` favicon data URL | ← 新 32px PNG 的 base64 |
| `README.md:4`/`README.en.md:4` | 引用 `public/logo/icons/1024x1024.png`，随 B 自动生效 |

### C. 登记与文档

- `model-provider-logo-sources.json`：Z.AI 图标来源登记指向已被覆盖的 `build/icons/128x128.png` → 改注"旧 ZCode 应用图标冻结副本"；**provider 图标文件不动**（供应商品牌）。
- `docs/web-remote-control/relay-v2-pairing.md:412`：页头 logo 描述过期 → 修正。
- `dmg_background.png`(@2x)：**不在本次范围**（需重新排版设计）。

## 三、打包精简（P0+P1，发布安全语义不变）

实测 win-x64 完整打包 16-18 min：prepare 双跑 ~3 min、afterPack 两次全量 asar 解包重打 ~10 min（inject 337-415s + sourcemap 267-375s）、vite ~62s（大机器两次 OOM）、agent-bundle 146-182s 无缓存。

1. **P0-1 消除 prepare 双跑**：`bundle.mjs` 显式调 `prepare:runtime-assets` 后 `pnpm build` 内部又跑一遍 → 显式调用后改调 `build:no-runtime-assets`。省 ~3 min。
2. **P0-2 合并 asar 周期**：afterPack 内把 inject 与 sourcemap 清理合并为**一次 extract →（copy 缺失模块 + 全 staging strip sourceMappingURL + 删 .map）→ 一次 pack**；保留 skip 语义（missing=0 早退；`ZCODE_SKIP_ASAR_SOURCEMAP_CLEANUP=1` 跳过 asar 部分只做 resources）。省 ~4-5 min。
3. **P1-1 vite OOM 加固**：`run-production-build.mjs` 给 vite 子进程注入 `NODE_OPTIONS=--max-old-space-size=8192`（与 `scripts/build-desktop-agent-cli.mjs:8` 同款）。
4. **P1-2 agent-bundle turbo 缓存**：`prepare:agent-node-bundle.mjs` 默认 `ZCODE_DESKTOP_AGENT_BUILD_MODE=turbo`，未命中自动回退。热缓存省 ~2.5 min。
5. 保留并文档化已有开关：`--skip-prepare/--skip-build`、`ZCODE_SKIP_ASAR_SOURCEMAP_CLEANUP=1`（仅本地迭代）。

**预期：win-x64 完整打包 16-18 min → 9-11 min。**

## 四、执行顺序与提交拆分

1. **提交 1** `fix(desktop): rebuild win ICOs with correct row order`：修正 `icon.ico`/`icon_installer.ico` 朝向 + 逐条目像素回验 + 核验表（含 icns 核验结论）。
2. **提交 2** `feat(ui): replace remaining Z marks with paper-plane brand`：A 节 7 处 UI 槽位（唯一 SVG 源 + 接线，含此前未提交的 App.tsx/ZCodeAppLogo 改动）+ B 节 public/ 与 web favicon + favicon 测试转绿 + C 节登记/文档。
3. **提交 3** `perf(build): cut packaging time via dedupe and merged asar cycles`：P0-1、P0-2、P1-1、P1-2 + 归并此前未提交的 electron-builder.config.js/bundle.mjs 改动。
4. **验证**：`pnpm typecheck`、`pnpm lint`、相关单测（`providerModelMetadataDialog`、`webRemoteControlBootstrapShell`、`providerLogoAssets`、`updateStatusButton`、`contract.test`）、`pnpm architecture:check --changed`。
5. **打包安装**：`ZCODE_ENV=production pnpm bundle:desktop -- --os win --arch x64 --skip-prepare`（renderer 需重建；不带 SKIP_ASAR 保发布网关；renderer 构建沿用 sourcemap 临时关闭 + 还原的 OOM 规避）→ 静默覆盖安装 → **重启后重点核对任务栏、托盘、安装器图标方向**（这正是之前反的三个地方），另截图验证标题栏、设置页左上、关于窗、Web 登录页 favicon。
6. **推送** origin/main。

## 风险与边界

- ICO 重建的最大风险就是行序：本次采用"先 RotateFlip 再 LockBits"并在重铸后**逐条目双向像素断言**（等于未翻转版、不等于翻转版），把上轮的坑堵死。
- 不做无依据的设计翻转：品牌设计本身保持 kit 原方向（鼻头朝右上，`icons/` 套装源即基准）；只修 ICO 与基准不一致的问题。
- wordmark/lockup 文字不翻转；DMG 背景、provider 图标不动。
- P0-2 合并后 asar 只重打一次；asar integrity 计算早于 afterPack 的既有顺序不变。
- turbo 缓存若引入不确定问题可单独回退，不影响其余项。
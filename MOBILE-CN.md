# Solar Atlas 移动应用

Solar Atlas 已包含 Android 与 iOS 的 **Capacitor 8 本地应用壳工程**。它们是可构建的源码工程，不是已经发布的商店产品。CI 可以生成由标准一次性 debug key 签名的 Android debug APK，但本仓库不宣称已有发布签名的 APK、AAB 或 IPA，不宣称已上架 Play Store / App Store、已进入 TestFlight，也不宣称已经完成真机验证。

[English](./MOBILE.md) · [隐私说明](./PRIVACY-CN.md) · [中文 README](./README-CN.md)

## 当前契约

| 项目 | 当前实现 |
| --- | --- |
| 运行时 | Capacitor 8，封装本地构建的 Web 应用 |
| 应用 ID | `io.github.dajiaohuang.solaratlas` |
| Node.js | 22+；npm 10+ |
| Android | 最低 API 24；编译与目标 API 36 |
| iOS | 16.4 及以上 |
| 核心体验 | 安装后，内置天体、预设、故事、Evidence 与本地应用壳可离线使用 |
| 目录数据 | 启动时检查版本/来源元数据；样本、索引和分片按需通过 HTTPS 从 `https://dajiaohuang.github.io/solar/data/asteroids` 加载 |
| 物理星历 | 原生默认完整配置：510 个 SHA 固定的 SPK 文件（1094.7 MiB），离线可用、按需加载。网页和原生共享 type 2/3/17/21 求值与显式来源中心组合。完整包新增卫星覆盖 2020–2031 TDB；Pages 不删目标身份，但将较大卫星文件缩短为 2026–2027。测试在 UTC JD 2461287.5 解析 508 个可选中心，并非所有星体。Eris/Haumea 主星中心及其卫星止于 2030-01-02 TDB，Makemake 保留近似回退。UTC→TT→TDB 从 1972 年起可用；未来闰秒不确定。 |
| 发布状态 | 仅提供源码和非发布验证路径；未授权、未包含发布签名与商店发布 |

Quaoar/Weywot、Orcus/Vanth、Salacia/Actaea、1998 WW31/Sat1、2001 QW322/Sat1、
Kagara/Haunu、1999 OJ4/Sat1、2003 UN284/Sat1
八组系统在原生完整配置中保留十年原始记录（2020-01-01 至 2030-01-01 TDB）；
Pages 的对应窗口为 2026-07-01 至 2027-01-01。新增主星和伴星均不编造回退轨道。

原生构建使用相对路径本地资源，并且不会注册 Web 端 Service Worker。原生离线能力来自已安装的本地应用壳，而不是 PWA 缓存。完整 MPCORB 目录有意不打包进应用：目录样本、详情分片与实时 JPL SBDB 查询需要网络；WebView 可能保留已经取回的响应，但这不构成完整离线保证。

如果内核资源实际随包提供，SPK 焦点星历及几何/光时/恒星光行差观测读数会遵循相同 manifest。它们不会使应用成为覆盖所有天体的高精度或导航产品；不包含引力偏折、大气、地表观测者或协方差模型，GPU 目录点云仍使用开普勒模型。

[全天体来源清单](./docs/all-body-inventory.md)是显式开发审计产物，不是已经安装的移动目录。原生同步不会下载或复制这些生成分片，当前离线与在线边界不变；清单覆盖和移动端可用星历覆盖必须分别报告。

## 前置条件

共享 Web 应用壳包含卫星尺度的 3D 取景、竖屏尺寸变化处理及千米/小时轨道读数。修改这些共享功能后，运行 `npm run mobile:sync` 刷新两个平台的资源，并验证 Android/iOS CI。浏览器视口测试不能替代真机触控、旋转与性能测试。

安装 Node.js 22+、npm 10+ 与对应平台工具链：

- Android：Android Studio、Android SDK API 36 与 JDK 21。工具链齐备时可在 Windows、macOS 或 Linux 构建 Android。
- iOS：必须使用 macOS 与 Xcode。Windows 无法构建、运行、签名或归档 iOS 应用。

签名密钥、证书、描述文件、商店凭证或发布账号都不应进入仓库。

生成的 iOS 包依赖图将 Capacitor 固定为 8.5.0，并将 `ion-ios-filesystem` 固定为已经通过 Xcode 验证的 1.1.2。每次 Capacitor 同步后，规范化脚本都会重新应用路径与版本固定，确保全新检出解析到相同的原生依赖版本。

## 构建与同步

先构建原生本地应用壳：

```bash
npm ci
npm run build:native
```

Android：

```bash
npm run mobile:sync:android
npm run mobile:open:android
```

也可在 `android/` 目录运行本地验证任务：

```powershell
.\gradlew.bat lint testDebugUnitTest assembleDebug
```

在 macOS 上构建 iOS：

```bash
npm run mobile:sync:ios
npm run mobile:open:ios
```

`npm run mobile:sync` 会同步两个平台，因此应在同时具备两套工具链的 macOS 环境使用。这些命令只会生成或刷新本地平台构建，不会生成已签名的商店发布包。

移动端工作流配置为生成**由 Gradle 标准一次性 debug key 签名的 Android debug APK**和**无签名 iOS 模拟器应用**，作为短期验证产物；两者都不是发布产物。仅仅存在工作流配置不代表某个提交已经通过；仍须检查实际运行结果和产物。

## 原生行为

- 应用分享的场景链接使用公开的规范 HTTPS 地址，离开原生应用壳后仍可打开。
- 自定义 `solaratlas://scene?...` URL scheme 可在已安装应用内打开场景。目前不宣称已配置或验证 Android App Links 与 iOS Universal Links。
- 用户主动分享场景或导出时使用系统分享面板。导出文件先写入应用缓存，分享后会尝试删除。
- 普通外部 HTTPS 链接在系统浏览器中打开。
- 应用进入后台时暂停正在运行的模拟；只有先前正在播放时，回到前台才恢复。
- Android 返回键先关闭教程或当前应用内浮层，再返回应用/浏览历史，最后最小化应用。
- 界面支持横竖屏、安全区、触控、自适应 3D 渲染，以及 WebGL 创建或上下文恢复失败时自动回退 2D。

## 权限与隐私

Android 仅声明通过 `INTERNET` 访问网络，并关闭明文流量和应用备份。iOS 工程没有相机、麦克风、位置、通讯录、照片、跟踪或通知权限请求；其隐私清单声明不收集数据，并为本地导出路径使用的文件时间戳 API 记录了 required-reason 声明。

当前源码级隐私说明见 [PRIVACY-CN.md](./PRIVACY-CN.md)。发布前必须针对最终签名包、实际依赖和商店配置重新核对商店隐私标签。

## 验收清单

在把移动版本称为完成发布前，应在有代表性的真机及模拟器上验证：

- 首次教程选择、直接进入综合观测台、安全区、状态栏对比度、旋转、键盘/辅助功能服务与减少动态效果；
- 触控相机、选择、抽屉、四项导航、3D/2D 切换、WebGL 上下文丢失及内存压力恢复；
- 安装后的核心离线启动，以及目录/JPL 请求不可用时真实明确的失败与重试状态；
- 自定义 scheme 场景导入、规范 HTTPS 分享、JSON/CSV/图片导出、外部浏览器跳转、生命周期暂停/恢复与 Android 返回键；
- Android API 24 与 36，以及 iOS 16.4 和当前 iOS 版本；
- 最终二进制对应的隐私清单、权限、签名身份、图标、截图、商店元数据、无障碍声明、数据安全与隐私问卷。

目前没有证据表明以上真机清单已经完成。在证据和商店记录存在前，不得把移动应用描述为已经上架或通过真机验证。

## 发布边界

签名、公证、TestFlight、Play 测试轨道、商店提交、付费开发者账号、生产证书、发布密钥与正式上架都属于外部状态变更，需要仓库所有者明确授权，并使用受控凭证。当前实现止步于这些操作之前。

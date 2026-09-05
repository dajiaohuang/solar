# Solar Atlas 原生应用

> Android 与 iOS 是独立的平台原生项目。当前原生范围只是“精确当前位置状态瓦片”的第一竖切，不是完整功能或商店发布里程碑。没有 Capacitor Web 壳，原生构建也不打包 SPK 文件。

[English](./MOBILE.md) · [隐私说明](./PRIVACY-CN.md) · [主 README](./README-CN.md)

## 当前契约

| 项目 | 当前契约 |
| --- | --- |
| 运行时 | 独立 Android/iOS 原生前端，共用版本化后端协议 |
| 原生竖切 | `manifest → plan → 二进制状态瓦片`，精确当前位置，状态值保持 typed `Float64` |
| 视图 | 原生 3D 默认，原生 2D 为独立视图/回退；2D/3D 预算分开 |
| iOS 输入 | 用户填写 HTTPS 后端、TDB 儒略日、预设、自定义天体 ID 与参考 ID |
| iOS 缓存 | 已验证状态瓦片使用有界 256 MiB 缓存；只有瓦片身份与哈希匹配时才复用 |
| 在线边界 | 首次加载 manifest 与 plan 必须访问 HTTPS 后端；已验证瓦片可复用，但尚未实现完整离线 plan 恢复 |
| Pages | 仅为精选 Web 预览，不是原生完整版状态后端 |
| 验证 / 发布状态 | Android 于 2026-09-05 取得本地真实 SPK HTTPS 模拟器交互/缓存证据；Android/iOS CI 构建及跨运行时协议检查通过，iOS 还通过下方真实 SPK HTTPS 模拟器测试。新增 Android 运行 CI 门禁仍需其对应成功记录；真机性能和商店发布仍未验证 |

原生竖切保留科学来源、历元、单位、参考系、有效区间和缺失状态语义。缺少精确状态时保持明确不可用，不用近似位置替代。当前不声称全天体覆盖、导航精度、完整星历访问或完整 Web 功能对等。

## 前置条件与检查

2026-09-05，提交 `9461362762a9f0366abea6b665554c6dc6c9bf47` 的 [macOS iOS 作业](https://github.com/dajiaohuang/solar/actions/runs/33943036884/job/101244140251) 通过 Go→Swift 基准、异常载荷/缓存/取消/投影测试，以及 Xcode 26.6 的 arm64/x86_64 未签名模拟器构建。[Android 作业](https://github.com/dajiaohuang/solar/actions/runs/33943036884/job/101244140351) 通过构建及 Java 基准检查。这是该提交的历史作业证据，不代表后续检出或整个 PR 全绿；两个作业均未启动模拟器，也未验证原生实时 HTTPS 渲染。

提交 `d4f622495be549e8a29ba228d230fcd92d46086d` 的[真实 SPK iOS 运行作业](https://github.com/dajiaohuang/solar/actions/runs/33945353295/job/101250378243) 通过两个 XCTest 用例，零失败（50.448 秒）。保留报告记录地球/月球/太阳三个已验证状态、明确缺失 ID 的基准、模式切换、缓存复用及后台恢复；HTTPS 清单为两次 manifest、两次 plan 和一次 tile，均为 HTTP 200，重载复用了已验证瓦片。这只证明被测模拟器竖切，不证明真机性能、全天体覆盖或完整离线运行。

仓库检查使用 Node.js 22+ 与 npm 10+。`npm run native:check` 是原生项目静态检查，不构建或签名应用。

Android 在原生项目中直接使用 Android SDK API 36 与 JDK 21：

```text
android/gradlew -p android lint testDebugUnitTest assembleDebug
```

Windows 使用 `android/gradlew.bat -p android` 执行相同任务。iOS 需要 macOS 与 Xcode：

```text
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -configuration Debug CODE_SIGNING_ALLOWED=NO build
swiftc ios/App/App/StateTileDecoder.swift ios/App/App/StateTileCache.swift ios/App/App/NativeStateProjection.swift ios/ProtocolTests/ProtocolTests.swift -o <temporary-output>
<temporary-output>
```

这些是贡献者命令，不是本检出已通过的证据。仓库不保存签名密钥、证书、配置文件、商店凭据或发布账户。真机行为、可访问性、内存压力和商店资料需要单独证据，当前不声称已完成。

## 原生行为与边界

### 跨运行时数值验证

移动端 CI 通过实际 Go 目录与 HTTP handler 生成二进制瓦片，再分别使用生产
Web 解码器和对应的 Java 或 Swift 解码器读取同一批文件，比较六个 Float64
分量的位模式、瓦片哈希、行顺序、清单身份及 exact/missing 数量。第一项检查使用的
SPK 明确为合成测试数据：它证明协议互通，不证明天文精度或原生实时网络链路。

默认合成基准覆盖四条请求路径：目录中的可计算目标、来源目录中的可计算别名、
来源目录的审计历元快照，以及未知 ID。前两者即使遇到 `[0,0]` 的目录摘要有效期，
也必须保留实际选中 SPK 段的有效区间；快照只在审计 ET 500 有效，不能扩展到
更宽的证据区间。生成器在发布基准前拒绝超出有效期的精确状态、近似或矛盾的
状态位、非有限数值和非零的缺失状态。这些路径复用现有三端解码检查，不代表
新增真实天体覆盖，也不证明物理精度。

iOS 工作流还在 macOS 上执行 `node scripts/ios-native-smoke.mjs`。运行门禁
会校验并暂存真实完整版 SPK，在 Go、Web、Swift 间验证地球/月球/太阳与一个
缺失 ID 的基准，并通过 XCTest 启动原生 App，连接本机回环 HTTPS Go 后端。
覆盖预设加载、3D/2D 投影数量、在线重载与已校验瓦片缓存复用、后台恢复、教程
及未配置后端的提示。测试创建独立模拟器，只向该设备加入临时 CA，保持生产
TLS 校验开启；结束后移除本次创建的设备，校验临时目录的真实路径后清理，私钥
不上传为产物。从仓库
根目录运行，需要 Node、Go、OpenSSL、Xcode 及已安装的 iPhone 模拟器运行时。

结果、HTTPS 请求计数、日志与包含截图的 XCTest 结果保存在
`build/ios-native-smoke/` 和对应 CI 产物中，不覆盖旧结果。该门禁已在上方链接的
运行测试提交通过；后续提交仍需各自成功的运行证据。它不代表真机帧率、完整
离线能力或原生全功能对等。历史证据仍只对应其原提交。

本地复现时，将 `SOLAR_STATE_TILE_FIXTURE_DIR` 设置为仓库外新的或空的绝对目录
（PowerShell 使用 `$env:SOLAR_STATE_TILE_FIXTURE_DIR`，POSIX shell 使用
`export SOLAR_STATE_TILE_FIXTURE_DIR=...`），然后运行：

```text
go run ./cmd/state-tile-fixture -out <fixture-directory> -tile-size 1
npx vitest run tests/unit/state-tiles-golden.test.ts
```

执行上面的 Gradle 或 Swift 测试命令时保留该环境变量。配置了不存在的目录会
报错；未配置时跳过可选跨运行时测试。Gradle 将该目录计入测试输入，从合成数据
切换到真实数据时会重新测试。生成器还支持 `-data-dir`、`-inventory-dir`、
`-ids` 和 `-epoch-jd`，可读取本地保留且已校验哈希的科学数据配置。不得提交
生成的测试数据，也不能将序列化一致性当作独立科学基准。

### Android 真实数据运行验证

`node scripts/android-native-smoke.mjs` 校验并暂存真实完整版 SPK，先执行
Go→Web/Java Float64 基准，再通过 HTTPS 操作实际 Android 界面。2026-09-05
本地 API 36 x86_64 测试通过地球参考系下的地球/月球/太阳与明确缺失 ID、
3D/2D 数量、可见天体像素、教程及系统导航安全边界、后台恢复与缓存重载。
两次 manifest、两次 plan、一次 tile 均为 HTTP 200，证明重载复用了缓存。
像素检查不代表重叠天体各占独立像素、所有相机距离下尺寸不变、真机性能或全功能对等。

将 `ANDROID_HOME` 指向含命令行工具、模拟器及
`system-images;android-36;default;x86_64` 的 SDK，`JAVA_HOME` 指向 JDK 21。
需要 Go、Node 和 OpenSSL（可用 `SOLAR_OPENSSL` 指定可执行文件路径）。脚本
只创建独立临时 AVD，通过回环端口转发连接后端。只有 instrumentation 测试进程
信任临时 CA，生产 TLS 与主机名校验保持开启，不向主机或设备全局加入根证书。
只在一次性测试设备禁用动画，因此这不是帧率基准。清理前验证临时资源归属。

默认产物目录是 `build/android-native-smoke/`，再次本地运行可用
`SOLAR_ANDROID_SMOKE_OUTPUT` 指定新目录，不覆盖旧证据。`report.json` 记录
源码提交/文件哈希、科学清单/基准身份、HTTPS 请求及清理错误；保留截图与日志，
不保存私钥。本地通过不代表后续提交的托管 CI 已通过，必须核对对应 Android 运行作业。

### 交互与数据边界

- 第一屏是当前位置 Observation Deck：选定 ID、精确状态、来源证据和明确缺口。
- iOS 默认原生 3D，可切换原生 2D。2D/3D 预算独立；原生 3D 不因距离单独缩小或淡出状态。
- 请求绑定 manifest/plan 身份与有序 ID；瓦片有大小上限并校验哈希，只有完整 plan 验证后才原子发布。
- 取消与 latest-only 防止旧 plan 覆盖新选择。新 plan 在线确认瓦片身份后，可从 iOS 缓存复用已验证瓦片。
- 原生不注册或依赖 Web Service Worker、Capacitor bridge 或打包的 SPK 配置。SPK 源文件仍是科学/后端交付内容，不是原生离线下载。
- 即使瓦片已缓存，manifest 和 plan 仍需在线；尚无完整离线 plan/目录恢复路径。

## 隐私与分发

原生客户端没有项目账户、广告、分析、行为跟踪或遥测。iOS 状态瓦片服务只向用户选择的 HTTPS 地址发送后端地址、TDB 历元、自定义/预设 ID 和协议请求元数据。有界瓦片缓存是本地应用数据。详见[隐私说明](./PRIVACY-CN.md)与 [PRIVACY.md](./PRIVACY.md)。

Android 与 iOS 当前不是已发布、已签名、商店批准或真机验证的应用。签名、TestFlight、Play 测试轨道、商店提交和发布都需要单独授权与证据。

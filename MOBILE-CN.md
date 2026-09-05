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

Android 将当前位置直接组装进最终的一个 `double[]` 和一个 `boolean[]`，
不逐分量装箱为 `Double`，也不在末尾复制整块数值缓冲区。分配前先检查容量，
完整帧发布前检查瓦片身份、顺序、缺失标记与取消状态。1.5 GiB 组装预算估计
包含原生数值缓冲区、元数据引用及字符串/对象存储，但不是进程 RSS 上限：
HTTP 解析、缓存、渲染器与运行时仍需额外余量。两百万行输入上限不代表这些
状态均可用或可以流畅显示。Go 基准测试除了验证解码瓦片，还逐位核对最终
组装数组中的全部 Float64 数值。

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
swiftc ios/App/App/StateTileDecoder.swift ios/App/App/StateTileCache.swift ios/App/App/NativeStateProjection.swift ios/App/App/NativeCoverageReport.swift ios/ProtocolTests/ProtocolTests.swift -o <temporary-output>
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

### Android 全来源目录

Android 新增独立、默认收起的来源浏览区，使用完整版后端的 `/v1/identities`。
每次显式请求最多 50 条记录和 256 KiB 页面 JSON；来源总数不是去重天体数或
精确状态数。保留原始 ID、来源行及身份声明，不推断 NAIF 映射。分页游标绑定
后端、搜索条件和清单哈希。

使用本页会替换自定义 ID，但不会加载或绘制。检查参考天体和 TDB 时刻后再加载；
若选择中没有参考天体，加载时会补入。新的在线清单必须仍与所选页面一致，才会
请求状态计划。修改观测参数会清除旧观测；修改搜索条件或后端、收起、超时和
进入后台会取消目录请求并清空其显示结果。这不提供离线目录恢复，也不证明
每条来源记录都有精确状态。原生测试将 `/identity-fixture/` 的合成分页和
过期选择用例与真实 SPK 状态验证分开。iOS 来源浏览及完整三端功能一致性尚未完成。

2026-09-06 本地 API 36 模拟器已通过两页各 50 条合成记录、显式选择和目录清单
变化时在状态计划前拒绝请求的验证；5 次目录请求与真实 SPK 状态及缓存测试隔离。
报告中的 24 个实现及测试源码哈希均与受测文件一致，已检查来源面板截图。这次
合成用例不证明中文运行时界面或实体机性能。

另一次本地测试从固定的 1,567,193 条来源目录中，将前 50 个原始来源 ID 选入
原生看板。在 TDB JD 2461287.5 加入太阳参考后，共请求 51 条：10 个已验证状态、
41 个明确缺口。原生 2D 和 3D 均显示 10 个状态；5 次真实 HTTPS 请求验证页面、
原始选中 ID、清单、计划及瓦片，未使用合成响应。来源页 23,565 字节，状态瓦片
31,480 字节，25 个受测源码哈希一致。同一组 51 个 ID 的 Go 基准通过 Web 和
Java Float64 位级检查。这只证明该页的集成，不证明全目录精确覆盖、独立天文
精度、Swift 一致性或设备帧率。

复现额外的真实目录用例时，将 `SOLAR_ANDROID_INVENTORY_DIR` 指向已有、已审计
的可寻址目录，`SOLAR_ANDROID_INVENTORY_SHA256` 设为其 `manifest.json` 的 SHA-256，
然后使用上述 SDK/JDK/HTTPS 工具链及新的输出目录运行 `node scripts/android-native-smoke.mjs`。
本次目录哈希为 `bef21e3bc5820db0b70c24ad464262cb67df279f8d0a3e2b8731ca5ca9c39583`，
完整星历清单哈希为 `7e7fa1df8080b505abba52cc8ca9a4d8bd6d1c10d47d3e421953e7c1b8494257`。
不会从互联网获取原始数据归档、改写数据或打包进 App。两项目录输入均未设置时，报告明确将该额外用例
标为 `not-configured`；普通托管原生测试本身不证明真实来源目录选择。

### 按需来源覆盖审计

两端原生源码都包含默认收起的来源覆盖区域，与观测及预设分开；展开不下载数据。
点击加载/重载后，获取新的 HTTPS 目录 manifest 和 `/v1/coverage` 摘要（上限
64 KiB），严格绑定目录与 inventory 身份。展示来源/已映射/未解析记录、去重后的
显式目标、审计历元可用数量、依赖窗口数量、TDB 审计/窗口 ET、缺失原因和六项
来源哈希。同一天体的多个来源别名不增加去重目标数；依赖可用性不等于全窗口
数值精度认证。这些统计也不是当前显示的状态数量。

重载、修改地址、收起和生命周期取消都会清除旧统计。未配置报告（404）表示
不可用，不表示零覆盖；错误格式或身份不匹配的证据会被拒绝。新增覆盖文案支持
中英文，但不代表原生旧界面已全部本地化。

原生运行测试将真实 SPK 状态流程与 `/coverage-fixture/` 合成界面用例分开：
显式加载、新请求重载返回 404，以及不一致计数。两类请求分别验证，并在
`report.json` 中明确标记合成测试，不将其数量当作真实天体覆盖。Android 本地
覆盖界面流程已于 2026-09-05 通过；iOS 覆盖界面已在 `ef19141` 的
[CI 33965123890](https://github.com/dajiaohuang/solar/actions/runs/33965123890)
通过，同轮真实 SPK 状态流程及 Linux Go race 检查也已通过。Java/Swift 可选真实 Go 摘要校验使用
`SOLAR_COVERAGE_NATIVE_FIXTURE_DIR`，指向含配对 `manifest.json` 和 `summary.json`
的保留目录。配置后文件缺失或内容非法会报错；Gradle 将其作为测试输入跟踪。
来源数据保持在 Git 之外。

### 观测行为

iOS 点几何使用相等的屏幕空间上下限 4（此前为 2），材质为不透明恒定白色。
独立的 `NativePointGeometryTests` 类将生产几何源码编译进模拟器测试进程，
在 256/512/768 像素方形截图中，分别测量相机距离 16/160/1600 时的像素边界、
亮点数量、峰值及总亮度；移除固定上下限的透视反例必须实际缩小。
运行脚本同时要求测试成功和完整测量记录；截图保留于 `Observation.xcresult`，
指标保留于 `report.json` 的 `pointGeometry`。
这是合成渲染测试，不增加精确天体数量，也不验证 UIKit 屏幕缩放、交互相机裁剪、
帧率、温控或真机。[CI 33966101514](https://github.com/dajiaohuang/solar/actions/runs/33966101514)
已在 `13a51bf` 通过：九组固定点截图均为 4×4 像素边界、12 个亮像素、峰值 255、
总亮度 3060，不随距离变化；透视反例从 110×110 缩小至 2×2 像素。
此前 `ef19141` 不含此测试。
参见 Apple 的[屏幕空间上下限说明](https://developer.apple.com/documentation/scenekit/scngeometryelement/minimumpointscreenspaceradius)。

Android 当前状态现有独立动态显示策略：3D 从 10 万开始、候选上限 25 万；
2D 从 25 万开始、候选上限 50 万；两者均可降至 2.5 万。只在触摸交互期间连续
绘制 GLES，静止、隐藏或暂停时按需绘制。有界采样丢弃前两个热身间隔，随后
以至少 12 帧、约一秒的窗口采集 p50/p95 和估计错过的 60 Hz 帧槽（最多 120 帧）。
这是 GL 回调间隔，不是 GPU 计时或合成器实际呈现帧。连续两个慢窗口降低 25%，
严重卡顿一个窗口即降；四个快窗口才按约 12.5%、5000 点粒度增长，且已加载精确
行数必须实际达到当前预算。常规调整冷却五秒；API 29+ 严重温控或原生内存警告
直接降到 2.5 万，恢复后仍需新的余量证据。只重建当前模式缓冲，Float64 状态、
来源和缺口计数不变；截断顺序为参考天体优先、随后来源顺序，界面显示预算、
未显示精确状态数及调整原因。
最低预算下的重复内存警告仍重置冷却和升档证据。
七个策略/采样单测及缓冲测试使用合成输入；Android HTTPS 烟测还检查三个真实
状态的 GL 回调、交互绘制模式切换，以及经标准生命周期 API 注入的内存警告。
这些不证明 12 GB 真机流畅性、物理温控、总原生/GPU 内存或 60 秒目标负载验收。
iOS 已接入仅压力降载策略：3D 从 10 万、2D 从 25 万开始；温度稍高时
分别限制为 7.5 万／10 万，严重或临界温度、内存警告则都限制为 2.5 万。
冷却、重新加载及模式切换不会自动恢复高上限。仅缩减渲染坐标前缀，保留
全来源尺度、相机和 Float64 科学状态；参考天体缺失时保留精确目标计数，
显示零个点。进入后台取消投影任务并释放显示坐标，返回后按当前预算重新
投影保留的科学状态。这不限制总原生／GPU 内存，也不保证迟到的系统警告
能避免应用被终止。Swift 协议回归覆盖策略和不可变前缀；每次新提交仍须由
macOS CI 编译执行，并通过真实 SPK 界面测试。iOS 实际绘制间隔采样和自动
增长仍待完成。Web 已有独立的仅显示控制器，参见 [PERFORMANCE.md](./PERFORMANCE.md)；
均不代表完整内存／温控／延迟反馈或真机 SLO 验收。

- 第一屏是当前位置 Observation Deck：选定 ID、精确状态、来源证据和明确缺口。
- iOS 默认原生 3D，可切换原生 2D。2D/3D 预算独立；原生 3D 不因距离单独缩小或淡出状态。
- 请求绑定 manifest/plan 身份与有序 ID；瓦片有大小上限并校验哈希，只有完整 plan 验证后才原子发布。
- 取消与 latest-only 防止旧 plan 覆盖新选择。新 plan 在线确认瓦片身份后，可从 iOS 缓存复用已验证瓦片。
- 原生不注册或依赖 Web Service Worker、Capacitor bridge 或打包的 SPK 配置。SPK 源文件仍是科学/后端交付内容，不是原生离线下载。
- 即使瓦片已缓存，manifest 和 plan 仍需在线；尚无完整离线 plan/目录恢复路径。

## 隐私与分发

原生客户端没有项目账户、广告、分析、行为跟踪或遥测。iOS 状态瓦片服务只向用户选择的 HTTPS 地址发送后端地址、TDB 历元、自定义/预设 ID 和协议请求元数据。有界瓦片缓存是本地应用数据。详见[隐私说明](./PRIVACY-CN.md)与 [PRIVACY.md](./PRIVACY.md)。

Android 与 iOS 当前不是已发布、已签名、商店批准或真机验证的应用。签名、TestFlight、Play 测试轨道、商店提交和发布都需要单独授权与证据。

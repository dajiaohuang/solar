# Product direction / 产品定位

Owner-directed target, updated 2026-09-05. This document records the next architecture, not capabilities already shipped. / 用户确定的目标架构，2026-09-05 更新；本文不代表相关能力已经交付。

**Priority: maximize simultaneous scientifically valid computation and display.** Optimize all three frontends, the Go backend and storage together, using measured throughput, latency, peak memory, I/O and frame-time evidence. Old-client, old-API and old-scene compatibility are not acceptance requirements; do not add compatibility layers, duplicate catalogs or migration-only hosting. Data/source identities, checksums, precision and validity windows remain mandatory for reproducibility, not backward compatibility. Distinguish cataloged objects, objects with valid precise states, approximate display samples and currently rendered objects. Never replace unavailable precise states with approximations to inflate counts. / **优先级：尽量同时精确计算并展示更多天体。** 联合优化三个前端、Go 后端和存储，以实测吞吐、延迟、峰值内存、I/O 与帧时间验收。旧客户端、旧 API 和旧场景兼容不是验收要求；不增加兼容层、重复目录或仅用于迁移的数据托管。数据/来源身份、校验、精度和有效窗口仍是可复现性要求，不是旧版兼容。分别统计已收录对象、具有有效精确状态的对象、近似展示样本和当前渲染对象；不能为了数量用近似状态替代缺失的精确状态。

The shared backend will be implemented in **Go**, as a separately owned development workstream. Optimize using reproducible latency/throughput/memory benchmarks and profiling without relaxing scientific accuracy, source coverage or validation. Frontend work stays separate and coordinates through the versioned API contract. / 统一后端确定使用 **Go**，拆为独立开发任务。通过可复现的延迟、吞吐、内存基准与性能分析进行优化，不牺牲科学精度、来源覆盖或校验。前端任务独立推进，通过版本化 API 协议协作。

## Three clients, one backend / 三个前端、统一后端

Solar Atlas will have three independently buildable, testable and releasable frontend projects: **Web, Android and iOS**. They share the same backend and scientific data contracts, not one web interface wrapped for every platform. Start with separate projects in this repository; separate GitHub repositories are not required by this decision.

Solar Atlas 将建设 **Web、Android、iOS 三个可独立构建、测试和发布的前端项目**。三端使用同一后端和科学数据协议，而不是把同一个网页界面套壳作为最终形态。先在当前仓库内组织独立项目；本决定不要求拆成三个 GitHub 仓库。

| Project / 项目 | Target responsibility / 目标职责 |
| --- | --- |
| Web | Full browser workbench, keyboard/pointer workflows and responsive layouts / 完整浏览器工作台、键鼠操作与响应式布局 |
| Android | Independent platform-native UI, navigation, touch, lifecycle and local cache management / 独立的平台原生界面、导航、触摸、生命周期和本地缓存管理 |
| iOS | Independent platform-native UI, navigation, touch, lifecycle and local cache management / 独立的平台原生界面、导航、触摸、生命周期和本地缓存管理 |
| Shared backend / 统一后端 | Authoritative identity/catalog ingestion, provenance, ephemeris access, scientific calculations, versioned scene/data contracts and bounded delivery / 权威身份与目录接入、来源证据、星历访问、科学计算、版本化场景与数据协议、受控数据分发 |

Navigation and interaction may differ across clients; body identities, units, epochs/time scales, reference frames, source versions, validity windows and missing-data semantics must not. The backend owns the authoritative scientific result. Rendering, camera movement and explicitly validated interpolation remain client-side; the backend is not a per-frame rendering server. Cached/offline results must preserve their source, epoch, validity and version, with no silent precision upgrade.

三端可以有不同导航与交互，但天体身份、单位、历元/时间尺度、参考系、来源版本、有效区间和缺失数据语义必须一致。权威科学结果由后端统一提供；渲染、相机操作和经过明确验证的插值仍在客户端进行，不将每一帧交给后端渲染。离线缓存必须保留来源、历元、有效期与版本，不能悄悄提高精度声明。

Backend catalog queries must be paginated; trajectory requests must specify bounded body/time/sample limits; expensive jobs need cancellation and resource limits. Do not fetch the entire catalog or all kernels at launch. Full all-known-body coverage remains the data goal, not a promise to render every object simultaneously or to invent unavailable ephemerides. No N-body integration is introduced by this architecture.

后端目录查询必须分页；轨迹请求必须限定天体、时间和采样范围；重计算必须支持取消与资源限制。启动时不下载全目录或全部内核。数据目标仍是全部已知太阳系天体，不等于同时渲染所有对象，也不允许编造缺失星历。本架构不引入 N-body 积分。

## GitHub Pages is the preview / GitHub Pages 定位为预览版

`https://dajiaohuang.github.io/solar/` remains the public, no-account preview. It uses the **same Web frontend and navigation**, with a curated availability profile rather than a separate reduced UI. It is not a fourth full client or the mandatory data host for the other three clients. Demonstrate the core experience quickly without forcing backend/native coverage into the Pages package budget.

`https://dajiaohuang.github.io/solar/` 保留为无需账号的公开预览版，**使用相同的 Web 前端与导航，通过可用性配置开放精选内容**，不另做删减版界面。它不是第四个完整版前端，也不再是三端必须依赖的数据托管中心。目标是快速展示核心体验，而非让后端/移动端覆盖受 Pages 包体限制。

The preview must retain / 预览版必须保留：

- Immediate entry to the 3D Observation Deck, the preset list and the optional first-use tutorial; advanced controls stay collapsed / 直接进入 3D 综合看板、预设列表和可选初次教程；高级控制默认收起。
- A curated selection of major planets, the Earth–Moon system, representative planetary moons and small-body binaries, plus a bounded Mars–main-belt–Jupiter sample / 精选主要行星、地月系统、典型行星卫星和小天体双星，以及受控的火星—小行星带—木星样本。
- The strongest guided lessons, including reference-frame comparison and retrograde motion, with reproducible scenes / 最有代表性的参考系对比、逆行等引导课程及可复现场景。
- Clear source/model/time-window evidence, bilingual content, accessible interaction, device-adaptive rendering and explicit missing-state notices / 清晰的来源、模型与时间范围证据，双语、无障碍交互、自适应渲染和缺失状态提示。

Preview data should be a versioned, hash-verified static snapshot exported by the shared data pipeline so the core demonstration does not require a live backend. Large inventories, long-span high-resolution trajectories and heavy analyses belong to the full clients/backend. Publish a machine-readable preview availability manifest and visibly state what is included, sampled or unavailable.

预览数据应由统一数据管线输出为版本化、哈希校验的精选静态快照，使核心演示不依赖在线后端。大目录、长时段高分辨率轨迹和重分析由完整版与后端承担。发布机器可读的预览可用性清单，并明确标识已包含、抽样及不可用内容。

Full-version entries can remain visible in the same preset, object and tool lists, but unavailable items must not become selected or launch downloads/calculations. Label them **“Full version / 完整版”** and explain **“Not available in this preview; use the full version / 预览版暂不开放，请使用完整版”**. Provide an accessible explanation on keyboard focus and touch/activation, not only a mouse-hover tooltip. The prompt may open, but the restricted scientific action must not run. Distinguish this product limit from a genuinely missing ephemeris, failed network request or unsupported time range. No account or paid-tier requirement is implied.

预设、天体和工具列表可继续展示完整版入口；不可用内容不能被选中，也不能触发数据下载或计算。标注 **“完整版”**，明确提示 **“预览版暂不开放，请使用完整版”**。键盘聚焦与触屏操作均应能获得说明，不能只提供悬浮提示。允许打开说明，但不执行受限的科学操作。必须区分产品限制、真实星历缺失、网络失败与时间范围不支持；不暗示必须注册或付费。

Opening a supported full-only scene directly must show the same explanation, preserve the requested scene for a future handoff, and never silently substitute objects. Old scene-schema compatibility is not required. Connect full Web, Android or iOS actions only to verified available destinations; until then show an honest “not yet available” status rather than a fabricated URL. Availability controls must cover URL replay, search, presets, object selection and analysis actions consistently. Shared navigation does not justify bundling the full data or downloading unavailable assets.

直接打开当前支持格式的完整版专属场景时显示相同说明，保留原场景请求以便后续转交，不暗中替换天体；不要求兼容旧场景格式。完整 Web、Android、iOS 的入口只能连接已验证可用的地址；尚未上线时如实显示“暂未提供”，不编造网址。可用性控制必须一致覆盖链接回放、搜索、预设、天体选择和分析入口；共用界面不意味着打包全量数据或下载不可用内容。

## Migration and acceptance / 迁移与验收

**Current implementation:** React/Vite client-side Web plus independent native Android/iOS source prototypes. The full Web current-position and sampled-history paths consume the separately implemented [Go backend API](./backend-api-v1.md) through manifest, plan and binary state-tile requests when the deployer supplies `VITE_SOLAR_API_BASE_URL`; historical connecting lines are display interpolation with an explicit completed-window/source audit, not certified continuous ephemerides. Heavier analyses still use client-side SPK/physics, so the entire Web workbench is not yet unified behind Go. No official public full-Web backend URL is claimed. The native source is only a first vertical-slice prototype for exact current-state tiles: Android has local real-SPK HTTPS emulator UI/cache evidence for its GLES point renderer (see MOBILE.md), and iOS has passed macOS CI protocol/build checks and real-SPK HTTPS simulator smoke tests (physical-device and full-feature validation remain pending; see MOBILE.md). The current iOS slice accepts an HTTPS backend, TDB Julian date, preset/custom IDs and a reference ID, defaults to native 3D with an independent 2D view, and keeps a bounded 256 MiB verified-tile cache. Native manifest/plan loading remains online; complete offline plan recovery and full feature parity are not implemented. Pages uses the same Web frontend with its curated static profile when no backend is configured.

**当前实现：** React/Vite 纯前端 Web 与独立 Android/iOS 原生源码原型。完整版 Web 的当前位置与历史采样路径在部署方提供 `VITE_SOLAR_API_BASE_URL` 时，通过“清单、计划、二进制状态瓦片”接入独立开发的 [Go 后端 API](./backend-api-v1.md)；历史采样连线仅为显示插值，附带实际已完成窗口和来源审计，不代表连续星历精度认证。重分析仍使用客户端 SPK/物理计算，因此整个 Web 工作台尚未统一到 Go 后端；目前没有官方公开的完整版 Web 后端地址。原生源码当前只有精确当前位置瓦片的第一竖切原型：Android 的 GLES 点渲染器已通过本地真实 SPK HTTPS 模拟器交互/缓存测试（见 MOBILE-CN.md），iOS 已通过 macOS CI 协议/构建及真实 SPK HTTPS 模拟器冒烟（真机与完整功能仍待验证，证据见 MOBILE-CN.md）。当前 iOS 第一竖切可填写 HTTPS 后端、TDB 儒略日、预设/自定义 ID 与参考 ID，默认原生 3D 并提供独立 2D，使用有界 256 MiB 已验证瓦片缓存。原生 manifest/plan 仍需在线，尚未实现完整离线 plan 恢复或完整功能对等。未配置后端时，Pages 使用同一 Web 前端的精选静态配置。

1. Complete and retain the current source-backed satellite batch and its validation. Reuse its identities, scientific engine, fixtures and provenance in the migration; do not discard verified data work / 完成并保留当前权威卫星批次与验证；迁移复用身份、科学引擎、基准和来源证据，不丢弃已验证的数据工作。
2. Define the shared versioned API/scene contract and backend boundary. Separate the Web project and add backend catalog/state access with contract, error, resource-limit and independent scientific tests / 定义统一版本化 API/场景协议及后端边界，拆出 Web 项目并接入后端目录/状态服务，覆盖协议、错误、资源限制和独立科学测试。
3. Build the first independent Android/iOS vertical slice against that same contract: exact current-state tiles, Observation Deck evidence, platform-native 3D/2D presentation and cache/error handling. Full feature parity, complete offline plan recovery and release/device evidence remain later acceptance work / Android 与 iOS 先对接同一协议交付第一竖切：精确当前位置瓦片、综合看板证据、原生 3D/2D 展示及缓存/错误处理。完整功能对等、完整离线 plan 恢复和发布/真机证据留待后续验收。
4. Publish and verify the same-Web-frontend Pages profile separately from full Web and independent native validation; audit enabled entries, visible full-only entries, accessible explanations, blocked actions/downloads and direct-link handling / 将共用 Web 前端的 Pages 配置与完整 Web、独立原生验证分别发布验证，审计可用入口、可见完整版入口、无障碍说明、受限操作/下载拦截及直接链接处理。
5. Require the same scene/data version to produce matching scientific results across all three clients, independent client build/test jobs, real native interaction evidence, and rollback for the backend/data/preview migration / 验证三端同一场景与数据版本的科学结果一致、各自独立构建测试、原生交互证据及后端/数据/预览迁移回滚。

Keep related implementation, documentation and validation in coherent issues/PRs. Framework/library selection, production host/domain and operating costs require explicit implementation decisions; this document creates no paid resources, credentials, accounts or new dependency. Store signing/publication remains a separately authorized release step. Three folders or three copies of a WebView are not completion.

相关实现、文档和验证按完整任务合并到较大的 issue/PR。框架/依赖选型、生产主机/域名与运营成本需在实现时明确决定；本文不创建付费资源、凭据、账号或新依赖。商店签名/发布仍需单独授权。仅有三个目录或三份 WebView 不算完成。

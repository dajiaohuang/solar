# 计算与渲染容量审计及设备减负方案

审计日期：2026-10-03。基线：本地 `main`，`363e064`。范围：Web Explorer、目录 Worker、状态与分析计算、Go 服务、Android/iOS 原生点云。此次只保存报告和可复现的容量模型，不修改应用代码，不执行全量测试、发布或部署。

## 决策

先减少每次交互需要计算、搬运和绘制的数据，再提高准入容量。当前系统已经有需求渲染、背压、最新请求合并、分块流式加载和自适应绘制数量；主要剩余成本在于这些机制之间尚未统一：绘制降载没有同步降低目录历元计算，2D 相机变化仍触发 CPU 坐标转换，多个子系统分别拥有内存预算。

建议把目标定义为“百万至更多源数据可浏览，工作集受预算约束，选中目标和科学分析保持明确的精度与来源”。“全部源天体在每个显示帧精确重算并绘制”应作为独立的极限测试，不能作为普通手机的默认使用方式。

方案中的收益和验收阈值均为工程目标，尚未通过本轮设备测量证明。目录二体传播、SPK 精确状态、轨迹/积分分析属于不同计算路径，不能共用一个未经说明的精度承诺。

## 当前证据

### 执行的容量模型

通过 Vite 加载当前源码中的 `planExplorerCatalog` 和 `planCatalogStream`，读取当前活动目录 manifest。数据为 1,561,171 行、313 个分片、每片 5,000 行。脚本补入运行时加载器使用的 releasePath，再执行实际准入函数。

| 场景预算 | 可准入行数 | Worker 模型保留量 | 场景附加量 | 总模型保留量 |
| --- | ---: | ---: | ---: | ---: |
| 256 MiB | 370,990 | 182.41 MiB | 73.59 MiB | 256.00 MiB |
| 512 MiB | 1,094,983 | 294.79 MiB | 217.21 MiB | 512.00 MiB |
| 1,024 MiB | 1,561,171 | 355.31 MiB | 309.68 MiB | 664.99 MiB |

这是准入模型，不是浏览器 RSS、GPU 显存或手机内存峰值。它不证明 1 GiB 设备能安全加载完整目录，也不证明所有子系统并发时仍受同一预算约束。收据包含参与计算的三个源文件的 LF 归一化 SHA-256。

复现：在仓库根目录运行 `rtk node docs/benchmarks/capacity-audit-20261003/admission-model.mjs`。输出写入 `.cache/capacity-audit-20261003.json`；固定收据见 [admission-receipt.json](benchmarks/capacity-audit-20261003/admission-receipt.json)。

### 本轮检查与历史测量边界

本轮执行五个相关单元测试文件：explorer-catalog-session、catalog-streaming、render-budget、state-display-budget、catalog-temporal-budget，共 81 项，78 项通过、3 项失败。三个失败均在 `tests/unit/render-budget.test.ts`：严重卡顿立即降载后 streak 已清零，旧测试仍期待累计；另两项仍期待分屏数量按旧步长取整，当前实现保留实际加载数量。必须先核对并更新这些回归期望，不能把本次测试报告写成全绿。

已有 [2026-10-02 Explorer 收据](benchmarks/explorer-scene-20261002/explorer-capacity.json)使用 Chrome/ANGLE SwiftShader：完整源目录已计算，采样时绘制 280,000 行；3D 首次加载约 10.35 秒，暂停后的追平约 1.36 秒，2D 切换约 0.30 秒且未重新加载分片。该记录来自较早代码，RAF 间隔、自动化拾取耗时也不等于真实 GPU 完成时间或纯输入延迟。

已有 [2026-09-23 隔离 Worker 收据](benchmarks/catalog-worker-float64-chromium-20260923.json)记录完整目录传播中位数 281.6 ms，100 万行 178.9 ms，10 万行 17.9 ms。它说明单次全量传播的成本值得控制；它不是当前保留目录流水线的端到端基准，也不是独立 Float64 数值误差认证。

本轮没有新增真实设备 FPS、进程内存、GPU 时间、功耗或 30 分钟热稳态测量，也没有编译验证原生改动，因为尚未实施改动。

## 发现与影响

### 计算与数据所有权

1. **绘制数量下降，目录计算量仍可保持全量。** [explorerCatalogSession.ts](../src/lib/explorerCatalogSession.ts)请求 `maximumDriftAU: 0`，每个新历元仍需计算所有准入行；[ExplorerWorkspace.tsx](../src/features/explorer/ExplorerWorkspace.tsx)将绘制预算独立应用到结果。降低点数能减轻绘制，却不能直接消除传播成本。保留完整一致快照、单请求在途和背压是正确边界，不应通过混合不同历元的行来换取表面帧率。
2. **2D 投影有完整目录级同步工作。** [useExplorerCatalog.ts](../src/hooks/useExplorerCatalog.ts)从每个新 XYZ 快照生成 Float64 XY，包含主线程全量循环及分配。完整目录 XY 为 23.82 MiB；两份主线程 Float64 XYZ 为 71.46 MiB。Worker 中每行十个 Float64 传播系数另外占 119.11 MiB。缓存避免重复投影同一快照，但不消除每个新快照的工作。
3. **内存准入缺少覆盖所有子系统的共同账本。** 目录场景上限 1 GiB，浏览器 kernel 原始缓冲上限 768 MiB；Gaia 又有选中数据、在途块和缓存预算。这些不是同时实际占用量，路由也不一定共同挂载，但当前不能仅凭其中一项准入成功推断整页峰值安全。见 [catalogStreaming.ts](../src/lib/catalogStreaming.ts)、[kernelBufferBudget.ts](../src/engine/ephemeris/kernelBufferBudget.ts)、[gaiaCapacity.json](../src/data/gaiaCapacity.json)。
4. **后台生命周期仍有额外任务入口。** [useStateTiles.ts](../src/hooks/useStateTiles.ts)播放时以 500 ms 定时请求，没有显式 document.hidden 或视口可见性暂停。浏览器自身节流不等于产品取消无用任务。已有 [stateTileAdmission.ts](../src/lib/stateTileAdmission.ts)全局两席许可及优先级，不应再叠加一套相互竞争的调度器。
5. **科学分析应按算法复杂度减负。** 事件分析有最多 48 个目标及事件/细化预算；合相搜索存在目标对与采样数的乘积成本。非线性集合积分已有共享力评估上限。优先研究无漏检的保守宽阶段、独立样本并行和端点状态缓存；不能只提高这些上限，或把粗网格结果标作完整搜索。见 [eventAnalysisLimits.ts](../src/engine/events/eventAnalysisLimits.ts)及现有分析 Worker。

### Web 渲染与交互

1. **2D 相机操作仍会推动大量 CPU 转换和上传。** [trajectoryGeometry2d.ts](../src/lib/trajectoryGeometry2d.ts)在 CPU 把世界坐标映射到 clip 坐标，相机变化使点云位置缓存失效。应该让 GPU 通过相机 uniform 变换稳定的坐标缓冲，并直接读取 XYZ 的 stride 3，避免完整 XY 投影。近目标观察必须先在 Float64 中减参考原点，再转 Float32；必要时分块重定位或采用高低位拆分。
2. **3D 已经有前缀上传与紧凑颜色，仍有循环开销可优化。** [pointGeometry3d.ts](../src/lib/pointGeometry3d.ts)按可见数量上传、支持增量增长并使用 RGB8，不是无条件上传完整目录。但更新函数仍可能遍历全部 count 后逐行判断变化，可增加不变早退及从最早变化行开始更新。后续轨迹批处理和网格实例化应由 draw-call 测量决定。
3. **点数控制器尚未同时控制像素与展示频率。** [TrajectoryCanvas3D.tsx](../src/components/TrajectoryCanvas3D.tsx)开启抗锯齿，固定 high-performance 偏好；已有 DPR 上限与需求渲染，播放期间仍连续请求显示帧。[useAdaptiveRenderBudget.ts](../src/hooks/useAdaptiveRenderBudget.ts)依据 RAF 间隔调整点数，无法直接区分 GPU、解码、主线程和热压力。低功耗 30 fps 模式必须同时改变控制器目标帧周期，避免故意限帧被误判为卡顿。
4. **Explorer 应复用已有视域 LOD，而非只截取源序前缀。** [CatalogStreamCanvas.tsx](../src/components/CatalogStreamCanvas.tsx)路径已具备空间选择、屏幕代表点、密度覆盖和选中点固定。主场景应复用其选择逻辑。当前 [catalogSpatialIndex.ts](../src/lib/catalogSpatialIndex.ts)按连续源行构造 1,024 行块 AABB，并非空间排序；包围盒过宽可能降低剔除效率，具体比例需要测量。可建立保留源 ordinal 的 Morton/BVH 间接索引，不改科学数据顺序。
5. **首次拾取仍可能执行大量协作批次。** [cooperativeScreenPicker.ts](../src/lib/cooperativeScreenPicker.ts)每批 2,048 行、可取消、后续可复用索引，避免整段同步阻塞。百万显示行仍需约 489 批首次建索引；这不是实测毫秒数。优先让可见块上传同步维护拾取索引，或在 Worker 中查询空间候选；GPU ID 拾取必须避免同步读回造成新的停顿。

### 原生与服务端

1. **iOS 2D 为每个显示点构造并填充圆路径。** [NativeObservationDeck.swift](../ios/App/App/NativeObservationDeck.swift)的 Canvas 点循环逐点创建 ellipse 并 fill；当前 2D 初始/最大点预算为 250,000/500,000。这是明确的每点 CPU 工作，尚未测定其占帧比例。优先替换成 Metal 批量点绘制。iOS 已有热压力、内存警告与帧反馈策略；需要补齐 2D 路径的实际绘制反馈，而不是声称原生整体没有自适应机制。
2. **Android 点云使用客户端缓冲。** [NativeObservationDeck.java](../android/app/src/main/java/io/github/dajiaohuang/solaratlas/NativeObservationDeck.java)将 FloatBuffer 传给 `glVertexAttribPointer`，没有持久 VBO。可以按版本上传 VBO 并保留相机 uniform，验证驱动上传量；已有 WHENDIRTY 和手势期间连续渲染应保留。
3. **原生状态准入预算固定为 1,536 MiB。** 两端 StateTileService 都有这个上限，但不是进程 RSS 上限。绘制降载不会释放完整科学状态。需结合设备压力、缓存、解码在途与 GPU 缓冲制定共同预算；可以逐出可重建缓存和降低新加载准入，不应丢弃未持久化的科学证据。
4. **Go 服务已有公平调度和缓存，单批目标计算仍有串行空间。** [server.go](../internal/httpapi/server.go)、[scheduler.go](../internal/httpapi/scheduler.go)已有加权请求调度、GOMAXPROCS 计算许可和两席 tile 编码器；[evaluation_cache.go](../internal/catalog/evaluation_cache.go)已有 16 MiB 完成状态缓存与在途合并。目录 EvalBatch 的逐目标循环可研究按独立依赖组并行，但必须隔离临时求值状态，避免破坏父体依赖和优先级。不要简单增加所有并发数。
5. **服务端容量要与客户端工作集解耦。** 状态窗口有目标/历元/总状态数预算，目录页缓存有界，inventory 也有记录、posting 与块缓存上限。32,768 行是单状态计划限制，客户端已经分多个计划请求，不是整个选区的硬上限。更大目录应使用共享计算与分块查询，复用来源固定的不可变结果，而非把整个源索引与 SPK 都载入手机。

## 分阶段实施方案

工作量按熟悉代码的工程师估算，不包含设备等待、代码评审和发布排队；各阶段需独立验收。

| 顺序 | 工作与预计投入 | 预期价值 | 验收重点 |
| --- | --- | --- | --- |
| 1 | 统一资源账本、修正三个预算回归期望、补可见性暂停及低功耗模式，2–3 工程日 | 先减少无效任务，防止跨子系统峰值；建立可比较基线 | 恢复后只处理最新请求；30 fps 不触发错误降载；内存/上传/排队指标可归因 |
| 2 | 2D 相机 uniform、复用 XYZ、视觉缓冲所有权与分块上传，3–5 工程日 | 降低拖动和缩放时的 CPU/上传成本，缩短输入响应 | 相机操作不重建源点缓冲；参考原点减法仍在 Float64；可取消的上传批次 |
| 3 | 复用视域 LOD、改进空间索引、按屏幕误差预算刷新、拾取索引增量维护，5–8 工程日 | 降低历元刷新工作量，同时提高可浏览源数量 | 精确模式仍零漂移；选中点固定；源数/计算数/绘制数/代表数分别显示 |
| 4 | iOS Metal 点绘制、Android VBO、原生预算与缓存压力联动，5–10 工程日 | 消除原生每点路径与重复驱动传输，降低持续发热 | 真机 30 分钟热稳态、内存警告、后台恢复、GPU 上下文重建 |
| 5 | WebGPU 视觉剔除/间接绘制试验，共享服务端重计算与独立分析任务并行，10–15 工程日 | 进一步提高大目录与复杂分析上限 | 能力检测与回退；数值/来源一致；公平调度不退化；按实际成本决定是否采用 |

### 第 1 阶段：把设备负担变成共同预算

账本应区分科学常驻数据、显示缓冲、GPU 缓冲、缓存、解码/网络在途和临时峰值，按设备实测设定准入，不把 deviceMemory 或线程数当作精确物理内存。压力时先降低 DPR、展示频率和可重建缓存，再减少新任务准入，最后减少可见代表点；需要根据瓶颈调整顺序，而不是一律减点数。

DPR 从 1.5 降到 1.0，backbuffer 像素数理论减少 55.6%；这不等于总功耗或总 CPU 同比例下降。批量调用、减少 backbuffer 与避免同步 GPU 查询符合 [MDN WebGL 实践](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)。性能采样应使用异步 GPU 时间能力（可用时）、主线程长任务、上传字节、Worker 计算/等待时间和历元滞后，不在每帧加入同步 readback。

### 第 2–3 阶段：提高工作集效率

如果科学 Float64 权威状态留在 Worker/服务端，主线程两份 XYZ 显示快照改为 Float32 可节约 35.73 MiB；移除完整 XY 可再节约 23.82 MiB，合计理论缓冲差额 59.55 MiB。该值不是已测 RSS 收益；实现还可能需要块原点、索引和恢复缓冲。选中体、分析与导出必须查询科学权威数据，不能从显示缓冲反推精确坐标。

交互模式可选择 0.5–1 像素的显示误差目标，利用现有保守速度上界判断哪些块需要刷新；这个上界只约束目录传播模型的位移，不代表真实轨道物理不确定性或独立数值误差认证。精确模式、分析和导出强制新历元求值。保持 requested/computed epoch 与覆盖范围可见，禁止把过期可视行冒充统一精确快照。

Worker 池先试桌面两席、手机一席；按实际 CPU 与内存收益决定扩展。每个 Worker 不得复制完整目录索引或 kernel。WASM/Float64 SIMD 作为受控实验，不能预设其三角函数与 Kepler 迭代一定快于当前实现。

### 第 5 阶段：谨慎选择新的计算平台

[WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API)适合视觉剔除、屏幕 LOD 与间接绘制，但仍需检查浏览器、adapter、limits 和可选特性，并保留 WebGL 回退。[WGSL 浮点类型](https://www.w3.org/TR/WGSL/#floating-point-types)为 f32/f16，不能把当前 Float64 科学求值器直接迁移为等精度计算。

[OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)可以把部分 Canvas/WebGL 工作移出主线程，但不会自动减少 GPU 工作或总内存；先完成缓冲与相机变换优化，再评估线程迁移。若采用 [SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)，必须验证部署的安全上下文与跨源隔离响应头，继续提供 transferable 路径。

共享服务计算优先承接精确 SPK 状态、独立集合积分和大规模历元/端点批处理。缓存键必须包含 manifest/hash、目标、参考系、时间尺度、历元及算法选项；验证不可变结果后才跨请求复用。已有共享完成缓存和公平调度作为基础，新增并行应证明吞吐改善而交互尾延迟没有恶化。

## 验收与停止条件

1. **交互响应：** 100k、500k、当前 1.56m 源数据测试拖动、缩放、切换视图、首次与重复拾取；目标为输入到可见变化 P95 小于 100 ms、已建索引拾取小于 150 ms。先剥离网络与自动化等待，分别计时。相机变化应不触发源目录点上传。
2. **渲染与续航：** 普通模式以 60 fps、节能模式以 30 fps 为目标，分别检验 16.7/33.3 ms 帧预算与 GPU 时间；低端 Android、iPhone、集显桌面和独显桌面各跑 30 分钟。记录热状态、峰值内存、实际上传量与功耗，不能用 SwiftShader 替代真机。
3. **生命周期与资源：** 隐藏页面/切出应用停止非必要新任务，恢复处理最新目标；测试内存压力、取消、GPU 上下文丢失与恢复。资源账本覆盖所有同时挂载的子系统，不用单项预留预算冒充进程上限。
4. **科学与表达：** 精确 Float64 路径、来源、掩码、历元一致性和导出语义不变；视觉误差模式有明确标识与零误差回退。源覆盖数、当前计算数、显示点数与密度代表数分别计数。未来 5m 合成数据只作为容量压力证据，不算真实科学覆盖。
5. **回归与推进：** 先修复三项测试期望并通过相关回归，再实施各阶段；真实瓶颈测量不支持收益、或精度/公平性退化时停止该实验。此次没有解除既有全量测试和发布暂停，也没有完成发布验收。

下一步：先阅读第 1 阶段的四项实际改动与验收指标，确定设备测试矩阵后进入实施。

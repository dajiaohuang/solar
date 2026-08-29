# Solar Atlas / 太阳系图谱

**浏览器原生的太阳系动力学与小天体结构图谱。**

[在线演示](https://dajiaohuang.github.io/solar/) · [English](./README.md)

当前版本：**v0.11.0** · [更新日志](./CHANGELOG.md) · [路线图](./ROADMAP.md) · [性能预算](./PERFORMANCE.md)

![Solar Atlas](./public/readme-screenshot.png)

Solar Atlas 把空间视图、轨道元素空间、时间事件与数据证据连接到同一个可复现工作台。它面向科学探索和教学，不是业务星历、近距离预警或航天导航产品。

## 已实现能力

- **访客层：** 打开网页即进入双语综合观测台；首次访问者可选择短教程或直接探索；高级控制默认收起；全局天体/故事/术语搜索（`Ctrl/⌘ K` 或 `/`）、浏览器前进/后退、描述性页面标题和四项移动端主导航保持可用。
- **综合观测台：** 十一个一键预设场景，包括地月、木星与四颗已建模伽利略卫星、土星—泰坦和火星—谷神星—木星；快速二维首屏并可立即切换三维；有界时间模拟；任意天体中心和分屏参考系；可搜索的渲染天体选择；轨迹、图层、缩放与视角参数；测距、拉格朗日点、希尔球与拉普拉斯影响球。
- **小天体目录：** MPCORB 二进制分片；二字符前缀搜索；compact locator 精确筛选与有界分页回填；NEO/PHA 与分类筛选；Lite/Full 显示预算；不可变数据版本与 IndexedDB 缓存。
- **轨道元素空间：** `a–e`、`a–i`、`a–H`、`q–Q`、`a–周期` 联动图；Kirkwood gap / 共振标记；键盘逐点检查、分布直方图、框选与三维同步聚焦。
- **事件实验室：** 自适应采样、可取消的近距离、合、冲及中心天体拱点任务；显示事件局部细化曲线与采样充分性，并明确区分数值区间与未估计的物理不确定性。
- **任务实验室：** 单位与方向正确的霍曼基线、相位角、强制残差收敛的通用变量 Lambert 解、出发/到达 `v∞`、C3，以及可点击/键盘选择并回填日期的 Porkchop 图。
- **引导故事：** 八门六阶段、观察优先的课程；核心课程专门区分历史地心说与现代地心参考系。所有课程均可跨工作区持续、突出相关控件、陈述模型边界并以检查题收尾。
- **对象图谱：** 主要天体与目录对象均有“概览 / 轨道 / 物理 / 背景 / 来源”档案，并为 NEO 分类与风险判断设置明确边界。
- **可复现链接：** v4 URL 记录数据集版本、历元、参考系、天体集合、筛选器、轨迹采样、活动课程步骤、任务端点/日期、语言与视图。目录工作区还会把 `catalogSample=mobile|desktop` 与 manifest 声明的 `catalogSampleCount` 成对固定，使不同设备加载同一份不可变样本；缺字段、不支持或数量不符的组合会失败关闭。v2/v3 链接仍可读取，并在响应式样本加载后升级；完整场景还可保存在本地，并以带版本的 JSON 导入/导出。
- **可安装且可发现：** 首次安装即可离线使用应用壳、更新提示、Web App Manifest、Open Graph 图、JSON-LD、中英静态知识/天体页、sitemap 与路由代码分割。
- **发布证据：** 每次构建显示应用版本、提交 SHA、构建时间、固定数据集、解析器身份、机器可读科学基准、资产哈希与 Pages 容量报告；部署还保存 Lighthouse 报告并执行字节、可访问性与响应速度预算。

## 打开可复现场景

- [开始核心课程：地心说与地心参考系](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=geocentric-model&lang=zh)
- [解释火星逆行](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=retrograde-mars&step=2&lang=zh)
- [在元素空间观察柯克伍德空隙](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=kirkwood-gaps&step=1&lang=zh)
- [比较四类 NEO 轨道](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=neo-types&lang=zh)
- [检查冥王星—海王星 3:2 几何](https://dajiaohuang.github.io/solar/?v=4&page=stories&story=pluto-resonance&step=1&lang=zh)
- [打开地球到火星任务设置](https://dajiaohuang.github.io/solar/?v=4&page=mission&from=earth&to=mars&depart=2026-11-15&arrive=2027-08-01&lang=zh)

## 快速开始

需要 Node.js 22+ 和 npm 10+。

```bash
npm install
npm run dev
```

没有小行星数据集时，应用仍能使用内置的主要天体数据。生成 30,000 条的 Lite 数据集：

```bash
npm run data:lite
npm run validate:data
npm run dev
```

生成 MPCORB 中所有通过校验的椭圆轨道记录：

```bash
npm run data:full
```

完整管线需要数 GB 可用内存。建议使用 `MPCORB_SOURCE_FILE=/path/to/MPCORB.DAT.gz` 固定源快照。

本地应用构建默认不复制生成的目录数据。要复现可部署的 GitHub Pages 成品（只包含固定的活动版本，并把大型 JSON 分片作为 `.json.gz` 交付），运行：

```bash
npm run build:deploy
npm run check:capacity
```

## 数据发布 v3

应用部署与数据发布是两个独立流程：

```text
应用：校验固定数据 → lint → unit + 科学测试 → build → E2E + Lighthouse → 部署

数据：下载源快照 → SHA-256 → 解析 → 逐行语义校验
   → Float64 分片 + 元数据/搜索/ID 索引
   → lint + unit + build + E2E + benchmark
   → 不可变 GitHub Release → 直接提交 pin 到 main → 显式触发部署
```

每个 `public/data/asteroids/releases/<version>/` 都包含：

```text
manifest.json
provenance.json
checksums.json
validation-report.json
binary/*.bin
meta/*.json
search/*.json        # 二字符前缀、每万号段及临时编号年份索引
lookup/*.json
catalog-index.bin    # 仅含数值筛选字段的紧凑索引
catalog-sample-*.bin # 桌面 30,000 / 移动端 8,000 条预计算样本
catalog-sample-*.json
catalog-summary.json
```

数据包根目录的 `dataset-version.json` 只是指向当前不可变版本的小型指针。GitHub Pages 只使用 `.github/asteroid-dataset.json` 中经过提交审计的固定发布资产，解包前验证归档 SHA-256，随后验证内部数据；缺失或格式错误时部署会直接失败。
发布器使用最终数据产物的内容 SHA-256 与解析器版本生成版本身份，以确定性 tar/gzip 打包；复用已有 Release 时会下载并核对真实资产 SHA，绝不会用不同的本地 SHA 更新 pin。Lite 数据集定义为“永久编号不大于 30,000，并强制包含策展目标”，不再是上游文件的前 N 条记录。
永久编号搜索按每 10,000 个编号分片，临时编号按年份分片；名称和编号的规范化词项使用二字符前缀与行 locator。验证器会把每个 search/lookup locator 逐条绑定回源 metadata 的 ID、行号、searchKey 和正确 bucket。

## 双分辨率架构

- **Catalog Mode：** 仅进入 Catalog/Element 路由后读取桌面 30,000 / 移动端 8,000 条预计算分层样本；精确数值筛选由常驻 Worker 扫描紧凑索引，每页最多回填 480 条、32 个唯一分片；宽筛选点云继续复用预计算样本，解码详情分片只保留在 8 项 LRU 中。
- **Focus Mode：** 从目录选择中取前 160 个对象绘制轨迹、查看属性并参与有界分析；目录级全选保存“数据版本 + 筛选表达式 + 总数”，不会枚举全部 ID。

绝对星等筛选明确区分“全部 / 仅已知 / 仅未知”。H 未知值不会被虚构为数值，`a–H` 数值散点图会排除这些对象。

模拟时钟独立于 React 的逐帧渲染；React 只接收限频快照。轨迹、事件和 Porkchop 计算运行在可取消 Worker 中，轨迹结果通过 transferable typed arrays 返回。

## 科学模型与边界

| 功能 | 模型与范围 |
| --- | --- |
| 主要行星 | JPL 表 1 的拟合开普勒根数与长期变化率，基于 J2000 平均黄道/春分点，有效期 1800–2050；“地球”条目仍作为内部地月质心种子，渲染地球点则为推导地心。越界日期明确提示外推。来源使用 JDTDB；浏览器 UTC 日期目前直接生成数值 JD，未做 UTC→TDB 转换 |
| 卫星与矮行星 | 月球使用 JPL 在 2000-01-01.5 TDB、地心黄道平面下的均值根数，仅在固定椭圆上推进平近点角。地心与月心使用校验和固定的 [NAIF/JPL DE440 引力参数内核](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc)中的地球/月球 GM 围绕 EMB 种子分解，因此质量加权中心复现种子、地月间距复现来源向量。这项代数校正不会把任一近似模型变成 DE440 位置星历。木卫一至木卫四和土卫六仍明确采用场景黄道示意椭圆与共享零相位；矮行星使用取整的 `curated-approx` 根数 |
| MPCORB / SBDB | 只接受 `0 ≤ e < 1` 的椭圆密切根数，明确拒绝抛物线/双曲线数据 |
| 月相 | 日—地—月相位角与有符号地心日月距角 |
| 希尔球 | `a(1-e)(m/3M)^(1/3)` |
| Laplace SOI | `a(m/M)^(2/5)`，不会再与希尔球混称 |
| 霍曼转移 | 共面圆轨道端点、瞬时脉冲、太阳二体模型；输出有符号 km/s |
| Lambert | 使用近似端点位置的零圈通用变量太阳二体解；只返回残差已经收敛的结果 |
| 事件分析 | 粗扫非端点候选后做局部细化，并在细化后的 Julian Day 重新执行二体传播；报告采样上限与不足状态，导出数值细化区间；只用于探索，不是认证预报 |
| 航天器轨迹 | 按真实任务里程碑定时的示意折线，与 Horizons/传播星历分开标注 |

JPL SBDB 严格读取官方结构 `orbit.elements[]` 中的 `name/value/units/sigma`，不会从不存在的扁平字段生成默认轨道。

主要数据来源：

- [Minor Planet Center MPCORB](https://www.minorplanetcenter.net/iau/MPCORB.html)
- [JPL SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html)
- [JPL 近似行星位置](https://ssd.jpl.nasa.gov/planets/approx_pos.html)
- [JPL 行星卫星均值根数](https://ssd.jpl.nasa.gov/sats/elem/)

## 验证

```bash
npm run lint
npm run test:unit
npm run test:scientific
npm run test:e2e
npm run build
npm run ci
npm run benchmark:catalog
npm run check:capacity
```

单元测试覆盖儒略日、开普勒传播、父天体/参考系、霍曼单位与方向、月相几何、Hill/SOI 定义、严格 JPL SBDB fixture、局部事件极值、Lambert 圆轨道弧、v2/v3 兼容与 v4 目录样本往返、带版本的场景库、MPCORB 解析、manifest/缓存隔离、百万行有界扫描和微型数据发布。科学测试子集会把 JPL Horizons、Lambert 与星历状态写入构建。Playwright 覆盖浏览器历史、跨工作区课程、全局搜索、保存场景、故事/任务 URL、跨设备固定目录样本、畸形组合的恢复边界、交互 Porkchop、目录恢复、Worker/WebGL 降级、首次离线、缓存隔离及严重或致命 axe 问题；定时任务还会在 Firefox 与 WebKit 重跑，部署门禁另以 Lighthouse 审计首页和静态展页。

## 开源许可

源代码使用 [MIT License](./LICENSE)。上游天文数据仍适用其来源机构的条款与署名要求。

贡献、安全披露与引用说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)、[SECURITY.md](./SECURITY.md) 和 [CITATION.cff](./CITATION.cff)。

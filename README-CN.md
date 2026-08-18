# Solar Atlas / 太阳系图谱

**浏览器原生的太阳系动力学与小天体结构图谱。**

[在线演示](https://dajiaohuang.github.io/solar/) · [English](./README.md)

![Solar Atlas](./public/og-image.svg)

Solar Atlas 把空间视图、轨道元素空间、时间事件与数据证据连接到同一个可复现工作台。它面向科学探索和教学，不是业务星历、近距离预警或航天导航产品。

## 已实现能力

- **空间探索：** 日心、地心和任意天体中心参考系；二维/三维视图；分屏参考系对比；时间推进、测距、拉格朗日点、希尔球与拉普拉斯影响球。
- **小天体目录：** MPCORB 二进制分片；名称、编号和临时编号搜索；NEO/PHA 与分类筛选；按 `a/e/i/H/q` 过滤；Lite/Full 显示预算；不可变数据版本与 IndexedDB 缓存。
- **轨道元素空间：** `a–e`、`a–i`、`a–H`、`q–Q`、`a–周期` 联动图；Kirkwood gap / 共振标记；框选后同步聚焦三维空间。
- **事件实验室：** 显式、可取消的近距离、合、冲、近日点和远日点任务；进度、结果缓存、时间线跳转、CSV/JSON 导出。播放模拟时间不会自动重新计算。
- **任务实验室：** 单位与方向正确的霍曼基线、相位角、通用变量 Lambert 解、出发/到达 `v∞`、C3 与 Worker 生成的 Porkchop 图。
- **引导故事：** 逆行、参考系、Kirkwood gaps、木星特洛伊、NEO 分类、冥王星共振与旅行者时代等 JSON 场景。
- **可复现链接：** URL 保存数据集版本、历元、参考系、天体集合、筛选器、语言与视图。
- **可安装网页应用：** 响应式移动端 Lite 布局、离线运行时缓存、Web App Manifest、社交分享元信息与路由代码分割。

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

## 数据发布 v2

应用部署与数据发布是两个独立流程：

```text
应用：lint → unit test → build → 部署指定的数据发布标签

数据：下载源快照 → SHA-256 → 解析 → 校验
   → Float64 分片 + 元数据/搜索/ID 索引
   → 不可变 GitHub Release → 固定发布标签 → 部署
```

每个 `public/data/asteroids/releases/<version>/` 都包含：

```text
manifest.json
provenance.json
checksums.json
validation-report.json
binary/*.bin
meta/*.json
search/*.json        # 词首、每万号段及临时编号年份索引
lookup/*.json
```

数据包根目录的 `dataset-version.json` 只是指向当前不可变版本的小型指针。GitHub Pages 部署不会重新下载一个不断变化的 MPCORB 文件；它只使用 `.github/asteroid-dataset-tag` 中经过提交审计的固定发布资产，缺失或格式错误时部署会直接失败。
发布器使用最终数据产物的内容 SHA-256 生成版本身份，记录解析器提交和稳定筛选策略，拒绝覆盖已经存在的版本，并且只在所有产物及校验报告写入完成后原子切换当前版本指针。Lite 数据集定义为“永久编号不大于 30,000，并强制包含策展目标”，不再是上游文件的前 N 条记录。
永久编号搜索按每 10,000 个编号分片，临时编号按年份分片；名称和编号的每个规范化词项都按自身首字母建立索引。

## 双分辨率架构

- **Catalog Mode：** 可加载、筛选、目录级全选并绘制全部覆盖对象；一颗天体对应一个 GPU point，不绘制完整轨迹。
- **Focus Mode：** 从目录选择中取前 160 个对象绘制轨迹、查看属性并参与有界分析，目录级选择本身不受这个渲染上限影响。

模拟时钟独立于 React 的逐帧渲染；React 只接收限频快照。轨迹、事件和 Porkchop 计算运行在可取消 Worker 中，轨迹结果通过 transferable typed arrays 返回。

## 科学模型与边界

| 功能 | 模型与范围 |
| --- | --- |
| 主要行星 | JPL 近似平均轨道根数与长期变化率，适合大尺度可视化 |
| 卫星与矮行星 | 标为 `curated-approx` 的取整教学根数，并递归叠加父天体 |
| MPCORB / SBDB | 只接受 `0 ≤ e < 1` 的椭圆密切根数，明确拒绝抛物线/双曲线数据 |
| 月相 | 日—地—月相位角与有符号地心日月距角 |
| 希尔球 | `a(1-e)(m/3M)^(1/3)` |
| Laplace SOI | `a(m/M)^(2/5)`，不会再与希尔球混称 |
| 霍曼转移 | 共面圆轨道端点、瞬时脉冲、太阳二体模型；输出有符号 km/s |
| Lambert | 使用近似端点位置的零圈通用变量太阳二体解 |
| 事件分析 | 有界采样的距离极小值和角度极值，只用于探索 |
| 航天器轨迹 | 按真实任务里程碑定时的示意折线，与 Horizons/传播星历分开标注 |

JPL SBDB 严格读取官方结构 `orbit.elements[]` 中的 `name/value/units/sigma`，不会从不存在的扁平字段生成默认轨道。

主要数据来源：

- [Minor Planet Center MPCORB](https://www.minorplanetcenter.net/iau/MPCORB.html)
- [JPL SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html)
- [JPL 近似行星位置](https://ssd.jpl.nasa.gov/planets/approx_pos.html)

## 验证

```bash
npm run lint
npm run test:unit
npm run test:e2e
npm run build
npm run ci
```

单元测试覆盖儒略日、开普勒传播、父天体/参考系、霍曼单位与方向、月相几何、Hill/SOI 定义、严格 JPL SBDB fixture、Lambert 圆轨道弧、版本化深链接、MPCORB 定长解析，以及微型数据集发布/哈希复核。Playwright 在桌面和移动 Chromium 上覆盖核心路由、可复现故事、任务 Worker 与 2D/3D 渲染。

## 开源许可

源代码使用 [MIT License](./LICENSE)。上游天文数据仍适用其来源机构的条款与署名要求。

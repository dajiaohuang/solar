# solar（中文说明）

solar 是一个基于 React + TypeScript + Vite 的太阳系轨迹可视化应用，可在二维平面中观察更接近真实星历的数据，并支持切换参考天体。

- 主要行星与矮行星的更真实轨道参数
- 小行星目录预处理（MPCORB）+ 分块加载
- Web Worker 轨道计算 + WebGL 渲染
- 全屏主舞台 + 左侧抽屉式控制面板
- 小行星双向懒加载（向下加载后页，向上回补前页）
- 小行星“已加载不等于已绘制”（必须手动点选才参与渲染）

英文主文档见 `README.md`。

---

## 环境要求

- Node.js 18+（建议 20+）
- npm 9+

---

## 快速开始

```bash
npm install
npm run dev
```

启动后访问终端输出中的本地地址（通常为 `http://localhost:5173`）。

---

## 首次生成小行星目录数据

如需启用完整小行星目录，请先执行：

```bash
npm run preprocess:asteroids
```

脚本会：

1. 从 Minor Planet Center 下载 `MPCORB.DAT.gz`
2. 解析轨道参数与分类标记
3. 生成前端可直接加载的分片数据：
   - `public/data/asteroids/chunks/*.json`
   - `public/data/asteroids/search/*.json`
   - `public/data/asteroids/manifest.json`

可选环境变量：

- `MPCORB_CHUNK_SIZE`：每个分片的记录数（默认 `5000`）
- `MPCORB_LIMIT`：只处理前 N 条记录（调试用）

示例：

```bash
MPCORB_LIMIT=30000 npm run preprocess:asteroids
```

---

## 交互逻辑

### 全屏主舞台

- 页面整体锁定为单屏，不出现主页面纵向滚动
- 在主画布区域滚轮缩放，缩放中心跟随鼠标位置
- 点击左上角 `Menu`（菜单）打开抽屉面板

### 抽屉面板板块

- `Overview`：参考点、模拟时间/日期、最大相对距离
- `Controls`：参考点、轨迹时长、速度倍率、缩放、播放控制
- `Major Bodies`：预设组合 + 手动勾选
- `Asteroids`：搜索、分类筛选、分区懒加载
- `Loaded`：当前已加载和保留的小行星

### 小行星窗口策略

- 分区加载后不会自动绘制
- 必须手动点选才进入轨迹渲染
- 列表底部附近触发后续分页加载
- 列表顶部附近触发前序分页回补
- 超出窗口上限时，自动回收窗口外未点选条目
- 已点选条目不会因回收而丢失

---

## 常用命令

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run preprocess:asteroids
```

---

## 核心目录

```text
src/
  components/
    TrajectoryCanvas.tsx    # WebGL 渲染层
    CatalogPanel.tsx        # 小行星面板 + 双向懒加载列表
  hooks/
    useTrajectoryWorker.ts  # Worker 通信与帧数据管理
  workers/
    trajectory.worker.ts    # 后台轨迹计算
  lib/
    ephemeris.ts            # 轨道求解
    trajectory.ts           # 轨迹采样与帧组装
    referenceFrame.ts       # 参考系换算
    viewProjection.ts       # 投影/反投影（含视图偏移）
    catalogLoader.ts        # 分片、搜索与游标分页
  data/
    majorBodies.ts          # 主要天体与矮行星参数
  App.tsx                   # 全屏主界面与抽屉控制

scripts/
  preprocess-asteroids.mjs  # MPCORB 预处理脚本
```

---

## 数据来源

- JPL 行星近似轨道元素
- JPL SBDB 开普勒元素
- MPCORB（Minor Planet Center 小行星目录）

> 本项目用于可视化与学习，不是高精度天体历积分器。


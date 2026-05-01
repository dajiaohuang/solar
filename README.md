# 真实星历太阳系观察器

一个基于 React + TypeScript + Vite 的太阳系平面轨迹可视化项目，支持：

- 以太阳/地球等天体作为参考点观察相对轨迹
- 主要行星 + 矮行星 + 大规模小行星目录
- Web Worker 轨道计算 + WebGL 绘制
- 全屏轨迹舞台 + 左侧抽屉控制台
- 小行星分区双向懒加载（底部加载后页，顶部回补前页）
- 小行星“加载不等于绘制”：必须手动点选才进入渲染

---

## 1. 环境要求

- Node.js 18+（建议 20+）
- npm 9+

---

## 2. 快速开始

```bash
npm install
npm run dev
```

默认启动后打开浏览器访问终端输出中的本地地址（通常是 `http://localhost:5173`）。

---

## 3. 生成完整小行星目录（首次必做）

项目默认支持主要天体与矮行星；如果要启用完整小行星目录，请先执行：

```bash
npm run preprocess:asteroids
```

该脚本会：

1. 下载 MPCORB 原始数据（`MPCORB.DAT.gz`）
2. 解析轨道参数与分类标记
3. 输出前端可用的静态分片数据到：
   - `public/data/asteroids/chunks/*.json`
   - `public/data/asteroids/search/*.json`
   - `public/data/asteroids/manifest.json`

可选环境变量：

- `MPCORB_CHUNK_SIZE`：每个 chunk 的记录数（默认 `5000`）
- `MPCORB_LIMIT`：只处理前 N 条记录（调试用）

示例（仅处理前 3 万条用于联调）：

```bash
MPCORB_LIMIT=30000 npm run preprocess:asteroids
```

---

## 4. 交互说明

### 4.1 主舞台（全屏轨迹区）

- 页面整体锁定为单屏，不会出现主页面纵向滚动
- 在主画布区域滚轮：以鼠标位置为中心缩放
- 左上角 `菜单`：打开左侧抽屉

### 4.2 左侧抽屉板块

- `概览`：当前参考点、模拟时间、日期、最远距离
- `控制`：参考点、轨迹时长、时间倍率、缩放、播放控制
- `主要天体`：预设组合（内行星/外行星/矮行星）与手动选择
- `小行星`：搜索 + 分区浏览 + 懒加载
- `已载入`：当前窗口和已保留小行星管理

### 4.3 小行星加载与绘制策略

- 分区切换后先加载一批“窗口数据”
- 向下滚动接近底部：加载后续分片
- 向上滚动接近顶部：回补之前分片
- 超出窗口上限时，自动回收窗口外未点选项
- 只有手动点选后才会绘制轨迹；已点选项会被保留

---

## 5. 常用命令

```bash
npm run dev        # 开发模式
npm run build      # 生产构建
npm run preview    # 本地预览构建结果
npm run lint       # ESLint 检查
```

---

## 6. 项目结构（核心）

```text
src/
  components/
    TrajectoryCanvas.tsx    # WebGL 轨迹绘制层
    CatalogPanel.tsx        # 小行星目录面板（双向分页滚动）
  hooks/
    useTrajectoryWorker.ts  # Worker 通信与帧数据管理
  workers/
    trajectory.worker.ts    # 后台轨道计算
  lib/
    ephemeris.ts            # 星历与轨道求解
    trajectory.ts           # 轨迹采样
    referenceFrame.ts       # 参考系变换
    viewProjection.ts       # 投影/反投影（含视图偏移）
    catalogLoader.ts        # 小行星分片与分页加载
  data/
    majorBodies.ts          # 主要天体与矮行星参数
  App.tsx                   # 全屏舞台与抽屉 UI 主入口

scripts/
  preprocess-asteroids.mjs  # MPCORB 预处理脚本
```

---

## 7. 数据来源

- JPL 行星近似轨道元素（主要行星）
- JPL SBDB 轨道元素（矮行星等）
- MPCORB（Minor Planet Center）小行星目录

> 本项目为可视化与教育用途，非高精度天体力学积分器。

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

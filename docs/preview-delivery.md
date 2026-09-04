# Preview delivery / 预览版交付

The preview is a build-time product profile of the same Web frontend, not a separate UI or a runtime query switch. It does not reduce the full all-known-body data goal. / 预览版是同一 Web 前端的构建时产品配置，不是另一套界面，也不能通过 URL 参数切换权限；它不缩减完整版的全天体数据目标。

## Build and verify / 构建与验证

Install dependencies with `npm ci`. Install the exact immutable dataset archive referenced by `.github/asteroid-dataset.json`, verify its `assetSha256` before extraction into `public/data/asteroids`, and run `npm run validate:data`. Do not substitute a newly generated dataset with a different identity. The existing deploy workflow and pull-request preview check perform this download and verification. / 先运行 `npm ci`。获取 `.github/asteroid-dataset.json` 指定的不可变数据归档，解压到 `public/data/asteroids` 前核对 `assetSha256`，然后运行 `npm run validate:data`。不要替换成身份不同的新生成数据。现有部署流程和 PR 预览检查会执行下载及校验。

```bash
npm run build:preview
npm run check:capacity
npm run preview -- --host 127.0.0.1
```

Open the displayed local `/solar/` URL. For automated desktop/mobile coverage, run `npm run test:preview`; this builds its own production preview and owns a server on port 4197. Chromium must be installed with `npx playwright install chromium`, or select installed Chrome with `PLAYWRIGHT_BROWSER_CHANNEL=chrome`. Do not run full/native builds concurrently: all build profiles currently write `dist`. / 打开终端显示的本地 `/solar/` 地址。运行 `npm run test:preview` 会自动构建生产预览包，在 4197 端口启动服务器并验证桌面/手机。先用 `npx playwright install chromium` 安装浏览器，或通过 `PLAYWRIGHT_BROWSER_CHANNEL=chrome` 使用已安装的 Chrome。各构建配置目前共用 `dist`，不要同时运行完整、原生与预览构建。

| Command / 命令 | Product / 产品 | Data boundary / 数据边界 |
| --- | --- | --- |
| `npm run build` | Full Web / 完整 Web | Default Pages-window SPKs; catalog omitted by default / 默认 Pages 时间窗口 SPK，默认不复制目录 |
| `npm run build:deploy` | Compatibility Web delivery / 兼容性 Web 交付 | Existing full catalog root retained / 保留现有完整目录根路径 |
| `npm run build:preview` | Curated Web preview / 精选 Web 预览 | Allowed SPK dependency closure and mobile display sample only / 仅允许天体的 SPK 依赖闭包与手机展示样本 |
| `npm run build:native` | Full native-shell baseline / 完整应用壳基线 | Full SPK profile, on-demand HTTPS catalog; rejects preview / 完整 SPK 配置，按需 HTTPS 目录，拒绝预览配置 |

Product availability and scientific time coverage are different dimensions. A full product does not automatically mean full-window SPKs; a visible body does not imply a valid state at every epoch. / 产品可用性与科学时间覆盖是不同维度。完整产品不自动表示完整时间窗口 SPK；可见天体也不表示任意历元都有有效状态。

## Included and restricted / 开放与受限内容

`src/data/preview-profile.json` is the shared policy source. It enables the Observation Deck/Explorer, Element Space, Stories and Evidence; selected planets, moons and binaries; three lessons; at most 4,383 history days and 360 trajectory samples; and the pinned 8,000-record mobile display sample on both desktop and mobile. A filtered view may show fewer points. Source catalog totals and validation reports describe the original source, **not** delivered or selectable coverage. / `src/data/preview-profile.json` 是共用策略来源：开放综合看板/探索器、轨道要素、课程与证据页，精选行星、卫星与双星，三组课程，最多 4,383 天历史与 360 个轨迹采样点，桌面和手机均使用固定的 8,000 条手机展示样本。筛选后点数可能更少。源目录总数与校验报告描述的是原始来源，**不是**实际交付或可选覆盖量。

Catalog search/scan, Events Lab, Mission Lab, other scenes and objects remain visible but cannot start restricted actions or fetch full-only resources. Keyboard/touch activation opens an explanation. A denied deep link is kept unchanged until the visitor explicitly chooses to explore the preview; dismissing the explanation does not silently replace that link. Full-client destinations are currently unset, so no invented app/store/backend link is shown. Makemake can be inspected but its missing precise state remains explicit. / 全量目录检索/扫描、事件实验室、任务实验室及其他场景和天体保留可见入口，但不能执行受限操作或下载完整版资源。键盘和触屏操作会打开说明。受限深链接保留不变，直到用户明确选择探索预览；关闭说明不会暗中替换链接。完整版入口目前未配置，不显示编造的应用、商店或后端地址。Makemake 可以查看信息，但精确状态缺失仍明确标注。

## Artifact and cache identity / 产物与缓存身份

Every build publishes `product-availability.json` and `ephemeris-manifest.json`. `build-info.json` records the product and availability hash. Runtime workers use the same selected manifest; packing recursively includes required source-specific dependencies and verifies exact SPK hashes and bytes. The current default preview closure contains 36 files totaling 90,800,128 SPK bytes; this is an artifact count, not a count of bodies with complete states. / 每次构建发布产品可用性与星历清单，构建信息记录产品及可用性哈希。运行时 worker 使用相同清单；打包递归包含各来源所需依赖并验证 SPK 哈希与字节数。当前默认预览闭包有 36 个文件、90,800,128 字节 SPK；这是产物数，不是状态完整的天体数量。

Preview catalogs live under `data/asteroids/preview/<availability-sha256>/releases/<source-version>/`, never replacing immutable full manifests at `data/asteroids/releases/`. Only source metadata/validation, summary and the mobile display sample are copied; desktop samples, lookup/search indexes and full shards are absent and unadvertised. The delivery manifest hashes delivered files separately from source identity. / 预览目录按可用性哈希单独命名，不覆盖现有不可变完整清单。仅复制来源元数据/验证、摘要及手机展示样本；不包含或宣称桌面样本、检索索引或完整分片。交付清单分别记录交付文件哈希与来源身份。

IndexedDB keys retain complete URLs. Preview versions include both the availability hash and source release. Stale-version eviction is product-scoped, while full and preview records share one global LRU budget: at most 256 MiB, further reduced by reported storage quota. This is a bounded, best-effort cache, not a persistent offline download guarantee. / IndexedDB 键保留完整 URL；预览版本同时包含可用性哈希和源发布身份。同一产品内清理旧版本，完整与预览记录共用一个全局 LRU 预算：最多 256 MiB，并根据浏览器存储配额进一步降低。这是有界、尽力而为的缓存，不是永久离线下载保证。

## Live migration gate / 线上迁移前置条件

The Pages deploy command has **not** switched to the curated artifact. Installed Capacitor clients still request the full catalog at `https://dajiaohuang.github.io/solar/data/asteroids`; removing it would break those clients. Before switching, provision an explicitly authorized full-data endpoint, validate client migration and old-client compatibility, and retain a tested rollback. A successful local preview build or a merged backend PR does not prove this gate complete. Independent native frontends and all-known-body scientific coverage remain separate outstanding requirements. / Pages 部署命令**尚未**切换到精选产物。已安装的 Capacitor 客户端仍请求 Pages 上的完整目录，移除会破坏兼容性。切换前必须提供经明确授权的完整数据端点，验证客户端迁移及旧客户端兼容，并保留经过测试的回滚。预览本地构建成功或后端 PR 合并不表示此前置条件已满足。独立原生前端和全天体科学覆盖仍是另行未完成的要求。

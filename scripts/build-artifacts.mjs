import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile, copyFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip, constants as zlibConstants } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_FILE = join(ROOT, '.cache', 'solar-build-info.json')
const SCIENTIFIC_VALIDATION_CACHE = join(ROOT, '.cache', 'scientific-validation.json')
const DIST = join(ROOT, 'dist')
const PUBLIC = join(ROOT, 'public')
const SITE_BASE = 'https://dajiaohuang.github.io/solar/'
const MAX_ARTIFACT_BYTES = 700 * 1024 * 1024
const WARN_ARTIFACT_BYTES = 600 * 1024 * 1024

function readJson(path) {
  return readFile(path, 'utf8').then((text) => JSON.parse(text))
}

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

function gitSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return 'unknown' }
}

async function prepareBuildInfo() {
  const packageJson = await readJson(join(ROOT, 'package.json'))
  const pinPath = join(ROOT, '.github', 'asteroid-dataset.json')
  const pin = await exists(pinPath) ? await readJson(pinPath) : null
  const candidatePointerPath = join(ROOT, 'public', 'data', 'asteroids', 'dataset-version.json')
  const candidatePointer = process.env.SOLAR_ATLAS_ALLOW_UNPINNED_DATASET === '1' && await exists(candidatePointerPath)
    ? await readJson(candidatePointerPath)
    : null
  const info = {
    version: packageJson.version,
    commitSha: gitSha(),
    buildTime: new Date().toISOString(),
    environment: process.env.SOLAR_ATLAS_BUILD_ENV ?? (process.env.GITHUB_ACTIONS ? 'github-pages' : 'local'),
    datasetVersion: candidatePointer?.activeVersion ?? pin?.version ?? null,
  }
  await mkdir(dirname(CACHE_FILE), { recursive: true })
  await writeFile(CACHE_FILE, `${JSON.stringify(info, null, 2)}\n`)
  process.stdout.write(`Prepared build identity ${info.version} @ ${info.commitSha.slice(0, 12)}\n`)
}

async function walkFiles(root) {
  if (!await exists(root)) return []
  const output = []
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) output.push(path)
    }
  }
  await visit(root)
  return output
}

function normalizedRelative(root, path) {
  return relative(root, path).split(sep).join('/')
}

async function copyStaticPublic() {
  const files = await walkFiles(PUBLIC)
  for (const source of files) {
    const relativePath = normalizedRelative(PUBLIC, source)
    if (relativePath.startsWith('data/asteroids/')) continue
    const destination = join(DIST, ...relativePath.split('/'))
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
}

function shouldCompressJson(relativePath) {
  return /^(search|lookup|meta|chunks)\/.+\.json$/.test(relativePath) || /^catalog-sample-(desktop|mobile)\.json$/.test(relativePath)
}

async function gzipFile(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await pipeline(
    createReadStream(source),
    createGzip({ level: 9, strategy: zlibConstants.Z_DEFAULT_STRATEGY }),
    createWriteStream(destination),
  )
}

async function copyActiveDataset(buildInfo) {
  if (process.env.SOLAR_ATLAS_INCLUDE_DATASET !== '1') return { included: false, version: null }
  const pointerPath = join(PUBLIC, 'data', 'asteroids', 'dataset-version.json')
  if (!await exists(pointerPath)) throw new Error('SOLAR_ATLAS_INCLUDE_DATASET=1 but dataset-version.json is missing')
  const pointer = await readJson(pointerPath)
  const version = String(pointer.activeVersion ?? '')
  if (!/^[a-zA-Z0-9._-]+$/.test(version)) throw new Error(`Unsafe active dataset version: ${version}`)
  if (buildInfo.datasetVersion && version !== buildInfo.datasetVersion) {
    throw new Error(`Installed dataset ${version} does not match pinned ${buildInfo.datasetVersion}`)
  }
  const sourceRoot = join(PUBLIC, 'data', 'asteroids', 'releases', version)
  if (!await exists(sourceRoot)) throw new Error(`Active dataset release is missing: ${sourceRoot}`)
  const destinationRoot = join(DIST, 'data', 'asteroids', 'releases', version)
  const sourceManifest = await readJson(join(sourceRoot, 'manifest.json'))
  const pointerDestination = join(DIST, 'data', 'asteroids', 'dataset-version.json')
  await mkdir(dirname(pointerDestination), { recursive: true })
  await copyFile(pointerPath, pointerDestination)
  const sourceFiles = await walkFiles(sourceRoot)
  const tasks = sourceFiles.map((source) => async () => {
    const relativePath = normalizedRelative(sourceRoot, source)
    const destination = join(destinationRoot, ...relativePath.split('/'))
    if (relativePath === 'manifest.json') {
      const manifest = structuredClone(sourceManifest)
      const capabilities = new Set(manifest.capabilities ?? [])
      capabilities.add('gzip-json-v1')
      manifest.capabilities = [...capabilities]
      manifest.delivery = {
        jsonCompression: 'gzip',
        suffix: '.gz',
        compressedDirectories: ['search', 'lookup', 'meta', 'chunks'],
        compressedRootArtifacts: ['catalog-sample-desktop.json', 'catalog-sample-mobile.json'],
      }
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, `${JSON.stringify(manifest, null, 2)}\n`)
    } else if (shouldCompressJson(relativePath)) {
      await gzipFile(source, `${destination}.gz`)
    } else {
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(source, destination)
    }
  })
  let cursor = 0
  const workerCount = Math.min(8, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor]
      cursor += 1
      await task()
    }
  }))
  const deliveredFiles = await walkFiles(destinationRoot)
  const deliveryEntries = new Array(deliveredFiles.length)
  let deliveryCursor = 0
  await Promise.all(Array.from({ length: Math.min(8, deliveredFiles.length) }, async () => {
    while (deliveryCursor < deliveredFiles.length) {
      const index = deliveryCursor
      deliveryCursor += 1
      const path = deliveredFiles[index]
      const fileStat = await stat(path)
      deliveryEntries[index] = { path: normalizedRelative(destinationRoot, path), bytes: fileStat.size, sha256: await hashFile(path) }
    }
  }))
  deliveryEntries.sort((left, right) => left.path.localeCompare(right.path))
  const deliveryManifestPath = join(destinationRoot, 'delivery-manifest.json')
  await writeFile(deliveryManifestPath, `${JSON.stringify({
    schemaVersion: 1,
    datasetVersion: version,
    generatedAt: buildInfo.buildTime,
    sourceContentSha256: sourceManifest.contentSha256 ?? pointer.contentSha256 ?? null,
    delivery: { jsonCompression: 'gzip', suffix: '.gz' },
    files: deliveryEntries,
  }, null, 2)}\n`)
  return {
    included: true,
    version,
    fileCount: deliveryEntries.length,
    deliveryManifestPath: `data/asteroids/releases/${version}/delivery-manifest.json`,
    deliveryManifestSha256: await hashFile(deliveryManifestPath),
  }
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function pageStyles() {
  return `:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#05080c;color:#dbe5e8}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 72% 0,rgba(41,89,98,.25),transparent 38%),#05080c}main{width:min(900px,calc(100% - 40px));margin:auto;padding:64px 0 96px}.brand{color:#e3bb68;letter-spacing:.14em;text-transform:uppercase;text-decoration:none}.eyebrow{color:#62d0b5;font:12px ui-monospace,monospace;letter-spacing:.16em}h1{font-size:clamp(42px,8vw,76px);font-weight:300;line-height:1;margin:.25em 0}h2{font-weight:450;margin-top:42px}p,li{color:#9eb0b8;line-height:1.75}.lead{font-size:19px;max-width:760px}.card{border:1px solid rgba(152,186,202,.18);background:rgba(12,18,24,.9);padding:24px;margin:16px 0}.card span{color:#62d0b5;font:11px ui-monospace,monospace;text-transform:uppercase}.cta{display:inline-block;margin-top:28px;padding:14px 19px;background:#62d0b5;color:#06110f;text-decoration:none;font-weight:700;border-radius:3px}.sources a{display:block;color:#dbe5e8;padding:10px 0}footer{border-top:1px solid rgba(152,186,202,.18);margin-top:56px;padding-top:22px;color:#71858f;font-size:13px}`
}

function staticPageHtml({ lang, path, title, description, sections, appUrl, schemaType = 'LearningResource', boundary, sources = [], imagePath = 'og-image.png' }) {
  const isZh = lang === 'zh'
  const canonical = `${SITE_BASE}${path}/`
  const englishPath = path.replace(/^zh\//, '')
  const chinesePath = `zh/${englishPath}`
  const englishUrl = `${SITE_BASE}${englishPath}/`
  const chineseUrl = `${SITE_BASE}${chinesePath}/`
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: title,
    description,
    inLanguage: isZh ? 'zh-CN' : 'en',
    url: canonical,
    citation: sources.map((source) => source.url),
    isPartOf: { '@type': 'SoftwareApplication', name: 'Solar Atlas', url: SITE_BASE },
  }).replaceAll('<', '\\u003c')
  const boundaryCard = boundary ? `<section class="card"><span>${isZh ? '模型边界' : 'MODEL BOUNDARY'}</span><h2>${isZh ? '这页不能证明什么' : 'What this page does not prove'}</h2><p>${escapeHtml(boundary)}</p></section>` : ''
  const sourceList = sources.length ? `<section class="card sources"><span>${isZh ? '一手来源' : 'PRIMARY SOURCES'}</span><h2>${isZh ? '继续核验' : 'Continue the evidence trail'}</h2>${sources.map((source) => `<a href="${escapeHtml(source.url)}" rel="noreferrer">${escapeHtml(source.label)} ↗</a>`).join('')}</section>` : ''
  return `<!doctype html><html lang="${isZh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — Solar Atlas</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="en" href="${englishUrl}"><link rel="alternate" hreflang="zh-CN" href="${chineseUrl}"><link rel="alternate" hreflang="x-default" href="${englishUrl}"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(title)} — Solar Atlas"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE_BASE}${imagePath}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(title)} — Solar Atlas"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${SITE_BASE}${imagePath}"><style>${pageStyles()}</style><script type="application/ld+json">${jsonLd}</script></head><body><main><a class="brand" href="${SITE_BASE}">☉ Solar Atlas</a><p class="eyebrow">${isZh ? '可复现的太阳系知识页' : 'REPRODUCIBLE SOLAR SYSTEM KNOWLEDGE'}</p><h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(description)}</p>${sections.map((section, index) => `<section class="card"><span>${String(index + 1).padStart(2, '0')}</span><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></section>`).join('')}${boundaryCard}${sourceList}<a class="cta" href="${appUrl}">${isZh ? '在 Solar Atlas 中打开 ↗' : 'Open in Solar Atlas ↗'}</a><footer>${isZh ? '教学与探索工具；不是业务星历、导航或碰撞预警产品。' : 'Educational exploration; not an operational ephemeris, navigation, or collision-warning product.'}</footer></main></body></html>`
}

async function writeStaticKnowledgePages() {
  const stories = await readJson(join(ROOT, 'src', 'content', 'stories', 'stories.json'))
  const pages = []
  const writePage = async (path, spec) => {
    const destination = join(DIST, ...path.split('/'), 'index.html')
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, staticPageHtml({ ...spec, path }))
    pages.push(path)
  }
  for (const story of stories) {
    for (const lang of ['en', 'zh']) {
      const path = `${lang === 'zh' ? 'zh/' : ''}stories/${story.id}`
      await writePage(path, {
        lang,
        title: story.title[lang],
        description: story.summary[lang],
        sections: story.steps.map((step) => ({ title: step.title[lang], body: step.body[lang] })),
        boundary: story.boundary[lang],
        sources: story.sources,
        imagePath: `og/stories/${story.id}-${lang}.png`,
        appUrl: `${SITE_BASE}?v=3&page=stories&story=${encodeURIComponent(story.id)}&lang=${lang}`,
      })
    }
  }
  const objects = [
    {
      slug: 'ceres', query: 'Ceres',
      en: ['Ceres', 'Explore the largest object in the main asteroid belt through its orbit, physical context, evidence, and element-space neighborhood.'],
      zh: ['谷神星', '通过轨道、物理背景、证据与元素空间邻域探索主小行星带中最大的天体。'],
      sections: {
        en: [
          ['Overview', 'Ceres is the only dwarf planet in the inner Solar System and the largest body in the main asteroid belt.'],
          ['Orbit', 'Its multi-year heliocentric orbit places it inside the dense main-belt population; open the atlas to compare its semi-major axis and eccentricity with nearby objects.'],
          ['Physical', 'Ceres is roughly 940 km across and has a differentiated, water-rich interior inferred from multiple observations.'],
          ['Context', 'NASA’s Dawn mission orbited Ceres and connected its global shape, composition, gravity, topography, and bright salt deposits.'],
          ['Sources', 'Use the linked NASA record for physical interpretation and the atlas provenance panel for the exact orbital dataset, epoch, and parser identity.'],
        ],
        zh: [
          ['概览', '谷神星是内太阳系唯一的矮行星，也是主小行星带中最大的天体。'],
          ['轨道', '它以多年周期绕太阳运行，位于密集的主带族群中；可在图谱里把其半长轴与偏心率同邻近天体比较。'],
          ['物理', '谷神星直径约 940 千米，多类观测表明它具有分异且富水的内部。'],
          ['背景', 'NASA 黎明号曾环绕谷神星，并测量其整体形状、成分、重力、地形和明亮盐沉积。'],
          ['来源', '物理解读请沿用下方 NASA 资料；精确轨道数据集、历元和解析器身份请在图谱的来源面板核验。'],
        ],
      },
      boundary: {
        en: 'The browser trajectory is an educational approximation. It does not reproduce Dawn navigation, a gravity field, surface geology, or a precision Ceres ephemeris.',
        zh: '浏览器轨迹是教学近似，不能复现黎明号导航、非球形重力场、表面地质或高精度谷神星星历。',
      },
      sources: [{ label: 'NASA Science — Ceres facts', url: 'https://science.nasa.gov/dwarf-planets/ceres/facts/' }, { label: 'NASA Dawn science at Ceres', url: 'https://science.nasa.gov/mission/dawn/science/ceres/' }],
    },
    {
      slug: 'bennu', query: 'Bennu',
      en: ['Bennu', 'Inspect a well-studied near-Earth asteroid and follow its traceable orbital elements, mission context, and interpretation limits.'],
      zh: ['贝努', '检查这颗研究充分的近地小行星，并追踪其可溯源轨道根数、任务背景与解读边界。'],
      sections: {
        en: [
          ['Overview', 'Bennu is a small carbon-rich near-Earth asteroid and the sample-return target of NASA’s OSIRIS-REx mission.'],
          ['Orbit', 'Its roughly 1.2-year solar orbit brings it into Earth’s orbital neighborhood; orbit class describes geometry, not a collision forecast.'],
          ['Physical', 'Bennu is about half a kilometer wide, rotates in about 4.3 hours, and has a rubble-rich spinning-top shape.'],
          ['Context', 'OSIRIS-REx mapped Bennu, collected material in 2020, and delivered a pristine sample to Earth in 2023.'],
          ['Sources', 'Use NASA for mission and physical results; use the atlas data panel to distinguish pinned MPCORB elements from an on-demand JPL SBDB record.'],
        ],
        zh: [
          ['概览', '贝努是一颗富碳的小型近地小行星，也是 NASA OSIRIS-REx 采样返回任务的目标。'],
          ['轨道', '它约每 1.2 年绕太阳一周并进入地球轨道邻域；轨道类别描述几何关系，不是碰撞预报。'],
          ['物理', '贝努宽约半千米，自转周期约 4.3 小时，呈碎石堆形成的陀螺状。'],
          ['背景', 'OSIRIS-REx 对贝努完成测绘，2020 年采样，并于 2023 年把原始样本送回地球。'],
          ['来源', '任务和物理结果沿用 NASA 资料；图谱数据面板会区分固定 MPCORB 根数与按需查询的 JPL SBDB 记录。'],
        ],
      },
      boundary: {
        en: 'Two-body osculating elements can illustrate orbit shape but cannot estimate future encounter uncertainty or impact probability. Use JPL’s operational products for risk assessment.',
        zh: '二体密切根数可以说明轨道形状，但不能估计未来交会不确定性或撞击概率；风险评估必须使用 JPL 的业务产品。',
      },
      sources: [{ label: 'NASA Science — Bennu facts', url: 'https://science.nasa.gov/solar-system/asteroids/101955-bennu/facts/' }, { label: 'NASA OSIRIS-REx mission', url: 'https://science.nasa.gov/mission/osiris-rex/' }, { label: 'JPL SBDB API documentation', url: 'https://ssd-api.jpl.nasa.gov/doc/sbdb.html' }],
    },
    {
      slug: 'apophis', query: 'Apophis',
      en: ['Apophis', 'Study a near-Earth orbit and the 2029 observing context while keeping orbit class separate from impact-risk assessment.'],
      zh: ['阿波菲斯', '研究这条近地轨道及 2029 年观测背景，同时明确区分轨道分类与撞击风险评估。'],
      sections: {
        en: [
          ['Overview', 'Apophis is a stony near-Earth asteroid whose unusually close, safe 2029 flyby will create a rare observing opportunity.'],
          ['Orbit', 'It currently follows an Aten-type Earth-crossing orbit; Earth’s 2029 gravity assist will substantially change its subsequent solar orbit.'],
          ['Physical', 'Radar observations indicate a roughly 340 m, elongated body in non-principal-axis rotation.'],
          ['Context', 'The encounter is valuable because Earth’s tides can change the object’s rotation, surface, and orbit while instruments observe the response.'],
          ['Sources', 'Use NASA and JPL for the current encounter solution. The atlas profile identifies its element source and never converts an orbit-class label into a hazard claim.'],
        ],
        zh: [
          ['概览', '阿波菲斯是一颗石质近地小行星；它将在 2029 年安全地近距离飞掠地球，形成罕见观测机会。'],
          ['轨道', '它目前处于穿越地球轨道的阿登型轨道；2029 年地球引力将显著改变它此后的日心轨道。'],
          ['物理', '雷达观测显示其平均尺度约 340 米，形状细长并处于非主轴自转。'],
          ['背景', '这次交会的科学价值在于，可在仪器观测下研究地球潮汐如何改变其自转、表面和轨道。'],
          ['来源', '当前交会解应以 NASA 与 JPL 为准；图谱档案会标明根数来源，并绝不会把轨道类别直接转换成危险结论。'],
        ],
      },
      boundary: {
        en: 'Solar Atlas does not model the 2029 close encounter with a precision planetary ephemeris, covariance propagation, or perturbations. It is not an impact-monitoring service.',
        zh: 'Solar Atlas 未用高精度行星星历、协方差传播和摄动模型计算 2029 年近距离交会，也不是撞击监测服务。',
      },
      sources: [{ label: 'NASA Science — Apophis facts', url: 'https://science.nasa.gov/solar-system/asteroids/apophis-facts/' }, { label: 'JPL SBDB API documentation', url: 'https://ssd-api.jpl.nasa.gov/doc/sbdb.html' }],
    },
  ]
  for (const object of objects) {
    for (const lang of ['en', 'zh']) {
      const [title, description] = object[lang]
      const path = `${lang === 'zh' ? 'zh/' : ''}objects/${object.slug}`
      await writePage(path, {
        lang,
        title,
        description,
        sections: object.sections[lang].map(([sectionTitle, body]) => ({ title: sectionTitle, body })),
        boundary: object.boundary[lang],
        sources: object.sources,
        schemaType: 'Thing',
        appUrl: `${SITE_BASE}?v=3&page=catalog&search=${encodeURIComponent(object.query)}&lang=${lang}`,
        imagePath: `og/objects/${object.slug}-${lang}.png`,
      })
    }
  }
  const generic = [
    { slug: 'models', schemaType: 'TechArticle', en: ['Models & limits', 'Understand the two-body, planetary approximation, event-refinement, Hohmann, and Lambert models—and what they do not claim.'], zh: ['模型与边界', '了解二体、行星近似、事件细化、霍曼与 Lambert 模型，以及它们不作出的主张。'] },
    { slug: 'data', schemaType: 'Dataset', en: ['Data & provenance', 'Trace immutable MPCORB releases through source hashes, parser identity, validation rules, and content-addressed artifacts.'], zh: ['数据与来源', '通过源哈希、解析器身份、校验规则与内容寻址产物追踪不可变 MPCORB 发布。'] },
    { slug: 'about', schemaType: 'AboutPage', en: ['About Solar Atlas', 'A browser-native, bilingual, reproducible Solar System dynamics and small-body atlas for teaching and exploration.'], zh: ['关于太阳系图谱', '用于教学与探索的浏览器原生、双语、可复现太阳系动力学与小天体图谱。'] },
    {
      slug: 'validation', schemaType: 'TechArticle',
      en: ['Scientific validation', 'Inspect the public CI contract for Horizons event tolerance, universal-variable Lambert benchmarks, elliptic propagation, and model validity.'],
      zh: ['科学验证', '检查 Horizons 事件容差、通用变量 Lambert 基准、椭圆传播与模型有效范围的公开 CI 契约。'],
      sources: [
        { label: 'Machine-readable scientific validation', url: `${SITE_BASE}scientific-validation.json` },
        { label: 'Versioned validation tests and fixtures', url: 'https://github.com/dajiaohuang/solar/tree/main/tests' },
      ],
      boundary: {
        en: 'Passing these deterministic benchmarks supports the stated numerical contracts; it does not certify Solar Atlas as an operational ephemeris, navigation system, or impact-monitoring service.',
        zh: '通过这些确定性基准只能支持已声明的数值契约，并不把 Solar Atlas 认证为业务星历、导航系统或撞击监测服务。',
      },
    },
  ]
  for (const item of generic) {
    for (const lang of ['en', 'zh']) {
      const [title, description] = item[lang]
      const path = `${lang === 'zh' ? 'zh/' : ''}${item.slug}`
      await writePage(path, {
        lang,
        title,
        description,
        sections: [{ title, body: description }],
        appUrl: `${SITE_BASE}?v=3&page=about&lang=${lang}`,
        schemaType: item.schemaType,
        sources: item.sources ?? [],
        boundary: item.boundary?.[lang],
      })
    }
  }
  const urls = [SITE_BASE, ...pages.map((path) => `${SITE_BASE}${path}/`)]
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url}</loc><changefreq>monthly</changefreq></url>`).join('\n')}\n</urlset>\n`
  await writeFile(join(DIST, 'sitemap.xml'), sitemap)
  await writeFile(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /solar/\nSitemap: ${SITE_BASE}sitemap.xml\n`)
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function finalizeServiceWorker(buildInfo) {
  const swPath = join(DIST, 'sw.js')
  if (!await exists(swPath)) return
  const files = await walkFiles(DIST)
  const precache = ['./', './index.html', './manifest.webmanifest', './favicon.svg']
  for (const file of files) {
    const relativePath = normalizedRelative(DIST, file)
    if (relativePath.startsWith('assets/') || relativePath.startsWith('icons/')) precache.push(`./${relativePath}`)
    if (relativePath === 'og-image.png') precache.push(`./${relativePath}`)
  }
  const unique = [...new Set(precache)].sort()
  let source = await readFile(swPath, 'utf8')
  source = source.replaceAll('__BUILD_SHA__', buildInfo.commitSha.slice(0, 12))
  source = source.replace(/const PRECACHE_URLS = .*?\/\/ __SOLAR_ATLAS_PRECACHE__/, `const PRECACHE_URLS = ${JSON.stringify(unique)} // __SOLAR_ATLAS_PRECACHE__`)
  await writeFile(swPath, source)
}

async function writeManifestsAndCapacity(buildInfo, dataset) {
  const initialFiles = await walkFiles(DIST)
  const shellFiles = initialFiles.filter((file) => !normalizedRelative(DIST, file).startsWith('data/asteroids/'))
  const assets = []
  for (const file of shellFiles) {
    const fileStat = await stat(file)
    assets.push({ path: normalizedRelative(DIST, file), bytes: fileStat.size, sha256: await hashFile(file) })
  }
  await writeFile(join(DIST, 'asset-manifest.json'), `${JSON.stringify({ schemaVersion: 1, build: buildInfo, assets }, null, 2)}\n`)
  await writeFile(join(DIST, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`)
  const scientificValidation = await exists(SCIENTIFIC_VALIDATION_CACHE)
    ? await readJson(SCIENTIFIC_VALIDATION_CACHE)
    : { schemaVersion: 1, generatedAt: buildInfo.buildTime, passed: null, runner: { totalTests: 0, passedTests: 0, failedTests: 0 }, benchmarks: {}, suites: [], status: 'not-run-in-this-build' }
  const modelEvidence = await readJson(join(ROOT, 'src', 'data', 'modelEvidence.json'))
  const publishedScientificValidation = { ...scientificValidation, modelEvidence, build: buildInfo, dataset }
  await writeFile(join(DIST, 'scientific-validation.json'), `${JSON.stringify(publishedScientificValidation, null, 2)}\n`)
  await writeFile(join(DIST, 'health.json'), `${JSON.stringify({ status: scientificValidation.passed === false ? 'degraded' : 'ok', checkedAt: buildInfo.buildTime, build: buildInfo, dataset, scientificValidation: { passed: scientificValidation.passed, passedTests: scientificValidation.runner?.passedTests ?? 0, totalTests: scientificValidation.runner?.totalTests ?? 0 } }, null, 2)}\n`)

  const files = await walkFiles(DIST)
  const entries = await Promise.all(files.map(async (file) => {
    const fileStat = await stat(file)
    return { path: normalizedRelative(DIST, file), bytes: fileStat.size }
  }))
  const datasetEntries = entries.filter((entry) => entry.path.startsWith('data/asteroids/'))
  const shellEntries = entries.filter((entry) => !entry.path.startsWith('data/asteroids/'))
  const bytes = (items) => items.reduce((sum, item) => sum + item.bytes, 0)
  const coldLoadEntries = entries.filter((entry) => entry.path === 'index.html' || entry.path === 'manifest.webmanifest' || entry.path.startsWith('assets/'))
  const typicalExtra = datasetEntries.filter((entry) => /catalog-index\.bin$|catalog-sample-desktop\.(bin|json\.gz)$|manifest\.json$|provenance\.json$|dataset-version\.json$/.test(entry.path))
  const totalBytes = bytes(entries)
  const report = {
    schemaVersion: 1,
    generatedAt: buildInfo.buildTime,
    thresholds: { warningBytes: WARN_ARTIFACT_BYTES, maximumBytes: MAX_ARTIFACT_BYTES },
    withinBudget: totalBytes <= MAX_ARTIFACT_BYTES,
    warning: totalBytes > WARN_ARTIFACT_BYTES,
    distTotalBytes: totalBytes,
    applicationShellBytes: bytes(shellEntries),
    datasetTotalBytes: bytes(datasetEntries),
    coldLoadTransferBytes: bytes(coldLoadEntries),
    typicalCatalogSessionBytes: bytes(coldLoadEntries) + bytes(typicalExtra),
    fileCount: entries.length,
    largestFiles: [...entries].sort((left, right) => right.bytes - left.bytes).slice(0, 20),
  }
  await writeFile(join(DIST, 'capacity-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`Built ${(totalBytes / 1024 / 1024).toFixed(1)} MiB artifact (${(report.datasetTotalBytes / 1024 / 1024).toFixed(1)} MiB dataset)\n`)
}

async function finalizeBuild() {
  const buildInfo = await readJson(CACHE_FILE)
  if (!await exists(DIST)) throw new Error('dist does not exist; run Vite before finalizing')
  await copyStaticPublic()
  const dataset = await copyActiveDataset(buildInfo)
  await writeStaticKnowledgePages()
  await finalizeServiceWorker(buildInfo)
  await writeManifestsAndCapacity(buildInfo, dataset)
}

const command = process.argv[2]
if (command === 'prepare') await prepareBuildInfo()
else if (command === 'finalize') await finalizeBuild()
else throw new Error('Usage: node scripts/build-artifacts.mjs <prepare|finalize>')

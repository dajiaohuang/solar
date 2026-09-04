import type { BodyKind } from '../types'

type Localized = { en: string; zh: string }

export type BodyProfile = {
  overview: Localized
  significance: Localized
  sources: Array<{ label: string; url: string }>
}

export const BODY_PROFILES: Record<string, BodyProfile> = {
  sun: {
    overview: { en: 'The star whose gravity dominates the Solar System and defines the heliocentric origin used by most atlas views.', zh: '主导太阳系引力、并定义图谱多数视图所用日心原点的恒星。' },
    significance: { en: 'Its gravitational parameter sets the scale for planetary Keplerian motion and the Mission Lab’s heliocentric two-body models.', zh: '太阳引力参数决定行星开普勒运动尺度，也是任务实验室日心二体模型的基础。' },
    sources: [{ label: 'NASA Sun facts', url: 'https://science.nasa.gov/sun/facts/' }],
  },
  earth: {
    overview: { en: 'The third planet from the Sun and the moving observing platform behind geocentric apparent motion.', zh: '太阳系第三颗行星，也是产生地心视运动的移动观测平台。' },
    significance: { en: 'Earth-centered scenes connect heliocentric dynamics to opposition, conjunction, retrograde motion, and near-Earth orbit classes.', zh: '地心场景把日心动力学同冲、合、逆行与近地轨道分类联系起来。' },
    sources: [{ label: 'NASA Earth facts', url: 'https://science.nasa.gov/earth/facts/' }],
  },
  moon: {
    overview: { en: 'Earth’s natural satellite, shown with a compact educational Keplerian model and a computed illumination phase.', zh: '地球的天然卫星；图谱采用紧凑教学开普勒模型，并计算月面照明相位。' },
    significance: { en: 'Its fast motion exposes sampling limits in long event windows and illustrates the distinction between Hill and Laplace influence scales.', zh: '快速月球运动会暴露长事件窗口的采样限制，也适合说明 Hill 与 Laplace 影响尺度的差别。' },
    sources: [{ label: 'NASA Moon facts', url: 'https://science.nasa.gov/moon/facts/' }],
  },
  mars: {
    overview: { en: 'The fourth planet from the Sun, with an eccentric outer orbit that produces a conspicuous retrograde loop for Earth observers.', zh: '太阳系第四颗行星；其偏心外侧轨道会为地球观测者产生显著逆行回环。' },
    significance: { en: 'Mars is the atlas’s clearest bridge between reference frames, event timing, and interplanetary transfer geometry.', zh: '火星是图谱中连接参考系、事件时序与行星际转移几何的最清晰案例。' },
    sources: [{ label: 'NASA Mars facts', url: 'https://science.nasa.gov/mars/facts/' }],
  },
  jupiter: {
    overview: { en: 'The most massive planet, whose resonances organize the main belt and whose 1:1 co-orbital regions host Trojan populations.', zh: '质量最大的行星；其共振塑造主带结构，1:1 共轨区域则承载特洛伊族群。' },
    significance: { en: 'Jupiter links Kirkwood gaps, Lagrange geometry, gravity assists, and the scale of planetary influence.', zh: '木星把柯克伍德空隙、拉格朗日几何、引力助推与行星影响尺度联系在一起。' },
    sources: [{ label: 'NASA Jupiter facts', url: 'https://science.nasa.gov/jupiter/facts/' }],
  },
  ceres: {
    overview: { en: 'Dwarf planet (1) Ceres, the largest body in the main asteroid belt and a curated bridge into the MPCORB catalog.', zh: '矮行星（1）谷神星，主小行星带最大天体，也是进入 MPCORB 目录的策展入口。' },
    significance: { en: 'Its orbit provides a readable reference point for main-belt element space, resonance gaps, and object-level provenance.', zh: '它的轨道是阅读主带元素空间、共振空隙与对象级来源信息的良好参照。' },
    sources: [{ label: 'NASA Ceres facts', url: 'https://science.nasa.gov/dwarf-planets/ceres/facts/' }],
  },
  pluto: {
    overview: { en: 'A trans-Neptunian dwarf planet on an eccentric, inclined orbit near a 3:2 mean-motion resonance with Neptune.', zh: '一颗外海王星矮行星，位于偏心且倾斜的轨道上，并同海王星接近 3:2 平均运动共振。' },
    significance: { en: 'Pluto demonstrates why orbit crossing, period ratio, and long-term dynamical protection are related but distinct claims.', zh: '冥王星说明轨道相交、周期比与长期动力学保护彼此相关，却是不同层次的主张。' },
    sources: [{ label: 'NASA Pluto facts', url: 'https://science.nasa.gov/dwarf-planets/pluto/facts/' }],
  },
}

export function fallbackBodyProfile(kind: BodyKind, orbitClass?: string): Pick<BodyProfile, 'overview' | 'significance'> {
  const labels: Record<BodyKind, Localized> = {
    star: { en: 'A stellar reference object in the atlas.', zh: '图谱中的恒星参考对象。' },
    planet: { en: 'A major planet propagated with the declared planetary approximation.', zh: '使用已声明行星近似模型传播的主要行星。' },
    moon: { en: 'A cataloged natural satellite. Its identity does not imply that a position or orbit model is available for the selected date.', zh: '已收录的天然卫星身份；收录不代表在所选日期已有位置或轨道模型。' },
    dwarfPlanet: { en: 'A curated dwarf-planet orbit for comparative exploration.', zh: '用于比较探索的策展矮行星轨道。' },
    asteroid: { en: `A traceable ${orbitClass ?? 'small-body'} osculating orbit from the active catalog or JPL SBDB.`, zh: `来自当前目录或 JPL SBDB 的可追溯${orbitClass ?? '小天体'}密切轨道。` },
    spacecraft: { en: 'A milestone-dated schematic spacecraft teaching path.', zh: '按任务里程碑日期构建的航天器教学示意路径。' },
  }
  return { overview: labels[kind], significance: { en: 'Use the orbit, context, and source tabs to separate computed values from model boundaries.', zh: '通过轨道、背景与来源页签区分计算数值和模型边界。' } }
}

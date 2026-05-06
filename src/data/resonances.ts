import type { BodyId } from '../types'

export type ResonancePair = {
  bodyA: BodyId
  bodyB: BodyId
  ratio: string
  description: string
}

export const RESONANCES: ResonancePair[] = [
  {
    bodyA: 'pluto',
    bodyB: 'neptune',
    ratio: '2:3',
    description: '冥王星与海王星 2:3 平均运动共振 — 冥王星绕太阳 2 圈，海王星绕 3 圈',
  },
  {
    bodyA: 'io',
    bodyB: 'europa',
    ratio: '2:1',
    description: '木卫一与木卫二 2:1 共振 — 拉普拉斯共振链的一部分',
  },
  {
    bodyA: 'europa',
    bodyB: 'ganymede',
    ratio: '2:1',
    description: '木卫二与木卫三 2:1 共振 — 拉普拉斯共振链的一部分',
  },
  {
    bodyA: 'io',
    bodyB: 'ganymede',
    ratio: '4:1',
    description: '木卫一与木卫三 4:1 — 拉普拉斯共振链的完整表述为 1:2:4',
  },
]

import { expect, it } from 'vitest'
import { SCENE_PRESETS } from '../../src/data/presets'
import { majorBodies } from '../../src/data/majorBodies'
import { getOrbitalPeriodDays } from '../../src/lib/orbitalPeriod'

it('bounds moon-system preset windows to resolve the fastest seed orbit at default sampling', () => {
  const presets = SCENE_PRESETS.filter((preset) => /-spk-moons(?:-\d+)?$/.test(preset.id))
  expect(presets).toHaveLength(16)
  expect(presets.find(preset => preset.id === 'saturn-spk-moons')!.selectedMajorBodyIds).toHaveLength(294)
  for (const preset of presets) {
    const moons = majorBodies.filter((body) => preset.selectedMajorBodyIds.includes(body.id) && body.kind === 'moon')
    const shortest = Math.min(...moons.filter(moon => moon.orbit).map((moon) => getOrbitalPeriodDays(moon.orbit!, 'parent')))
    expect(preset.historyDays / 179).toBeLessThan(shortest / 24)
    expect(preset.historyDays).toBeGreaterThanOrEqual(1)
    expect(preset.historyDays).toBeLessThanOrEqual(30)
  }
})

it('selects every satellite identity in one 3D system scene independently of trail budgets', () => {
  for (const parent of ['mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', 'eris', 'haumea', 'quaoar', 'orcus', 'salacia', '1998ww31', '2001qw322', 'kagara', '1999oj4', '2003un284']) {
    const groups = SCENE_PRESETS.filter(preset => preset.id.startsWith(`${parent}-spk-moons`))
    const selected = groups.flatMap(group => group.selectedMajorBodyIds.filter(id => id !== parent))
    expect(selected.sort()).toEqual(majorBodies.filter(body => body.kind === 'moon' && body.parentId === parent).map(body => body.id).sort())
    expect(groups).toHaveLength(1)
    for (const group of groups) {
      expect(group.viewMode).toBe('3d')
    }
  }
})

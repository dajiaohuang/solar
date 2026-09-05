import { expect, it } from 'vitest'
import { createIdentityLedger } from '../../scripts/lib/body-identity-ledger.mjs'

const record = (id: string, target: number) => ({ id, naifId: target, source: 'fixture', sourceRow: 0,
  parentId: 'naif:10', confirmation: 'confirmed', identityStatus: 'source-designation',
  ephemerisStatus: 'state-available-at-audit-epoch', kernelEvidence: { target,
    stateAtAuditEpoch: { position: { x: 1, y: 2, z: 3 }, velocity: { x: 4, y: 5, z: 6 } } } })

it('groups explicit targets without merging source namespaces or unresolved components', () => {
  const ledger = createIdentityLedger()
  ledger.add(record('source-a:1', 2000001), 0)
  ledger.add(record('source-b:Ceres', 2000001), 1)
  ledger.add({ ...record('source-c:1', 2000001), naifId: undefined }, 2)
  ledger.add({ ...record('sat:record:one', 2000001), identityStatus: 'unresolved-component' }, 3)
  ledger.add({ ...record('sat:record:two', 2000001), identityStatus: 'unresolved-component' }, 4)
  ledger.add({ ...record('candidate', 55), confirmation: 'candidate' }, 5)
  const result = ledger.finish()
  expect(result.counts).toEqual({ sourceRecords: 6, mappedSourceRecords: 2, unresolvedSourceRecords: 4, explicitNaifTargets: 1, availableTargetsAtAuditEpoch: 1 })
  expect(result.explicitTargetGroups[0].sourceRecords.map(row => row.id)).toEqual(['source-a:1', 'source-b:Ceres'])
  expect(result.unresolvedReasons).toEqual({ 'no-explicit-naif-mapping': 1, 'unresolved-component': 2, 'unconfirmed-source-record': 1 })
  expect(ledger.finish()).toEqual(result)
})

it('rejects conflicting parents, guessed target claims and missing source ordinals', () => {
  const ledger = createIdentityLedger()
  ledger.add(record('one', 5), 0)
  expect(() => ledger.add({ ...record('two', 5), parentId: 'naif:399' }, 1)).toThrow('Conflicting')
  expect(() => createIdentityLedger().add(record('one', 5), 1)).toThrow('ordered')
  expect(() => createIdentityLedger().add({ ...record('one', 5), kernelEvidence: undefined }, 0)).toThrow('Unsubstantiated')
})

it('keeps explicitly mapped but unavailable targets distinct from successful epoch states', () => {
  const ledger = createIdentityLedger()
  ledger.add({ ...record('one', 5), ephemerisStatus: 'no-state-at-audit-epoch', kernelEvidence: { target: 5, stateAtAuditEpoch: null } }, 0)
  expect(ledger.finish().counts).toMatchObject({ explicitNaifTargets: 1, availableTargetsAtAuditEpoch: 0 })
})

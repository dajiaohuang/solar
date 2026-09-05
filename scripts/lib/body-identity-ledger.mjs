/** Only records explicitly reattached by the audited identity mapping enter a
 * NAIF target group. Everything else remains a source record, not a new body. */
export function createIdentityLedger() {
  const groups = new Map(), unresolvedReasons = {}, sourceCounts = {}
  let total = 0, mapped = 0
  return {
    add(record, ordinal) {
      if (ordinal !== total || typeof record.id !== 'string' || !record.id || typeof record.source !== 'string') throw new Error('Invalid ordered identity record')
      total++
      sourceCounts[record.source] = (sourceCounts[record.source] ?? 0) + 1
      let reason
      if (record.identityStatus === 'unresolved-component') reason = 'unresolved-component'
      else if (record.confirmation !== 'confirmed') reason = 'unconfirmed-source-record'
      else if (record.naifId === undefined) reason = 'no-explicit-naif-mapping'
      if (reason) {
        unresolvedReasons[reason] = (unresolvedReasons[reason] ?? 0) + 1
        return
      }
      if (!Number.isSafeInteger(record.naifId) || record.kernelEvidence?.target !== record.naifId ||
          !['state-available-at-audit-epoch', 'no-state-at-audit-epoch'].includes(record.ephemerisStatus)) throw new Error('Unsubstantiated explicit identity')
      const evaluatedState = record.kernelEvidence.stateAtAuditEpoch
      if (record.ephemerisStatus === 'state-available-at-audit-epoch') {
        for (const part of ['position', 'velocity']) for (const axis of ['x', 'y', 'z']) {
          if (!Number.isFinite(evaluatedState?.[part]?.[axis])) throw new Error('Nonfinite evaluated identity state')
        }
      } else if (evaluatedState !== null) throw new Error('Unavailable identity must not retain a state')
      let group = groups.get(record.naifId)
      if (!group) {
        group = { target: record.naifId, key: `naif:${record.naifId}`, parentId: record.parentId ?? null,
          stateAtAuditEpoch: record.ephemerisStatus, evaluatedState, sourceRecords: [] }
        groups.set(record.naifId, group)
      }
      if (group.parentId !== (record.parentId ?? null) || group.stateAtAuditEpoch !== record.ephemerisStatus || JSON.stringify(group.evaluatedState) !== JSON.stringify(evaluatedState)) throw new Error('Conflicting explicit target identity or state')
      group.sourceRecords.push({ ordinal, id: record.id, source: record.source, sourceRow: record.sourceRow })
      mapped++
    },
    finish() {
      const explicitTargetGroups = [...groups.values()].sort((a, b) => a.target - b.target)
      return { counts: { sourceRecords: total, mappedSourceRecords: mapped, unresolvedSourceRecords: total - mapped,
        explicitNaifTargets: groups.size, availableTargetsAtAuditEpoch: explicitTargetGroups.filter(group => group.stateAtAuditEpoch === 'state-available-at-audit-epoch').length },
      sourceCounts, unresolvedReasons, explicitTargetGroups,
      meaning: 'NAIF target groups use explicit mappings only; unresolved source records are not counted as unique physical bodies. Unlisted ordinals remain addressable in the pinned input inventory, with unresolved-component, unconfirmed, then no-explicit-mapping reason precedence.' }
    },
  }
}

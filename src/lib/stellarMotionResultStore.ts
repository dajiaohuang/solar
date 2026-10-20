import capacity from "../data/gaiaCapacity.json";
import type {
  StellarMotionBatchRow,
  StellarMotionTileReceipt,
} from "./stellarMotion";

const rowStateFields = [
  "raDeg",
  "decDeg",
  "parallaxMas",
  "pmraMasPerJulianYear",
  "pmdecMasPerJulianYear",
  "radialVelocityKmPerSecond",
] as const;

export const STELLAR_MOTION_ROW_STATUS_CODE = {
  propagated: 1,
  missing: 2,
  rejected: 3,
} as const;

const rowStatusCode = STELLAR_MOTION_ROW_STATUS_CODE;

const rowStatusName: Record<
  number,
  StellarMotionBatchRow["status"] | undefined
> = {
  1: "propagated",
  2: "missing",
  3: "rejected",
};

export type CompactStellarMotionRows = {
  sourceIds: BigInt64Array<ArrayBuffer>;
  statuses: Uint8Array<ArrayBuffer>;
  zeroRadialMotionAssumptions: Uint8Array<ArrayBuffer>;
  reasonCodes: Uint16Array<ArrayBuffer>;
  stateIndexes: Uint16Array<ArrayBuffer>;
  reasons: string[];
  states: Float64Array<ArrayBuffer>;
};

export type CompactStellarMotionTileReceipt = Omit<
  StellarMotionTileReceipt,
  "motion"
> & {
  motion: Omit<StellarMotionTileReceipt["motion"], "rows">;
};

export function compactStellarMotionRows(
  rows: readonly StellarMotionBatchRow[],
  sourceIds: BigInt64Array<ArrayBuffer>,
  expectedPropagatedRows: number,
): CompactStellarMotionRows {
  if (
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > capacity.maxChunkRows ||
    sourceIds.length !== rows.length ||
    !Number.isSafeInteger(expectedPropagatedRows) ||
    expectedPropagatedRows < 0 ||
    expectedPropagatedRows > rows.length
  ) {
    throw new Error("Stellar motion result row budget mismatch");
  }
  const statuses = new Uint8Array(rows.length);
  const zeroRadialMotionAssumptions = new Uint8Array(rows.length);
  const reasonCodes = new Uint16Array(rows.length);
  const stateIndexes = new Uint16Array(rows.length);
  const states = new Float64Array(
    expectedPropagatedRows * rowStateFields.length,
  );
  const reasons = [""];
  const reasonIndexes = new Map<string, number>();
  let propagatedIndex = 0;

  for (let index = 0; index < rows.length; index++) {
    const row: StellarMotionBatchRow = rows[index];
    if (
      !row ||
      typeof row !== "object" ||
      row.sourceId !== sourceIds[index].toString()
    ) {
      throw new Error("Stellar motion result source identity mismatch");
    }
    const status = Object.hasOwn(rowStatusCode, row.status)
      ? rowStatusCode[row.status]
      : undefined;
    if (status === undefined)
      throw new Error("Invalid stellar motion result status");
    statuses[index] = status;

    if (row.status === "propagated") {
      if (
        row.reason !== undefined ||
        !row.state ||
        (row.zeroRadialMotionAssumed !== undefined &&
          typeof row.zeroRadialMotionAssumed !== "boolean")
      )
        throw new Error("Invalid propagated stellar motion row");
      zeroRadialMotionAssumptions[index] =
        row.zeroRadialMotionAssumed === true ? 1 : 0;
      if (
        propagatedIndex >= expectedPropagatedRows ||
        propagatedIndex >= 0xfffe
      )
        throw new Error(
          "Propagated stellar motion states exceed their row budget",
        );
      stateIndexes[index] = ++propagatedIndex;
      const offset = (propagatedIndex - 1) * rowStateFields.length;
      for (let field = 0; field < rowStateFields.length; field++) {
        const value = row.state[rowStateFields[field]];
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new Error("Invalid propagated stellar motion state");
        states[offset + field] = value;
      }
      continue;
    }

    if (
      row.state !== undefined ||
      row.zeroRadialMotionAssumed !== undefined ||
      typeof row.reason !== "string" ||
      row.reason.length === 0
    ) {
      throw new Error("Invalid unavailable stellar motion row");
    }
    let reasonCode = reasonIndexes.get(row.reason);
    if (reasonCode === undefined) {
      if (reasons.length > 0xffff)
        throw new Error(
          "Stellar motion reason dictionary exceeds its row budget",
        );
      reasonCode = reasons.length;
      reasonIndexes.set(row.reason, reasonCode);
      reasons.push(row.reason);
    }
    reasonCodes[index] = reasonCode;
  }

  if (propagatedIndex !== expectedPropagatedRows)
    throw new Error("Propagated stellar motion row count mismatch");
  return {
    sourceIds,
    statuses,
    zeroRadialMotionAssumptions,
    reasonCodes,
    stateIndexes,
    reasons,
    states,
  };
}

export function compactStellarMotionTileReceipt(
  receipt: StellarMotionTileReceipt,
  sourceIds: BigInt64Array<ArrayBuffer>,
) {
  const rows = compactStellarMotionRows(
    receipt.motion.rows,
    sourceIds,
    receipt.motion.propagatedRows,
  );
  const { rows: _rows, ...motion } = receipt.motion;
  void _rows;
  return { receipt: { ...receipt, motion }, rows };
}

export function expandStellarMotionRow(
  rows: CompactStellarMotionRows,
  index: number,
): StellarMotionBatchRow | null {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= rows.sourceIds.length
  )
    return null;
  const sourceId = rows.sourceIds[index];
  if (sourceId <= 0n) return null;
  const status = rowStatusName[rows.statuses[index]];
  if (!status) return null;
  const zeroRadialMotionAssumed = rows.zeroRadialMotionAssumptions[index];
  if (
    zeroRadialMotionAssumed > 1 ||
    (zeroRadialMotionAssumed === 1 && status !== "propagated")
  )
    return null;
  const row: StellarMotionBatchRow = {
    sourceId: sourceId.toString(),
    status,
  };
  if (zeroRadialMotionAssumed === 1) row.zeroRadialMotionAssumed = true;
  const reasonCode = rows.reasonCodes[index];
  if (reasonCode > 0) {
    const reason = rows.reasons[reasonCode];
    if (typeof reason !== "string" || !reason) return null;
    row.reason = reason;
  }
  if (status === "propagated") {
    const stateIndex = rows.stateIndexes[index];
    if (
      stateIndex < 1 ||
      stateIndex > rows.states.length / rowStateFields.length
    )
      return null;
    const offset = (stateIndex - 1) * rowStateFields.length;
    const state = {} as NonNullable<StellarMotionBatchRow["state"]>;
    for (let field = 0; field < rowStateFields.length; field++) {
      const value = rows.states[offset + field];
      if (!Number.isFinite(value)) return null;
      state[rowStateFields[field]] = value;
    }
    if (reasonCode !== 0) return null;
    row.state = state;
  } else if (reasonCode === 0 || rows.stateIndexes[index] !== 0) {
    return null;
  }
  return row;
}

export function expandStellarMotionTileReceipt(
  receipt: CompactStellarMotionTileReceipt,
  rows: CompactStellarMotionRows,
): StellarMotionTileReceipt {
  const expanded = new Array<StellarMotionBatchRow>(rows.sourceIds.length);
  for (let index = 0; index < expanded.length; index++) {
    const row = expandStellarMotionRow(rows, index);
    if (!row)
      throw new Error("Compact stellar motion result cannot be reconstructed");
    expanded[index] = row;
  }
  return { ...receipt, motion: { ...receipt.motion, rows: expanded } };
}

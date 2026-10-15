/** The pinned MPCORB snapshot suggests exact H=99.99 is unavailable; MPC does not document this sentinel. */
export const MPC_UNKNOWN_ABSOLUTE_MAGNITUDE = 99.99

export function normalizeCatalogAbsoluteMagnitude(value: number | undefined): number | undefined {
  return value === MPC_UNKNOWN_ABSOLUTE_MAGNITUDE ? undefined : value
}

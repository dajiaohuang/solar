/** Whole append request, including source preparation and upload acknowledgement.
 * Subsequent whole-catalog epoch reconciliation is a separate existing job. */
export const CATALOG_APPEND_TIMEOUT_MS = 300_000

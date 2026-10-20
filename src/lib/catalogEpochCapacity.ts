/** Keep at most two temporal position tiles in flight across worker and renderer. */
export const CATALOG_EPOCH_UPLOAD_SLOTS = 2
export const CATALOG_EPOCH_TILE_ROWS = 1024
/** Transport batches may span several independent temporal-error blocks. */
export const CATALOG_EPOCH_TRANSFER_ROWS = 8192

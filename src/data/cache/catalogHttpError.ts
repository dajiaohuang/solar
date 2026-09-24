/** Keep transport status separate from parse, integrity and timeout failures. */
export class CatalogHttpError extends Error {
  readonly url: string
  readonly status: number
  constructor(url: string, status: number) {
    super(`Failed to load ${url}: ${status}`)
    this.url = url
    this.status = status
    this.name = 'CatalogHttpError'
  }
}

export function isMissingCatalogArtifact(error: unknown): boolean {
  return error instanceof CatalogHttpError && error.status === 404
}

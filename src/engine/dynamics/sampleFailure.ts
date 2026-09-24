/** Known trajectory-specific domain/numerical failure. Source and programming
 * errors must remain job failures rather than invalidating a sampled draw. */
export class DynamicsSampleError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'DynamicsSampleError'
  }
}

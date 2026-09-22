export type CatalogPointFrame = {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  radius: number
  opacity: number
}

function createProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create catalog program')
  const shaders: WebGLShader[] = []
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, `
        attribute vec2 a_position;
        attribute vec3 a_color;
        attribute float a_size;
        uniform float u_radius;
        uniform float u_aspect;
        uniform float u_pixel_ratio;
        varying vec3 v_color;
        void main() {
          gl_Position = vec4(a_position.x / (u_radius * u_aspect), a_position.y / u_radius, 0.0, 1.0);
          gl_PointSize = a_size * u_pixel_ratio;
          v_color = a_color;
        }
      `],
      [gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec3 v_color;
        uniform float u_opacity;
        void main() {
          vec2 delta = gl_PointCoord - vec2(0.5);
          if (dot(delta, delta) > 0.25) discard;
          gl_FragColor = vec4(v_color, u_opacity);
        }
      `],
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Unable to create catalog shader')
      shaders.push(shader)
      gl.shaderSource(shader, source); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Catalog shader compilation failed')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Catalog program link failed')
    return program
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  } finally {
    for (const shader of shaders) gl.deleteShader(shader)
  }
}

/** One canvas owns these resources. Input arrays are immutable snapshots. */
export function createCatalogPointRenderer(gl: WebGLRenderingContext, capacity?: number) {
  if (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity < 0)) throw new Error('Invalid catalog GPU capacity')
  const program = createProgram(gl)
  const buffers: { handle: WebGLBuffer; data: Float32Array | null }[] = []
  let disposed = false
  let retainedCount = 0
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const buffer of buffers) { gl.deleteBuffer(buffer.handle); buffer.data = null }
    gl.deleteProgram(program)
  }
  try {
    gl.useProgram(program)
    for (const [name, size] of [['a_position', 2], ['a_color', 3], ['a_size', 1]] as const) {
      const handle = gl.createBuffer()
      if (!handle) throw new Error('Unable to allocate catalog GPU buffers')
      buffers.push({ handle, data: null })
      const location = gl.getAttribLocation(program, name)
      gl.bindBuffer(gl.ARRAY_BUFFER, handle)
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      if (capacity !== undefined) gl.bufferData(gl.ARRAY_BUFFER, capacity * size * 4, gl.STATIC_DRAW)
    }
    const uniforms = ['u_radius', 'u_aspect', 'u_pixel_ratio', 'u_opacity'].map(name => gl.getUniformLocation(program, name))
    const drawRetained = (radius: number, opacity: number, width: number, height: number, pixelRatio: number, count: number) => {
      gl.useProgram(program)
      gl.viewport(0, 0, width, height)
      gl.clearColor(0.018, 0.028, 0.043, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1f(uniforms[0], Math.max(radius, 0.001))
      gl.uniform1f(uniforms[1], width / Math.max(height, 1))
      gl.uniform1f(uniforms[2], pixelRatio)
      gl.uniform1f(uniforms[3], opacity)
      gl.drawArrays(gl.POINTS, 0, count)
    }
    return {
      /** Fixed-capacity streaming: append only the newly computed shard. */
      append(attributes: Pick<CatalogPointFrame, 'positions' | 'colors' | 'sizes'>) {
        if (disposed) throw new Error('Catalog GPU renderer is disposed')
        const count = attributes.sizes.length
        if (capacity === undefined || retainedCount + count > capacity) throw new Error('Catalog GPU capacity exceeded')
        if (attributes.positions.length !== count * 2 || attributes.colors.length !== count * 3) throw new Error('Mismatched catalog point attributes')
        for (const [index, data] of [attributes.positions, attributes.colors, attributes.sizes].entries()) {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers[index].handle)
          gl.bufferSubData(gl.ARRAY_BUFFER, retainedCount * [2, 3, 1][index] * 4, data as Float32Array<ArrayBuffer>)
        }
        retainedCount += count
        return retainedCount
      },
      drawRetained(radius: number, opacity: number, width: number, height: number, pixelRatio: number) {
        if (!disposed) drawRetained(radius, opacity, width, height, pixelRatio, retainedCount)
      },
      draw(frame: CatalogPointFrame, width: number, height: number, pixelRatio: number) {
        if (disposed) return
        if (capacity !== undefined) throw new Error('Use append for a fixed-capacity catalog renderer')
        const count = frame.sizes.length
        if (frame.positions.length !== count * 2 || frame.colors.length !== count * 3) throw new Error('Mismatched catalog point attributes')
        gl.useProgram(program)
        const attributes = [frame.positions, frame.colors, frame.sizes]
        buffers.forEach((buffer, index) => {
          const data = attributes[index]
          if (buffer.data === data) return
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer.handle)
          // Retain objects across epochs. A resized dataset gets an exact-sized
          // store, so a large former selection cannot pin excess GPU capacity.
          if (buffer.data?.byteLength !== data.byteLength) gl.bufferData(gl.ARRAY_BUFFER, data as Float32Array<ArrayBuffer>, index === 0 ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW)
          else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data as Float32Array<ArrayBuffer>)
          buffer.data = data
        })
        drawRetained(frame.radius, frame.opacity, width, height, pixelRatio, count)
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}

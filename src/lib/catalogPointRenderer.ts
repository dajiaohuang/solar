import { catalogProjection, type CatalogRotation } from './catalogProjection'

export type CatalogPointFrame = {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  radius: number
  opacity: number
}

function hasOnlyFiniteValues(values: Float32Array) {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) return false
  }
  return true
}

function createProgram(gl: WebGLRenderingContext, dimensions: 2 | 3) {
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create catalog program')
  const shaders: WebGLShader[] = []
  try {
    for (const [type, source] of [
      [gl.VERTEX_SHADER, `
        attribute vec${dimensions} a_position;
        attribute vec3 a_color;
        attribute float a_size;
        uniform float u_radius;
        uniform float u_aspect;
        uniform float u_pixel_ratio;
        ${dimensions === 3 ? 'uniform vec3 u_projection_x; uniform vec3 u_projection_y;' : ''}
        varying vec3 v_color;
        void main() {
          ${dimensions === 3 ? 'vec2 projected = vec2(dot(u_projection_x, a_position), dot(u_projection_y, a_position));' : 'vec2 projected = a_position;'}
          gl_Position = vec4(projected.x / (u_radius * u_aspect), projected.y / u_radius, 0.0, 1.0);
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
export function createCatalogPointRenderer(gl: WebGLRenderingContext, capacity?: number, dimensions: 2 | 3 = 2) {
  if (capacity !== undefined && (!Number.isSafeInteger(capacity) || capacity < 0)) throw new Error('Invalid catalog GPU capacity')
  if (dimensions !== 2 && dimensions !== 3) throw new Error('Invalid catalog GPU coordinate dimension')
  const checkGpu = () => {
    if (gl.isContextLost()) throw new Error('Catalog WebGL context is lost')
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Catalog GPU allocation, upload or draw failed')
  }
  const validateAttribute = (data: Float32Array) => {
    if (!(data instanceof Float32Array) || !hasOnlyFiniteValues(data)) throw new Error('Invalid catalog GPU display attributes')
  }
  const program = createProgram(gl, dimensions)
  const buffers: { handle: WebGLBuffer; data: Float32Array | null }[] = []
  let disposed = false
  let retainedCount = 0
  let positionsCoherent = true, updatingPositions = false, updatedRows = 0
  let elementBuffer: WebGLBuffer | null = null
  // -1 distinguishes a new buffer from an allocated zero-length selection.
  let elementCapacityBytes = -1
  let selection: Uint32Array | null = null
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const buffer of buffers) { gl.deleteBuffer(buffer.handle); buffer.data = null }
    if (elementBuffer) gl.deleteBuffer(elementBuffer)
    elementBuffer = null; elementCapacityBytes = -1; selection = null
    retainedCount = 0; updatedRows = 0; positionsCoherent = false; updatingPositions = false
    gl.deleteProgram(program)
  }
  try {
    gl.useProgram(program)
    for (const [name, size] of [['a_position', dimensions], ['a_color', 3], ['a_size', 1]] as const) {
      const handle = gl.createBuffer()
      if (!handle) throw new Error('Unable to allocate catalog GPU buffers')
      buffers.push({ handle, data: null })
      const location = gl.getAttribLocation(program, name)
      gl.bindBuffer(gl.ARRAY_BUFFER, handle)
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      if (capacity !== undefined) gl.bufferData(gl.ARRAY_BUFFER, capacity * size * 4, name === 'a_position' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW)
    }
    checkGpu()
    const uniforms = ['u_radius', 'u_aspect', 'u_pixel_ratio', 'u_opacity'].map(name => gl.getUniformLocation(program, name))
    const projectionUniforms = dimensions === 3 ? ['u_projection_x','u_projection_y'].map(name => gl.getUniformLocation(program,name)) : []
    const drawRetained = (radius: number, opacity: number, width: number, height: number, pixelRatio: number, count: number, rotation?: CatalogRotation) => {
      const projection = dimensions === 3 ? catalogProjection(rotation ?? { azimuthDegrees: 0,tiltDegrees: 0 }) : null
      gl.useProgram(program)
      gl.viewport(0, 0, width, height)
      gl.clearColor(0.018, 0.028, 0.043, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      // An in-place epoch update cannot preserve the former full frame. Keep
      // it blank until every retained row belongs to one completed epoch.
      if (!positionsCoherent) { checkGpu(); return }
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniform1f(uniforms[0], Math.max(radius, 0.001))
      gl.uniform1f(uniforms[1], width / Math.max(height, 1))
      gl.uniform1f(uniforms[2], pixelRatio)
      gl.uniform1f(uniforms[3], opacity)
      if (projection) for (let i = 0; i < 2; i++) gl.uniform3f(projectionUniforms[i],projection[i][0],projection[i][1],projection[i][2])
      if (selection) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer)
        gl.drawElements(gl.POINTS, selection.length, gl.UNSIGNED_INT, 0)
      } else gl.drawArrays(gl.POINTS, 0, count)
      // Camera/resize redraws may upload nothing. Validate the actual draw
      // before callers mark a frame presented or acknowledge restoration.
      checkGpu()
    }
    return {
      setSpatialSelection(indices: Uint32Array | null) {
        if (disposed) return
        if (capacity === undefined) throw new Error('Spatial selection requires a retained catalog')
        if (indices === null) { selection = null; return }
        if (!positionsCoherent) throw new Error('Spatial selection requires a coherent catalog epoch')
        for (let i = 0; i < indices.length; i++) {
          if (indices[i] >= retainedCount || i > 0 && indices[i] <= indices[i - 1]) throw new Error('Invalid catalog spatial indices')
        }
        if (!elementBuffer) {
          if (!gl.getExtension('OES_element_index_uint')) throw new Error('Spatial catalog display requires 32-bit element indices')
          elementBuffer = gl.createBuffer()
          if (!elementBuffer) throw new Error('Unable to allocate catalog spatial indices')
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elementBuffer)
        // Clearing a view or beginning an epoch invalidates its selection, not
        // the allocation. Keep the high-water capacity across smaller views;
        // drawElements below still uses only the current selection's length.
        // Strictly increasing indices below retainedCount bound this storage
        // to capacity * 4 bytes, already reserved by the stream planner.
        if (indices.byteLength > elementCapacityBytes) {
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices as Uint32Array<ArrayBuffer>, gl.DYNAMIC_DRAW)
          elementCapacityBytes = indices.byteLength
        } else if (indices.byteLength) {
          gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices as Uint32Array<ArrayBuffer>)
        }
        selection = indices
      },
      /** Fixed-capacity streaming: append only the newly computed shard. */
      append(attributes: Pick<CatalogPointFrame, 'positions' | 'colors' | 'sizes'>) {
        if (disposed) throw new Error('Catalog GPU renderer is disposed')
        if (!positionsCoherent || updatingPositions) throw new Error('Cannot append during an incomplete catalog epoch')
        const count = attributes.sizes.length
        if (capacity === undefined || retainedCount + count > capacity) throw new Error('Catalog GPU capacity exceeded')
        if (attributes.positions.length !== count * dimensions || attributes.colors.length !== count * 3) throw new Error('Mismatched catalog point attributes')
        for (const [index, data] of [attributes.positions, attributes.colors, attributes.sizes].entries()) {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffers[index].handle)
          gl.bufferSubData(gl.ARRAY_BUFFER, retainedCount * [dimensions, 3, 1][index] * 4, data as Float32Array<ArrayBuffer>)
        }
        retainedCount += count
        return retainedCount
      },
      /** Starts/restarts an in-place replacement. No full-size second GPU
       * frame is allocated; incomplete frames are hidden, never rolled back. */
      beginPositionUpdate() {
        if (disposed || capacity === undefined) throw new Error('Position updates require a retained catalog renderer')
        positionsCoherent = false; updatingPositions = true; updatedRows = 0
        selection = null
        gl.clearColor(0.018, 0.028, 0.043, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      },
      replacePositions(startRow: number, positions: Float32Array) {
        if (disposed || !updatingPositions || capacity === undefined) throw new Error('No catalog position update is active')
        if (!(positions instanceof Float32Array)) throw new Error('Catalog GPU positions must be Float32 display coordinates')
        const rows = positions.length/dimensions
        if (!Number.isSafeInteger(startRow) || startRow !== updatedRows || !Number.isSafeInteger(rows) || rows < 1 || startRow+rows > retainedCount ||
            !hasOnlyFiniteValues(positions)) throw new Error('Invalid contiguous catalog position update')
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers[0].handle)
        gl.bufferSubData(gl.ARRAY_BUFFER, startRow*dimensions*4, positions as Float32Array<ArrayBuffer>)
        updatedRows += rows
      },
      finishPositionUpdate() {
        if (disposed || !updatingPositions || updatedRows !== retainedCount) throw new Error('Catalog epoch ended before every row was replaced')
        checkGpu()
        updatingPositions = false; positionsCoherent = true
      },
      /** An explicitly admitted temporal approximation may retain this range.
       * The caller owns its source epoch/error receipt and must verify it. */
      retainPositions(startRow: number, rows: number) {
        if (disposed || !updatingPositions || !Number.isSafeInteger(startRow) || startRow !== updatedRows ||
            !Number.isSafeInteger(rows) || rows < 1 || startRow+rows > retainedCount) throw new Error('Invalid contiguous catalog reused range')
        updatedRows += rows
      },
      invalidatePositions() {
        if (disposed || capacity === undefined) return
        positionsCoherent = false; updatingPositions = false; updatedRows = 0; selection = null
        gl.clearColor(0.018, 0.028, 0.043, 1); gl.clear(gl.COLOR_BUFFER_BIT)
      },
      drawRetained(radius: number, opacity: number, width: number, height: number, pixelRatio: number, rotation?: CatalogRotation) {
        if (!disposed) drawRetained(radius, opacity, width, height, pixelRatio, retainedCount, rotation)
      },
      draw(frame: CatalogPointFrame, width: number, height: number, pixelRatio: number) {
        if (disposed) return
        if (capacity !== undefined) throw new Error('Use append for a fixed-capacity catalog renderer')
        const count = frame.sizes.length
        if (frame.positions.length !== count * dimensions || frame.colors.length !== count * 3) throw new Error('Mismatched catalog point attributes')
        gl.useProgram(program)
        const attributes = [frame.positions, frame.colors, frame.sizes]
        let uploaded = false
        buffers.forEach((buffer, index) => {
          const data = attributes[index]
          if (buffer.data === data) return
          validateAttribute(data)
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer.handle)
          // Retain objects across epochs. A resized dataset gets an exact-sized
          // store, so a large former selection cannot pin excess GPU capacity.
          if (buffer.data?.byteLength !== data.byteLength) gl.bufferData(gl.ARRAY_BUFFER, data as Float32Array<ArrayBuffer>, index === 0 ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW)
          else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data as Float32Array<ArrayBuffer>)
          uploaded = true
        })
        // One check per changed snapshot, not per attribute or camera redraw.
        // Failed uploads must not enter the immutable-array identity cache.
        if (uploaded) {
          checkGpu()
          buffers.forEach((buffer, index) => { buffer.data = attributes[index] })
        }
        drawRetained(frame.radius, frame.opacity, width, height, pixelRatio, count)
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}

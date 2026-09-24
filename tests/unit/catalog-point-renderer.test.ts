import { describe, expect, it, vi } from 'vitest'
import { createCatalogPointRenderer, type CatalogPointFrame } from '../../src/lib/catalogPointRenderer'

function context() {
  const calls = {
    isContextLost: vi.fn(() => false), getError: vi.fn(() => 0), NO_ERROR: 0,
    createProgram: vi.fn(() => ({})), createShader: vi.fn(() => ({})), createBuffer: vi.fn((): object | null => ({})),
    getShaderParameter: vi.fn(() => true), getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => 'compile error'), getProgramInfoLog: vi.fn(() => 'link error'),
    shaderSource: vi.fn(), compileShader: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(),
    deleteShader: vi.fn(), deleteProgram: vi.fn(), deleteBuffer: vi.fn(),
    useProgram: vi.fn(), getAttribLocation: vi.fn(() => 0), getUniformLocation: vi.fn(() => ({})),
    bindBuffer: vi.fn(), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    bufferData: vi.fn(), bufferSubData: vi.fn(), viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(),
    enable: vi.fn(), blendFunc: vi.fn(), uniform1f: vi.fn(), uniform3f: vi.fn(), drawArrays: vi.fn(), drawElements: vi.fn(), getExtension: vi.fn((): object | null => ({})),
    ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2, STATIC_DRAW: 3, POINTS: 4,
    ELEMENT_ARRAY_BUFFER: 5, UNSIGNED_INT: 6,
  }
  return { calls, gl: calls as unknown as WebGLRenderingContext }
}

const frame = (count = 3): CatalogPointFrame => ({ positions: new Float32Array(count * 2), colors: new Float32Array(count * 3), sizes: new Float32Array(count), radius: 10, opacity: 0.82 })

describe('persistent catalog GPU ownership', () => {
  it('keeps a partially replaced epoch hidden and rejects failed GPU completion', () => {
    const { gl,calls } = context(), renderer = createCatalogPointRenderer(gl,3)
    renderer.append(frame(3))
    renderer.drawRetained(10,.8,800,600,1)
    calls.drawArrays.mockClear()
    renderer.beginPositionUpdate()
    renderer.replacePositions(0,new Float32Array([1,2]))
    renderer.drawRetained(10,.8,800,600,1)
    expect(calls.drawArrays).not.toHaveBeenCalled()
    expect(() => renderer.finishPositionUpdate()).toThrow('every row')
    renderer.retainPositions(1,2)
    calls.getError.mockReturnValueOnce(1285)
    expect(() => renderer.finishPositionUpdate()).toThrow('GPU')
    renderer.drawRetained(10,.8,800,600,1)
    expect(calls.drawArrays).not.toHaveBeenCalled()
    renderer.beginPositionUpdate()
    renderer.replacePositions(0,new Float32Array(6))
    renderer.finishPositionUpdate()
    renderer.drawRetained(10,.8,800,600,1)
    expect(calls.drawArrays).toHaveBeenCalledTimes(1)
  })

  it('does not cache failed sample attribute uploads and reports context loss', () => {
    const { gl,calls } = context(), renderer = createCatalogPointRenderer(gl)
    const snapshot = frame(2)
    calls.getError.mockReturnValueOnce(1285)
    expect(() => renderer.draw(snapshot,800,600,1)).toThrow('GPU')
    calls.bufferData.mockClear()
    renderer.draw(snapshot,800,600,1)
    expect(calls.bufferData).toHaveBeenCalledTimes(3)
    calls.isContextLost.mockReturnValue(true)
    expect(() => renderer.draw(snapshot,800,600,1)).toThrow('context is lost')
  })

  it('retains all three coordinates and rotates only display uniforms without reuploading attributes', () => {
    const { gl,calls } = context(), renderer = createCatalogPointRenderer(gl,3,3)
    expect(calls.bufferData.mock.calls.map(call => call[1])).toEqual([36,36,12])
    renderer.append({ positions: new Float32Array([1,2,3,4,5,6,7,8,9]),colors: new Float32Array(9),sizes: new Float32Array(3) })
    renderer.drawRetained(10,.8,800,600,1,{azimuthDegrees: 0,tiltDegrees: 0})
    renderer.drawRetained(10,.8,800,600,1,{azimuthDegrees: 0,tiltDegrees: 90})
    expect(calls.bufferData).toHaveBeenCalledTimes(3)
    expect(calls.bufferSubData).toHaveBeenCalledTimes(3)
    const vertical = calls.uniform3f.mock.calls.at(-1)!
    expect(vertical[1]).toBe(0)
    expect(Math.abs(vertical[2])).toBeLessThan(1e-15)
    expect(vertical[3]).toBe(-1)
    expect(calls.drawArrays).toHaveBeenLastCalledWith(gl.POINTS,0,3)
    renderer.dispose()
  })
  it('changes spatial indices without reallocating source attributes and restores full drawing', () => {
    const { gl, calls } = context(), renderer = createCatalogPointRenderer(gl, 3)
    renderer.append(frame(3))
    renderer.setSpatialSelection(new Uint32Array([0, 2]))
    renderer.drawRetained(5, .8, 800, 600, 1)
    expect(calls.drawElements).toHaveBeenLastCalledWith(gl.POINTS, 2, gl.UNSIGNED_INT, 0)
    expect(calls.createBuffer).toHaveBeenCalledTimes(4)
    const allocations = calls.bufferData.mock.calls.length
    renderer.setSpatialSelection(new Uint32Array([1, 2]))
    expect(calls.bufferData).toHaveBeenCalledTimes(allocations)
    expect(calls.bufferSubData).toHaveBeenLastCalledWith(gl.ELEMENT_ARRAY_BUFFER, 0, new Uint32Array([1, 2]))
    for (const indices of [[3], [1, 0], [1, 1]]) expect(() => renderer.setSpatialSelection(new Uint32Array(indices))).toThrow('indices')
    renderer.setSpatialSelection(null)
    renderer.drawRetained(5, .8, 800, 600, 1)
    expect(calls.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 3)
    renderer.dispose(); expect(calls.deleteBuffer).toHaveBeenCalledTimes(4)
  })
  it('reports missing spatial index capability before allocating an index buffer', () => {
    const { gl, calls } = context(), renderer = createCatalogPointRenderer(gl, 3)
    calls.getExtension.mockReturnValue(null)
    expect(() => renderer.setSpatialSelection(new Uint32Array())).toThrow('32-bit')
    expect(calls.createBuffer).toHaveBeenCalledTimes(3)
    renderer.dispose()
  })
  it('allocates streaming capacity once, uploads only the new ranges, and rejects overflow without a partial upload', () => {
    const { gl, calls } = context(), renderer = createCatalogPointRenderer(gl, 5)
    expect(calls.bufferData.mock.calls.map(call => call[1])).toEqual([40, 60, 20])
    renderer.append(frame(3)); renderer.append(frame(2))
    expect(calls.bufferData).toHaveBeenCalledTimes(3)
    expect(calls.bufferSubData.mock.calls.map(call => call[1])).toEqual([0, 0, 0, 24, 36, 12])
    renderer.drawRetained(50, .82, 800, 600, 1)
    expect(calls.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 5)
    expect(() => renderer.append(frame(1))).toThrow('capacity')
    expect(calls.bufferSubData).toHaveBeenCalledTimes(6)
    renderer.dispose()
    expect(calls.deleteBuffer).toHaveBeenCalledTimes(3)
  })
  it('resizes and changes uniforms without uploading or recompiling unchanged data', () => {
    const { gl, calls } = context(), renderer = createCatalogPointRenderer(gl), original = frame()
    renderer.draw(original, 800, 600, 1)
    renderer.draw({ ...original, radius: 20, opacity: 0.4 }, 1000, 600, 2)
    expect(calls.createProgram).toHaveBeenCalledTimes(1)
    expect(calls.createBuffer).toHaveBeenCalledTimes(3)
    expect(calls.bufferData).toHaveBeenCalledTimes(3)
    expect(calls.bufferSubData).not.toHaveBeenCalled()
    expect(calls.uniform1f.mock.calls.slice(-4).map(call => call[1])).toEqual([20, 1000 / 600, 2, 0.4])
    const advanced = { ...original, positions: new Float32Array(6).fill(1) }
    renderer.draw(advanced, 1000, 600, 2)
    expect(calls.bufferData).toHaveBeenCalledTimes(3)
    expect(calls.bufferSubData).toHaveBeenCalledExactlyOnceWith(gl.ARRAY_BUFFER, 0, advanced.positions)
    renderer.dispose(); renderer.dispose()
    expect(calls.deleteBuffer).toHaveBeenCalledTimes(3)
    expect(calls.deleteProgram).toHaveBeenCalledTimes(1)
    renderer.draw(original, 800, 600, 1)
    expect(calls.drawArrays).toHaveBeenCalledTimes(3)
  })
  it('shrinks all backing stores and never draws a stale tail from a larger selection', () => {
    const { gl, calls } = context(), renderer = createCatalogPointRenderer(gl)
    renderer.draw(frame(100), 800, 600, 1)
    renderer.draw(frame(1), 800, 600, 1)
    expect(calls.bufferData.mock.calls.slice(-3).map(call => call[1].byteLength)).toEqual([8, 12, 4])
    expect(calls.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 1)
    renderer.draw(frame(0), 800, 600, 1)
    expect(calls.drawArrays).toHaveBeenLastCalledWith(gl.POINTS, 0, 0)
  })
  it('rejects mismatched buffers before uploading or drawing them', () => {
    const { gl, calls } = context(), renderer = createCatalogPointRenderer(gl)
    expect(() => renderer.draw({ ...frame(), positions: new Float32Array(2) }, 800, 600, 1)).toThrow('Mismatched')
    expect(calls.bufferData).not.toHaveBeenCalled()
    expect(calls.drawArrays).not.toHaveBeenCalled()
  })
  it('releases partial initialization after allocation failure', () => {
    const { gl, calls } = context()
    calls.createBuffer.mockReturnValueOnce({}).mockReturnValueOnce(null)
    expect(() => createCatalogPointRenderer(gl)).toThrow('allocate')
    expect(calls.deleteBuffer).toHaveBeenCalledTimes(1)
    expect(calls.deleteProgram).toHaveBeenCalledTimes(1)
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
  })
  it('releases compiled shaders and program after link failure', () => {
    const { gl, calls } = context()
    calls.getProgramParameter.mockReturnValue(false)
    expect(() => createCatalogPointRenderer(gl)).toThrow('link error')
    expect(calls.deleteShader).toHaveBeenCalledTimes(2)
    expect(calls.deleteProgram).toHaveBeenCalledTimes(1)
    expect(calls.createBuffer).not.toHaveBeenCalled()
  })
})

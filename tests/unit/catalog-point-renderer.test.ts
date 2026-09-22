import { describe, expect, it, vi } from 'vitest'
import { createCatalogPointRenderer, type CatalogPointFrame } from '../../src/lib/catalogPointRenderer'

function context() {
  const calls = {
    createProgram: vi.fn(() => ({})), createShader: vi.fn(() => ({})), createBuffer: vi.fn((): object | null => ({})),
    getShaderParameter: vi.fn(() => true), getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => 'compile error'), getProgramInfoLog: vi.fn(() => 'link error'),
    shaderSource: vi.fn(), compileShader: vi.fn(), attachShader: vi.fn(), linkProgram: vi.fn(),
    deleteShader: vi.fn(), deleteProgram: vi.fn(), deleteBuffer: vi.fn(),
    useProgram: vi.fn(), getAttribLocation: vi.fn(() => 0), getUniformLocation: vi.fn(() => ({})),
    bindBuffer: vi.fn(), enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(),
    bufferData: vi.fn(), bufferSubData: vi.fn(), viewport: vi.fn(), clearColor: vi.fn(), clear: vi.fn(),
    enable: vi.fn(), blendFunc: vi.fn(), uniform1f: vi.fn(), drawArrays: vi.fn(),
    ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2, STATIC_DRAW: 3, POINTS: 4,
  }
  return { calls, gl: calls as unknown as WebGLRenderingContext }
}

const frame = (count = 3): CatalogPointFrame => ({ positions: new Float32Array(count * 2), colors: new Float32Array(count * 3), sizes: new Float32Array(count), radius: 10, opacity: 0.82 })

describe('persistent catalog GPU ownership', () => {
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

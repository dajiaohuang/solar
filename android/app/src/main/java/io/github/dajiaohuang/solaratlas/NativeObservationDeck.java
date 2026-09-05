package io.github.dajiaohuang.solaratlas;

import android.content.Context;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.view.MotionEvent;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.concurrent.CancellationException;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/** Platform GLES point renderer. Scientific state preparation stays outside the GL thread. */
public final class NativeObservationDeck extends GLSurfaceView {
    private final DeckRenderer renderer;
    private float lastX;
    private float lastY;
    private float pinchStartDistance;
    private float pinchStartZoom;

    public NativeObservationDeck(Context context) {
        super(context);
        setEGLContextClientVersion(2);
        renderer = new DeckRenderer();
        setRenderer(renderer);
        setRenderMode(GLSurfaceView.RENDERMODE_WHEN_DIRTY);
        setFocusable(true);
        setContentDescription("Verified state GPU point observation viewport");
    }

    public void setPrepared(PreparedPoints prepared) {
        queueEvent(() -> renderer.setPrepared(prepared));
        requestRender();
    }

    public void clearPoints() {
        queueEvent(renderer::clearPoints);
        requestRender();
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                lastX = event.getX(); lastY = event.getY(); return true;
            case MotionEvent.ACTION_POINTER_DOWN:
                if (event.getPointerCount() >= 2) { pinchStartDistance = distance(event); pinchStartZoom = renderer.zoom; }
                return true;
            case MotionEvent.ACTION_MOVE:
                if (event.getPointerCount() >= 2 && pinchStartDistance > 0) {
                    renderer.zoom = clamp(pinchStartZoom * distance(event) / pinchStartDistance, 0.2f, 4.0f);
                } else if (renderer.mode3d) {
                    float dx = event.getX() - lastX, dy = event.getY() - lastY;
                    renderer.rotationY += dx * 0.6f; renderer.rotationX = clamp(renderer.rotationX + dy * 0.6f, -89.0f, 89.0f);
                    lastX = event.getX(); lastY = event.getY();
                }
                requestRender(); return true;
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                pinchStartDistance = 0; return true;
            default: return true;
        }
    }

    private static float distance(MotionEvent event) {
        float dx = event.getX(0) - event.getX(1), dy = event.getY(0) - event.getY(1);
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    private static float clamp(float value, float low, float high) { return Math.max(low, Math.min(high, value)); }

    /** Prepared on the load worker: all subtraction is Float64 before conversion to GPU Float32. */
    public static final class PreparedPoints {
        final FloatBuffer positions;
        final int displayedCount;
        final int candidateCount;
        final int displayLimit;
        final boolean referenceAvailable;
        final boolean mode3d;

        private PreparedPoints(FloatBuffer positions, int displayedCount, int candidateCount, int displayLimit, boolean referenceAvailable, boolean mode3d) {
            this.positions = positions; this.displayedCount = displayedCount; this.candidateCount = candidateCount;
            this.displayLimit = displayLimit; this.referenceAvailable = referenceAvailable;
            this.mode3d = mode3d;
        }
    }

    /** Builds only the current mode's bounded GPU buffer from the immutable Float64 frame. */
    public static PreparedPoints prepare(StateTileService.Frame frame, String referenceId, boolean mode3d) {
        checkCancelled();
        if (frame.metadata.size() != frame.exact.length || frame.states.length % 6 != 0 || frame.states.length / 6 != frame.exact.length) throw new IllegalArgumentException("Incomplete render source");
        int limit = mode3d ? 250_000 : 500_000;
        int origin = -1, candidates = 0;
        for (int i = 0; i < frame.metadata.size(); i++) {
            if ((i & 1023) == 0) checkCancelled();
            if (frame.metadata.get(i).id.equals(referenceId)) origin = i;
            if (frame.exact[i]) candidates++;
        }
        if (origin < 0 || !frame.exact[origin]) return new PreparedPoints(null, 0, candidates, limit, false, mode3d);
        double ox = frame.states[origin * 6], oy = frame.states[origin * 6 + 1], oz = frame.states[origin * 6 + 2];
        double radius = 1.0;
        for (int i = 0; i < frame.exact.length; i++) {
            if ((i & 1023) == 0) checkCancelled();
            if (!frame.exact[i]) continue;
            double dx = frame.states[i * 6] - ox, dy = frame.states[i * 6 + 1] - oy, dz = frame.states[i * 6 + 2] - oz;
            if (!Double.isFinite(dx) || !Double.isFinite(dy) || !Double.isFinite(dz)) throw new IllegalArgumentException("Reference-relative coordinate exceeds numeric range");
            // A sphere, unlike an axis-aligned cube, remains in the clip depth
            // range after rotation. This changes camera fitting, not point size.
            double distance = mode3d ? Math.hypot(Math.hypot(dx, dy), dz) : Math.hypot(dx, dy);
            if (!Double.isFinite(distance)) throw new IllegalArgumentException("Reference-relative radius exceeds numeric range");
            radius = Math.max(radius, distance);
        }
        int displayed = Math.min(candidates, limit);
        FloatBuffer positions = ByteBuffer.allocateDirect(displayed * 3 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        appendPoint(positions, frame, origin, ox, oy, oz, radius, mode3d);
        int written = 1;
        for (int i = 0; i < frame.exact.length && written < displayed; i++) {
            if ((i & 1023) == 0) checkCancelled();
            if (!frame.exact[i] || i == origin) continue;
            appendPoint(positions, frame, i, ox, oy, oz, radius, mode3d); written++;
        }
        checkCancelled();
        positions.position(0);
        return new PreparedPoints(positions, displayed, candidates, limit, true, mode3d);
    }

    private static void checkCancelled() { if (Thread.currentThread().isInterrupted()) throw new CancellationException("GPU preparation cancelled"); }

    private static void appendPoint(FloatBuffer output, StateTileService.Frame frame, int index, double ox, double oy, double oz, double radius, boolean mode3d) {
        double dx = (frame.states[index * 6] - ox) / radius;
        double dy = (frame.states[index * 6 + 1] - oy) / radius;
        double dz = mode3d ? (frame.states[index * 6 + 2] - oz) / radius : 0.0;
        // Leave a small numerical margin at near/far planes after Float32 rounding.
        output.put((float) (dx * 0.95)).put((float) (dy * 0.95)).put((float) (dz * 0.95));
    }

    private static final class DeckRenderer implements GLSurfaceView.Renderer {
        private static final String VERTEX_SHADER =
                "attribute vec3 aPosition; uniform float uZoom; uniform float uRotationX; uniform float uRotationY; uniform float uAspect;" +
                "void main(){ float cx=cos(uRotationX),sx=sin(uRotationX),cy=cos(uRotationY),sy=sin(uRotationY);" +
                "vec3 y=vec3(cy*aPosition.x+sy*aPosition.z,aPosition.y,-sy*aPosition.x+cy*aPosition.z);" +
                "vec3 p=vec3(y.x,cx*y.y-sx*y.z,sx*y.y+cx*y.z); gl_Position=vec4(p.x*uZoom/uAspect,p.y*uZoom,p.z,1.0); gl_PointSize=6.0;}";
        private static final String FRAGMENT_SHADER = "precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor=uColor; }";
        private FloatBuffer points;
        private int pointCount;
        private int program;
        private int positionHandle, zoomHandle, rotationXHandle, rotationYHandle, aspectHandle, colorHandle;
        private int width = 1, height = 1;
        volatile float rotationX = 18.0f, rotationY = -25.0f, zoom = 0.85f;
        volatile boolean mode3d = true;

        @Override public void onSurfaceCreated(GL10 gl, EGLConfig config) {
            GLES20.glClearColor(0.008f, 0.02f, 0.047f, 1.0f);
            GLES20.glEnable(GLES20.GL_DEPTH_TEST);
            GLES20.glDisable(GLES20.GL_BLEND);
            program = link(VERTEX_SHADER, FRAGMENT_SHADER);
            positionHandle = GLES20.glGetAttribLocation(program, "aPosition");
            zoomHandle = GLES20.glGetUniformLocation(program, "uZoom");
            rotationXHandle = GLES20.glGetUniformLocation(program, "uRotationX");
            rotationYHandle = GLES20.glGetUniformLocation(program, "uRotationY");
            aspectHandle = GLES20.glGetUniformLocation(program, "uAspect");
            colorHandle = GLES20.glGetUniformLocation(program, "uColor");
        }

        @Override public void onSurfaceChanged(GL10 gl, int width, int height) { this.width = Math.max(1, width); this.height = Math.max(1, height); GLES20.glViewport(0, 0, this.width, this.height); }

        @Override public void onDrawFrame(GL10 gl) {
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
            if (program == 0 || points == null || pointCount == 0) return;
            GLES20.glUseProgram(program);
            GLES20.glUniform1f(zoomHandle, zoom); GLES20.glUniform1f(rotationXHandle, mode3d ? (float) Math.toRadians(rotationX) : 0); GLES20.glUniform1f(rotationYHandle, mode3d ? (float) Math.toRadians(rotationY) : 0); GLES20.glUniform1f(aspectHandle, (float) width / height);
            GLES20.glUniform4f(colorHandle, 0.384f, 0.816f, 0.710f, 1.0f);
            points.position(0); GLES20.glEnableVertexAttribArray(positionHandle); GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 3 * 4, points); GLES20.glDrawArrays(GLES20.GL_POINTS, 0, pointCount); GLES20.glDisableVertexAttribArray(positionHandle);
        }

        void setPrepared(PreparedPoints prepared) { points = prepared == null ? null : prepared.positions; pointCount = prepared == null ? 0 : prepared.displayedCount; mode3d = prepared == null || prepared.mode3d; }
        void clearPoints() { points = null; pointCount = 0; }

        private static int link(String vertexSource, String fragmentSource) {
            int vertex = compile(GLES20.GL_VERTEX_SHADER, vertexSource), fragment = compile(GLES20.GL_FRAGMENT_SHADER, fragmentSource), linked = GLES20.glCreateProgram();
            GLES20.glAttachShader(linked, vertex); GLES20.glAttachShader(linked, fragment); GLES20.glLinkProgram(linked); int[] result = new int[1]; GLES20.glGetProgramiv(linked, GLES20.GL_LINK_STATUS, result, 0);
            if (result[0] == 0) { String info = GLES20.glGetProgramInfoLog(linked); GLES20.glDeleteProgram(linked); throw new IllegalStateException("GLES program link failed: " + info); }
            GLES20.glDeleteShader(vertex); GLES20.glDeleteShader(fragment); return linked;
        }

        private static int compile(int type, String source) {
            int shader = GLES20.glCreateShader(type); GLES20.glShaderSource(shader, source); GLES20.glCompileShader(shader); int[] result = new int[1]; GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, result, 0);
            if (result[0] == 0) { String info = GLES20.glGetShaderInfoLog(shader); GLES20.glDeleteShader(shader); throw new IllegalStateException("GLES shader compile failed: " + info); }
            return shader;
        }
    }
}

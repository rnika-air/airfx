/**
 * A small shared WebGL2 runner for per-pixel effects.
 *
 * Effects that compute every pixel independently (CRT, chromatic aberration,
 * moiré, film grain) run the same maths as their CPU code in a fragment
 * shader, on one shared, hidden WebGL2 canvas. Shaders address pixels exactly
 * as the CPU loops do: integer coordinates, (0, 0) at the top left, reading
 * the source with texelFetch, so preview, export and the CPU fallback agree
 * (to rounding).
 *
 * Everything returns null when WebGL2 is missing, the context is lost, or a
 * frame is larger than the GPU allows; the caller then runs its CPU code. The
 * preview and the export use the same path on the same machine.
 */

type Uniform = number | boolean | readonly number[];
export interface Tex { tex: WebGLTexture; w: number; h: number; fbo: WebGLFramebuffer | null; float: boolean }

const VERT = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

/** Shared GLSL: pixel coordinates, exact sampling and the integer hash of imageProcessing.hash2. */
export const GLSL_COMMON = `#version 300 es
precision highp float; precision highp int;
uniform vec2 u_size; uniform bool u_screen;
out vec4 outColor;
// This pixel, as the CPU loops count them: x across, y down from the top. Only the
// screen is drawn bottom-up; render targets are stored in the same row order as the source.
ivec2 px() { int y = int(gl_FragCoord.y); return ivec2(int(gl_FragCoord.x), u_screen ? int(u_size.y) - 1 - y : y); }
vec4 at(sampler2D s, int x, int y) { ivec2 z = textureSize(s, 0); return texelFetch(s, ivec2(clamp(x, 0, z.x - 1), clamp(y, 0, z.y - 1)), 0); }
// Bilinear sample with edge clamping, 0..255 like imageProcessing.sampleBilinear.
vec4 bilinear(sampler2D s, float x, float y) {
  vec2 z = vec2(textureSize(s, 0));
  x = clamp(x, 0.0, z.x - 1.0); y = clamp(y, 0.0, z.y - 1.0);
  int x0 = int(x), y0 = int(y); int x1 = min(x0 + 1, int(z.x) - 1), y1 = min(y0 + 1, int(z.y) - 1);
  float fx = x - float(x0), fy = y - float(y0);
  vec4 top = mix(texelFetch(s, ivec2(x0, y0), 0), texelFetch(s, ivec2(x1, y0), 0), fx);
  vec4 bot = mix(texelFetch(s, ivec2(x0, y1), 0), texelFetch(s, ivec2(x1, y1), 0), fx);
  return mix(top, bot, fy) * 255.0;
}
// imageProcessing.hash2, bit for bit (32-bit wrap-around arithmetic).
float hash2(int x, int y, int seed) {
  uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(seed) * 2147483647u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  h ^= h >> 16u;
  return float(h) / 4294967296.0;
}
`;

class Gpu {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private progs = new Map<string, WebGLProgram>();
  private floatOk = false;
  private failed = false;
  private buf: WebGLBuffer | null = null;
  private pool: Tex[] = [];
  maxSize = 0;

  /** The context, created on first use; null when unavailable. */
  private ctx(): WebGL2RenderingContext | null {
    if (this.failed) return null;
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    try {
      const c = this.canvas ?? document.createElement('canvas');
      const gl = c.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false });
      if (!gl) { this.failed = true; return null; }
      c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.progs.clear(); this.pool = []; this.buf = null; }, { once: true });
      this.canvas = c; this.gl = gl;
      this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
      this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      this.progs.clear(); this.pool = []; this.buf = null;
      return gl;
    } catch { this.failed = true; return null; }
  }

  /** Whether a frame of this size can run on the GPU (and float targets, if needed). */
  can(w: number, h: number, needFloat = false) {
    if (!gpuSettings.enabled) return false;
    const gl = this.ctx();
    return !!gl && w <= this.maxSize && h <= this.maxSize && (!needFloat || this.floatOk);
  }

  private program(gl: WebGL2RenderingContext, frag: string) {
    let p = this.progs.get(frag);
    if (p) return p;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'a');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.progs.set(frag, p);
    return p;
  }

  /** A texture of the picture on a canvas (8-bit, top row first). */
  upload(source: TexImageSource, w: number, h: number): Tex | null {
    const gl = this.ctx();
    if (!gl) return null;
    const t = this.texture(gl, w, h, false, false);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }

  /** An empty render target; float when the values need more than 8 bits. */
  target(w: number, h: number, float: boolean): Tex | null {
    const gl = this.ctx();
    return gl ? this.texture(gl, w, h, float, true) : null;
  }

  private texture(gl: WebGL2RenderingContext, w: number, h: number, float: boolean, fbo: boolean): Tex {
    // Reuse a texture of the same kind from earlier frames.
    const i = this.pool.findIndex((t) => t.w === w && t.h === h && t.float === float && !!t.fbo === fbo);
    if (i >= 0) return this.pool.splice(i, 1)[0];
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let f: WebGLFramebuffer | null = null;
    if (fbo) {
      gl.texStorage2D(gl.TEXTURE_2D, 1, float ? gl.RGBA16F : gl.RGBA8, w, h);
      f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return { tex, w, h, fbo: f, float };
  }

  /** Hand textures back for reuse by later frames (at most a few are kept). */
  release(...ts: (Tex | null)[]) {
    const gl = this.gl;
    for (const t of ts) {
      if (!t) continue;
      this.pool.push(t);
      while (this.pool.length > 8) {
        const old = this.pool.shift()!;
        gl?.deleteTexture(old.tex);
        if (old.fbo) gl?.deleteFramebuffer(old.fbo);
      }
    }
  }

  /**
   * Runs one fragment shader over w × h. Textures are bound in order to
   * u_tex0, u_tex1, ...; `to` is a render target, or null for the canvas
   * (which is then returned, ready to drawImage).
   */
  run(frag: string, w: number, h: number, textures: Tex[], uniforms: Record<string, Uniform>, to: Tex | null = null): HTMLCanvasElement | null {
    const gl = this.ctx();
    if (!gl || !this.canvas) return null;
    const p = this.program(gl, frag);
    gl.useProgram(p);
    if (!this.buf) {
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (to) gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    textures.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(gl.getUniformLocation(p, `u_tex${i}`), i);
    });
    gl.uniform2f(gl.getUniformLocation(p, 'u_size'), w, h);
    gl.uniform1i(gl.getUniformLocation(p, 'u_screen'), to ? 0 : 1);
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = gl.getUniformLocation(p, k);
      if (!loc) continue;
      if (typeof v === 'boolean') gl.uniform1i(loc, v ? 1 : 0);
      else if (typeof v === 'number') gl.uniform1f(loc, v);
      else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
      else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
      else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (to) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); return null; }
    return this.canvas;
  }
}

export const gpu = new Gpu();
/** Turn the GPU path off (tests compare it with the CPU loops; a fallback if a driver misbehaves). */
export const gpuSettings = { enabled: true };

/**
 * Runs a single-pass effect on the GPU and draws the result into ctx.
 * Returns false (having drawn nothing) when the GPU path is not available.
 */
export function gpuEffect(frag: string, srcCanvas: TexImageSource, ctx: CanvasRenderingContext2D, w: number, h: number, uniforms: Record<string, Uniform>) {
  if (!gpu.can(w, h)) return false;
  try {
    const t = gpu.upload(srcCanvas, w, h);
    if (!t) return false;
    const out = gpu.run(frag, w, h, [t], uniforms);
    gpu.release(t);
    if (!out) return false;
    ctx.drawImage(out, 0, 0);
    return true;
  } catch (e) {
    console.warn('GPU effect fell back to CPU:', e);
    return false;
  }
}

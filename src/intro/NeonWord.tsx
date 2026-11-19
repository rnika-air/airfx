import { useEffect, useRef } from 'react';
import { WORD_PATH } from '../components/logoPaths';

/**
 * The front-page AirFx lettering, in flat brand lime, melting under the cursor.
 *
 * Look: the flat brand-lime lettering, exactly like the vector wordmark, with
 * nothing around it (no glow, box or stripes).
 *
 * Interaction (after the liquid-type reference): the pointer carries an
 * invisible liquid blob with a short trail. On its own it is too weak to show;
 * where it meets the letters it adds to them, so they swell, bridge and close
 * their counters like liquid, then settle back into clean type when it leaves.
 * Touch works the same with a finger.
 *
 * How: the lettering is drawn once as a mask, blurred on the GPU to give it a liquid
 * edge, and a single shader adds the
 * blob and thresholds the sum each frame. It only animates while the blob is
 * moving or fading; it stops off screen and in hidden tabs, draws one still frame
 * under reduced motion, and leaves the plain vector wordmark in place when WebGL2
 * is not available.
 */

const VIEW = { x: 411, y: 2046, w: 847, h: 217 };
const TRAIL = 6;

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const BLUR = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 dir; uniform float sigma;
void main() {
  float s = 0.0, w = 0.0;
  int r = int(min(64.0, ceil(sigma * 2.6)));
  for (int i = -64; i <= 64; i++) {
    if (i < -r || i > r) continue;
    float k = exp(-float(i * i) / (2.0 * sigma * sigma));
    s += texture(t, uv + dir * float(i)).r * k; w += k;
  }
  o = vec4(s / w, 0.0, 0.0, 1.0);
}`;

const NEON = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D edge;
uniform vec2 res;
uniform vec4 blob[${TRAIL}];
uniform float power;
void main() {
  vec2 px = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  float m = 0.0;
  for (int i = 0; i < ${TRAIL}; i++) { vec2 d = px - blob[i].xy; m += blob[i].z * exp(-dot(d, d) / (2.0 * blob[i].w * blob[i].w)); }
  float e = texture(edge, uv).r;
  // The blob only shows where it meets the letters: alone it stays under the threshold.
  float f = e + m * (0.62 + e);
  float aa = max(fwidth(f), 1e-4);
  float core = smoothstep(0.5 - aa, 0.5 + aa, f) * power;
  // Flat brand lime with nothing around the letters: no glow, box, stripes or tint.
  o = vec4(0.776, 1.0, 0.18, core);
}`;

function compile(gl: WebGL2RenderingContext, frag: string) {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

export function NeonWord({ onReady }: { onReady?: (ok: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement, word = host?.querySelector<SVGSVGElement>('.sp__word');
    if (!canvas || !host || !word) return;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, alpha: true });
    if (!gl) { onReady?.(false); return; }
    let blurP: WebGLProgram, neonP: WebGLProgram;
    try { blurP = compile(gl, BLUR); neonP = compile(gl, NEON); } catch { onReady?.(false); return; }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = () => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); return t; };
    const target = (w: number, h: number) => { const t = tex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); const f = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f }; };
    let W = 0, H = 0, wordH = 1, edge: WebGLTexture | null = null, made: (WebGLTexture | WebGLFramebuffer)[] = [];
    const drop = () => { for (const x of made) { if (x instanceof WebGLTexture) gl.deleteTexture(x); else gl.deleteFramebuffer(x); } made = []; };

    // Lay the canvas over the wordmark with room for the glow, then build the blurred masks.
    const layout = () => {
      const hb = host.getBoundingClientRect(), wb = word.getBoundingClientRect();
      if (!wb.width) return false;
      const pad = wb.height * 0.3, dpr = Math.min(2, devicePixelRatio || 1);
      Object.assign(canvas.style, { left: `${wb.left - hb.left - pad}px`, top: `${wb.top - hb.top - pad}px`, width: `${wb.width + pad * 2}px`, height: `${wb.height + pad * 2}px` });
      W = Math.round((wb.width + pad * 2) * dpr); H = Math.round((wb.height + pad * 2) * dpr); wordH = wb.height * dpr;
      canvas.width = W; canvas.height = H;
      const m = document.createElement('canvas'); m.width = W; m.height = H;
      const g = m.getContext('2d')!; g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const k = (wb.width * dpr) / VIEW.w, off = pad * dpr;
      g.setTransform(k, 0, 0, k, off - VIEW.x * k, off - VIEW.y * k);
      g.fillStyle = '#fff'; g.fill(new Path2D(WORD_PATH), 'evenodd');
      drop();
      const src = tex(); made.push(src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, m);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const blur = (from: WebGLTexture, sigma: number) => {
        const a = target(W, H), b = target(W, H); made.push(a.t, a.f, b.t, b.f);
        gl.useProgram(blurP); gl.viewport(0, 0, W, H); gl.uniform1i(gl.getUniformLocation(blurP, 't'), 0); gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(gl.getUniformLocation(blurP, 'sigma'), sigma);
        gl.bindFramebuffer(gl.FRAMEBUFFER, a.f); gl.bindTexture(gl.TEXTURE_2D, from); gl.uniform2f(gl.getUniformLocation(blurP, 'dir'), 1 / W, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.f); gl.bindTexture(gl.TEXTURE_2D, a.t); gl.uniform2f(gl.getUniformLocation(blurP, 'dir'), 0, 1 / H); gl.drawArrays(gl.TRIANGLES, 0, 3);
        return b.t;
      };
      // Sizes follow the lettering, so the look is the same on any screen.
      edge = blur(src, Math.max(1, wordH * 0.016));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return true;
    };

    // The blob: a sprung point with a short trail, and an amount that fades in and out.
    const tgt = { x: -1e4, y: -1e4 }, pos = { x: -1e4, y: -1e4 }, vel = { x: 0, y: 0 }, trail = Array.from({ length: TRAIL }, () => ({ x: -1e4, y: -1e4 }));
    let amount = 0, want = 0, last = 0, raf = 0, visible = true;
    const power = 1;
    const blobs = new Float32Array(TRAIL * 4);
    const draw = () => {
      if (!W || !edge) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(neonP);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, edge); gl.uniform1i(gl.getUniformLocation(neonP, 'edge'), 0);
      gl.uniform2f(gl.getUniformLocation(neonP, 'res'), W, H);
      const s0 = wordH * 0.22;
      trail.forEach((p, i) => { blobs.set([p.x, p.y, amount * (0.56 - i * 0.055), s0 * (1 - i * 0.09)], i * 4); });
      gl.uniform4fv(gl.getUniformLocation(neonP, 'blob'), blobs);
      gl.uniform1f(gl.getUniformLocation(neonP, 'power'), power);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60); last = now;
      // Spring towards the pointer; each trail point eases after the one before it.
      if (tgt.x > -1e3) {
        if (pos.x < -1e3) { pos.x = tgt.x; pos.y = tgt.y; trail.forEach((p) => { p.x = tgt.x; p.y = tgt.y; }); }
        vel.x += (tgt.x - pos.x) * 120 * dt; vel.y += (tgt.y - pos.y) * 120 * dt;
        const damp = Math.exp(-dt * 14); vel.x *= damp; vel.y *= damp;
        pos.x += vel.x * dt; pos.y += vel.y * dt;
        const k = 1 - Math.exp(-dt * 22);
        trail.forEach((p, i) => { const q = i ? trail[i - 1] : pos; p.x += (q.x - p.x) * k; p.y += (q.y - p.y) * k; });
      }
      amount += (want - amount) * (1 - Math.exp(-dt * (want > amount ? 7 : 3.5)));
      draw();
      const settling = Math.abs(want - amount) > 0.002 || Math.hypot(vel.x, vel.y) > 0.5 ||Math.hypot(trail[TRAIL - 1].x - pos.x, trail[TRAIL - 1].y - pos.y) > 0.5;
      // Stops as soon as everything has settled; the next pointer move starts it again.
      if (visible && !still && settling) raf = requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf && visible && !still) { last = 0; raf = requestAnimationFrame(tick); } };

    const move = (e: PointerEvent) => {
      if (still) return;
      const b = canvas.getBoundingClientRect(), dpr = W / (b.width || 1);
      const x = (e.clientX - b.left) * dpr, y = (e.clientY - b.top) * dpr;
      tgt.x = x; tgt.y = y;
      // Active over the lettering and a little around it.
      want = x > -wordH * 0.3 && x < W + wordH * 0.3 && y > -wordH * 0.2 && y < H + wordH * 0.2 ? 1 : 0;
      kick();
    };
    const leave = () => { want = 0; kick(); };
    const leaveDoc = (e: PointerEvent) => { if (!e.relatedTarget) leave(); };

    let built = false;
    const rebuild = () => { built = layout(); if (built) { onReady?.(true); draw(); kick(); } };
    rebuild();
    // Fonts and layout can move the wordmark after the first frame.
    const ro = new ResizeObserver(() => rebuild()); ro.observe(word);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting && !document.hidden; if (visible) kick(); });
    io.observe(canvas);
    const vis = () => { visible = !document.hidden; if (visible) kick(); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', move, { passive: true });
    const up = (e: PointerEvent) => { if (e.pointerType === 'touch') leave(); };
    window.addEventListener('pointerup', up, { passive: true });
    document.addEventListener('pointerout', leaveDoc);
    document.addEventListener('visibilitychange', vis);
    const lost = (e: Event) => { e.preventDefault(); onReady?.(false); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerdown', move); window.removeEventListener('pointerup', up);
      document.removeEventListener('pointerout', leaveDoc); document.removeEventListener('visibilitychange', vis);
      canvas.removeEventListener('webglcontextlost', lost);
      drop(); gl.deleteBuffer(vb); gl.deleteProgram(blurP); gl.deleteProgram(neonP);
    };
  }, [onReady]);
  return <canvas ref={ref} className="sp__neon" aria-hidden />;
}

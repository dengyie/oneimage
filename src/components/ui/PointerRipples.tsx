import React, { useEffect, useRef } from "react";

/**
 * PointerRipples — React
 * WebGL-powered interactive multi-color fluid ripples backdrop.
 * Follows mouse/pointer movement with Navier-Stokes fluid dynamics,
 * rainbow hue-shifting dye splats, vorticity swirls, and 3D diffuse shading.
 * 
 * Features:
 * - Fluid simulation (advection, divergence, pressure Poisson solver, vorticity confinement)
 * - Coalesced pointer event handling for high-refresh-rate cursor tracking
 * - Idle sleep & visibilitychange hibernation for zero idle CPU/GPU consumption
 * - WebGL2 & WebGL1 fallback with half-float/float FBO support
 * - prefers-reduced-motion accessibility compliance
 */

export interface PointerRipplesProps {
  /** Simulation resolution grid (default 128) */
  simResolution?: number;
  /** Dye texture resolution (default 768) */
  dyeResolution?: number;
  /** Rate at which dye dissipates/fades (default 2.4) */
  densityDissipation?: number;
  /** Rate at which fluid velocity slows down (default 1.6) */
  velocityDissipation?: number;
  /** Pressure coefficient (default 0.8) */
  pressure?: number;
  /** Number of Jacobi iterations for pressure solver (default 20) */
  pressureIterations?: number;
  /** Fluid vorticity / curl strength (default 13) */
  curl?: number;
  /** Splat radius relative to canvas (default 0.24) */
  splatRadius?: number;
  /** Force exerted by pointer velocity (default 4800) */
  splatForce?: number;
  /** Enable 3D diffuse lighting & shading on dye surfaces (default true) */
  shading?: boolean;
  /** Speed of continuous hue rotation per second (default 0.055) */
  colorSpeed?: number;
  /** Hue shift step per pointer trail point (default 0.012) */
  colorStep?: number;
  /** Dye color saturation [0-1] (default 0.72) */
  colorSaturation?: number;
  /** Dye color brightness [0-1] (default 1.0) */
  colorValue?: number;
  /** Dye color opacity / intensity multiplier (default 0.26) */
  colorIntensity?: number;
  /** Milliseconds of pointer inactivity before pausing RAF loop (default 4000) */
  idleMs?: number;
  /** Maximum device pixel ratio cap (default 1.5) */
  maxPixelRatio?: number;
  /** Custom canvas CSS classes */
  className?: string;
  /** Custom canvas inline styles */
  style?: React.CSSProperties;
  /** Overall opacity (default 0.58) */
  opacity?: number;
}

const BASE_VERTEX_SHADER = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;

void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const CLEAR_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
uniform sampler2D uTexture;
uniform float value;

void main () {
  gl_FragColor = value * texture2D(uTexture, vUv);
}
`;

const SPLAT_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;

void main () {
  vec2 offset = vUv - point;
  offset.x *= aspectRatio;
  vec3 splat = exp(-dot(offset, offset) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}
`;

const ADVECTION_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp (sampler2D source, vec2 uv, vec2 size) {
  vec2 coord = uv / size - 0.5;
  vec2 index = floor(coord);
  vec2 weight = fract(coord);
  vec4 a = texture2D(source, (index + vec2(0.5, 0.5)) * size);
  vec4 b = texture2D(source, (index + vec2(1.5, 0.5)) * size);
  vec4 c = texture2D(source, (index + vec2(0.5, 1.5)) * size);
  vec4 d = texture2D(source, (index + vec2(1.5, 1.5)) * size);
  return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y);
}

void main () {
#ifdef MANUAL_FILTERING
  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
  vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  vec4 result = texture2D(uSource, coord);
#endif
  gl_FragColor = result / (1.0 + dissipation * dt);
}
`;

const DIVERGENCE_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main () {
  float left = texture2D(uVelocity, vL).x;
  float right = texture2D(uVelocity, vR).x;
  float top = texture2D(uVelocity, vT).y;
  float bottom = texture2D(uVelocity, vB).y;
  vec2 center = texture2D(uVelocity, vUv).xy;

  if (vL.x < 0.0) left = -center.x;
  if (vR.x > 1.0) right = -center.x;
  if (vT.y > 1.0) top = -center.y;
  if (vB.y < 0.0) bottom = -center.y;

  float divergence = 0.5 * (right - left + top - bottom);
  gl_FragColor = vec4(divergence, 0.0, 0.0, 1.0);
}
`;

const CURL_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uVelocity;

void main () {
  float left = texture2D(uVelocity, vL).y;
  float right = texture2D(uVelocity, vR).y;
  float top = texture2D(uVelocity, vT).x;
  float bottom = texture2D(uVelocity, vB).x;
  float value = right - left - top + bottom;
  gl_FragColor = vec4(0.5 * value, 0.0, 0.0, 1.0);
}
`;

const VORTICITY_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;

void main () {
  float left = texture2D(uCurl, vL).x;
  float right = texture2D(uCurl, vR).x;
  float top = texture2D(uCurl, vT).x;
  float bottom = texture2D(uCurl, vB).x;
  float center = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(top) - abs(bottom), abs(right) - abs(left));
  force /= length(force) + 0.0001;
  force *= curl * center;
  force.y *= -1.0;

  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity += force * dt;
  velocity = clamp(velocity, -1000.0, 1000.0);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const PRESSURE_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main () {
  float left = texture2D(uPressure, vL).x;
  float right = texture2D(uPressure, vR).x;
  float top = texture2D(uPressure, vT).x;
  float bottom = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (left + right + bottom + top - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

const GRADIENT_SUBTRACT_SHADER = `
precision mediump float;
precision mediump sampler2D;
varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main () {
  float left = texture2D(uPressure, vL).x;
  float right = texture2D(uPressure, vR).x;
  float top = texture2D(uPressure, vT).x;
  float bottom = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity -= vec2(right - left, top - bottom);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const DISPLAY_SHADER = `
precision highp float;
precision highp sampler2D;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform sampler2D uTexture;
uniform vec2 texelSize;

vec3 linearToGamma (vec3 color) {
  color = max(color, vec3(0.0));
  return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0.0));
}

void main () {
  vec3 color = texture2D(uTexture, vUv).rgb;

#ifdef SHADING
  vec3 left = texture2D(uTexture, vL).rgb;
  vec3 right = texture2D(uTexture, vR).rgb;
  vec3 top = texture2D(uTexture, vT).rgb;
  vec3 bottom = texture2D(uTexture, vB).rgb;
  float dx = length(right) - length(left);
  float dy = length(top) - length(bottom);
  vec3 normal = normalize(vec3(dx, dy, length(texelSize) * 2.5));
  float diffuse = clamp(dot(normal, vec3(0.0, 0.0, 1.0)) + 0.80, 0.80, 1.0);
  color *= diffuse;
#endif

  float peak = max(color.r, max(color.g, color.b));
  color = min(linearToGamma(color), vec3(1.0));
  float alpha = clamp(peak * 1.4, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

function normalizeHue(h: number): number {
  return ((h % 1) + 1) % 1;
}

function clamp(val: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, val));
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return { r: v, g: t, b: p };
    case 1:
      return { r: q, g: v, b: p };
    case 2:
      return { r: p, g: v, b: t };
    case 3:
      return { r: p, g: q, b: v };
    case 4:
      return { r: t, g: p, b: v };
    default:
      return { r: v, g: p, b: q };
  }
}

interface FBO {
  texture: WebGLTexture;
  raw: WebGLFramebuffer;
  width: number;
  height: number;
  texelX: number;
  texelY: number;
}

interface DoubleFBO {
  read: FBO;
  write: FBO;
  width: number;
  height: number;
  texelX: number;
  texelY: number;
  swap: () => void;
}

interface ProgramInfo {
  raw: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface PointerInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: { r: number; g: number; b: number };
  radius?: number;
}

/** Idle fade-out window: dye keeps decaying for this long before the loop stops. */
const FADE_OUT_MS = 800;
/** Extra dye dissipation while fading out, so the trail melts instead of snapping off. */
const FADE_OUT_DISSIPATION = 8;

class FluidSimulationEngine {
  canvas: HTMLCanvasElement;
  cfg: Required<Omit<PointerRipplesProps, "className" | "style" | "opacity">>;
  view: Window;
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  isGl2: boolean;
  textures = new Set<WebGLTexture>();
  fbos = new Set<WebGLFramebuffer>();
  programs = new Set<WebGLProgram>();
  shaders = new Set<WebGLShader>();
  buffers = new Set<WebGLBuffer>();
  inputs: PointerInput[] = [];
  linear = false;
  texType = 0;
  rgba = { internal: 0, format: 0 };
  rg = { internal: 0, format: 0 };
  r = { internal: 0, format: 0 };
  prog: Record<string, ProgramInfo> | null = null;
  dye: DoubleFBO | null = null;
  velocity: DoubleFBO | null = null;
  divergence: FBO | null = null;
  curlFbo: FBO | null = null;
  pressure: DoubleFBO | null = null;
  frame = 0;
  lastTime = 0;
  lastInput = 0;
  hue = 0.52;
  pointer: { x: number; y: number } | null = null;
  visible = true;
  active = false;
  dead = false;
  contextLost = false;
  fading = false;
  fadeStart = 0;
  cssWidth = 0;
  cssHeight = 0;

  constructor(canvas: HTMLCanvasElement, options: PointerRipplesProps) {
    this.canvas = canvas;
    this.cfg = {
      simResolution: options.simResolution ?? 128,
      dyeResolution: options.dyeResolution ?? 768,
      densityDissipation: options.densityDissipation ?? 2.4,
      velocityDissipation: options.velocityDissipation ?? 1.6,
      pressure: options.pressure ?? 0.8,
      pressureIterations: options.pressureIterations ?? 20,
      curl: options.curl ?? 13,
      splatRadius: options.splatRadius ?? 0.24,
      splatForce: options.splatForce ?? 4800,
      shading: options.shading ?? true,
      colorSpeed: options.colorSpeed ?? 0.055,
      colorStep: options.colorStep ?? 0.012,
      colorSaturation: options.colorSaturation ?? 0.72,
      colorValue: options.colorValue ?? 1.0,
      colorIntensity: options.colorIntensity ?? 0.26,
      idleMs: options.idleMs ?? 4000,
      maxPixelRatio: options.maxPixelRatio ?? 1.5,
    };
    this.view = canvas.ownerDocument.defaultView ?? window;

    const ctxAttr: WebGLContextAttributes = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    };

    const gl2 = canvas.getContext("webgl2", ctxAttr);
    const gl1 = gl2 ? null : (canvas.getContext("webgl", ctxAttr) as WebGLRenderingContext | null);
    const gl = gl2 ?? gl1;
    if (!gl) throw new Error("WebGL is unavailable");

    this.gl = gl;
    this.isGl2 = !!gl2;

    try {
      this.initFormats();
      this.initPrograms();
      this.initQuad();
      this.resizeCanvas();
      this.initFramebuffers();
      this.clearScreen();
    } catch (err) {
      this.releaseGl();
      throw err;
    }
  }

  update = (now: number) => {
    this.frame = 0;
    if (this.dead || this.contextLost || !this.visible) return;

    if (this.inputs.length === 0 && now - this.lastInput >= this.cfg.idleMs) {
      if (!this.fading) {
        this.fading = true;
        this.fadeStart = now;
      } else if (now - this.fadeStart >= FADE_OUT_MS) {
        this.fading = false;
        this.active = false;
        this.clearAll();
        return;
      }
    } else if (this.fading) {
      this.fading = false;
    }

    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0.001), 1 / 60);
    this.lastTime = now;
    this.hue = normalizeHue(this.hue + dt * this.cfg.colorSpeed);

    if (this.resizeCanvas()) {
      this.initFramebuffers();
    }

    this.applyInputs();
    this.step(dt);
    this.render();
    this.frame = this.view.requestAnimationFrame(this.update);
  };

  move(clientX: number, clientY: number) {
    if (this.dead || this.contextLost || !this.visible) return;
    const pt = this.toPoint(clientX, clientY);
    const prev = this.pointer;
    this.pointer = pt;

    if (!prev) {
      this.queue({ ...pt, vx: 0, vy: 0, color: this.nextColor() });
      this.wake();
      return;
    }

    const w = Math.max(this.cssWidth || this.canvas.clientWidth, 1);
    const h = Math.max(this.cssHeight || this.canvas.clientHeight, 1);
    const dx = (pt.x - prev.x) * w;
    const dy = (pt.y - prev.y) * h;
    const dist = Math.hypot(dx, dy);
    const count = clamp(Math.ceil(dist / 14), 1, 32);

    const vx = this.correctX((pt.x - prev.x) / count) * this.cfg.splatForce;
    const vy = this.correctY((pt.y - prev.y) / count) * this.cfg.splatForce;

    for (let i = 1; i <= count; i += 1) {
      const t = i / count;
      this.queue({
        x: prev.x + (pt.x - prev.x) * t,
        y: prev.y + (pt.y - prev.y) * t,
        vx,
        vy,
        color: this.nextColor(),
      });
    }
    this.wake();
  }

  splat(clientX: number, clientY: number) {
    if (this.dead || this.contextLost || !this.visible) return;
    const pt = this.toPoint(clientX, clientY);
    const hue = this.hue;
    const spread =
      Math.min(this.cssWidth || this.canvas.clientWidth, this.cssHeight || this.canvas.clientHeight) * 0.1;

    this.pointer = pt;
    this.queue({
      ...pt,
      vx: 0,
      vy: 0,
      color: this.makeColor(hue, 1.4),
      radius: 0.19,
    });

    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      const subPt = this.toPoint(
        clientX + Math.cos(angle) * spread,
        clientY + Math.sin(angle) * spread
      );
      this.queue({
        ...subPt,
        vx: Math.cos(angle) * 140,
        vy: -Math.sin(angle) * 140,
        color: this.makeColor(hue + i / 6, 1.7),
        radius: 0.11,
      });
    }

    this.hue = normalizeHue(hue + this.cfg.colorStep * 7);
    this.wake();
  }

  resize() {
    if (this.dead || this.contextLost) return;
    if (this.resizeCanvas()) {
      this.initFramebuffers();
      if (!this.active) this.clearScreen();
    }
  }

  setVisible(visible: boolean) {
    if (this.dead || visible === this.visible) return;
    this.visible = visible;
    this.pointer = null;
    if (!visible) {
      this.inputs.length = 0;
      this.stop();
      this.clearAll();
      return;
    }
    this.active = false;
    if (!this.contextLost) this.clearScreen();
  }

  /** Canvas CSS box updated by a ResizeObserver, so the frame loop never reads layout. */
  setViewportSize(width: number, height: number) {
    this.cssWidth = Math.max(1, Math.round(width));
    this.cssHeight = Math.max(1, Math.round(height));
  }

  /** Drop the cached pointer so the first move after leaving the window starts a fresh trail. */
  releasePointer() {
    this.pointer = null;
  }

  handleContextLost() {
    if (this.dead) return;
    this.contextLost = true;
    this.fading = false;
    this.inputs.length = 0;
    this.stop();
    this.releaseGl();
  }

  handleContextRestored() {
    if (this.dead) return;
    this.contextLost = false;
    try {
      this.initFormats();
      this.initPrograms();
      this.initQuad();
      this.resizeCanvas();
      this.initFramebuffers();
      this.clearScreen();
    } catch {
      this.dead = true;
      this.releaseGl();
      return;
    }
    this.lastTime = this.view.performance.now();
    if (this.active && this.visible) this.wake();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.stop();
    this.inputs.length = 0;
    this.pointer = null;
    this.clearScreen();
    this.releaseGl();
  }

  private initFormats() {
    const gl = this.gl;
    if (this.isGl2) {
      const gl2 = gl as WebGL2RenderingContext;
      gl2.getExtension("EXT_color_buffer_float");
      this.linear = !!gl2.getExtension("OES_texture_float_linear");
      this.texType = gl2.HALF_FLOAT;

      const rgba = this.supportedFormat(gl2.RGBA16F, gl2.RGBA, this.texType);
      const rg = this.supportedFormat(gl2.RG16F, gl2.RG, this.texType);
      const r = this.supportedFormat(gl2.R16F, gl2.RED, this.texType);

      if (rgba && rg && r) {
        this.rgba = rgba;
        this.rg = rg;
        this.r = r;
        return;
      }
    }

    const halfExt = gl.getExtension("OES_texture_half_float");
    const halfLinear = gl.getExtension("OES_texture_half_float_linear");
    const floatExt = gl.getExtension("OES_texture_float");
    const floatLinear = gl.getExtension("OES_texture_float_linear");

    const candidates = [
      halfExt && { type: (halfExt as any).HALF_FLOAT_OES, linear: !!halfLinear },
      floatExt && { type: gl.FLOAT, linear: !!floatLinear },
    ].filter(Boolean) as { type: number; linear: boolean }[];

    for (const cand of candidates) {
      const fmt = this.supportedFormat(gl.RGBA, gl.RGBA, cand.type);
      if (fmt) {
        this.texType = cand.type;
        this.linear = cand.linear;
        this.rgba = fmt;
        this.rg = fmt;
        this.r = fmt;
        return;
      }
    }

    throw new Error("WebGL floating-point framebuffers are unavailable");
  }

  private supportedFormat(
    internal: number,
    format: number,
    type: number
  ): { internal: number; format: number } | null {
    if (this.isRenderable(internal, format, type)) {
      return { internal, format };
    }
    if (!this.isGl2) return null;
    const gl2 = this.gl as WebGL2RenderingContext;
    if (internal === gl2.R16F) return this.supportedFormat(gl2.RG16F, gl2.RG, type);
    if (internal === gl2.RG16F) return this.supportedFormat(gl2.RGBA16F, gl2.RGBA, type);
    return null;
  }

  private isRenderable(internal: number, format: number, type: number): boolean {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) return false;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;

    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    return ok;
  }

  private initPrograms() {
    const gl = this.gl;
    const vert = this.compileShader(gl.VERTEX_SHADER, BASE_VERTEX_SHADER);

    const makeProg = (fragSrc: string, defs: string[] = []): ProgramInfo => {
      const frag = this.compileShader(gl.FRAGMENT_SHADER, fragSrc, defs);
      return this.linkProgram(vert, frag);
    };

    const advectionDefs = this.linear ? [] : ["MANUAL_FILTERING"];
    const displayDefs = this.cfg.shading && this.linear ? ["SHADING"] : [];

    this.prog = {
      clear: makeProg(CLEAR_SHADER),
      splat: makeProg(SPLAT_SHADER),
      advection: makeProg(ADVECTION_SHADER, advectionDefs),
      divergence: makeProg(DIVERGENCE_SHADER),
      curl: makeProg(CURL_SHADER),
      vorticity: makeProg(VORTICITY_SHADER),
      pressure: makeProg(PRESSURE_SHADER),
      gradient: makeProg(GRADIENT_SUBTRACT_SHADER),
      display: makeProg(DISPLAY_SHADER, displayDefs),
    };
  }

  private compileShader(type: number, src: string, defs: string[] = []): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create WebGL shader");
    this.shaders.add(shader);

    const prefix = defs.map((d) => `#define ${d}\n`).join("");
    gl.shaderSource(shader, `${prefix}${src}`);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader) || "Shader compile error";
      gl.deleteShader(shader);
      this.shaders.delete(shader);
      throw new Error(err);
    }
    return shader;
  }

  private linkProgram(vert: WebGLShader, frag: WebGLShader): ProgramInfo {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error("Failed to create WebGL program");
    this.programs.add(prog);

    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.bindAttribLocation(prog, 0, "aPosition");
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(prog) || "Program link error";
      gl.deleteProgram(prog);
      this.programs.delete(prog);
      throw new Error(err);
    }

    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(prog, i);
      if (info) uniforms[info.name] = gl.getUniformLocation(prog, info.name);
    }
    return { raw: prog, uniforms };
  }

  private initQuad() {
    const gl = this.gl;
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (!vbo || !ibo) throw new Error("Failed to create geometry buffers");

    this.buffers.add(vbo);
    this.buffers.add(ibo);

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
      gl.STATIC_DRAW
    );

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
  }

  private initFramebuffers() {
    const gl = this.gl;
    this.releaseTargets();

    const simRes = this.calcResolution(this.cfg.simResolution);
    const dyeRes = this.calcResolution(this.linear ? this.cfg.dyeResolution : 256);
    const filter = this.linear ? gl.LINEAR : gl.NEAREST;

    gl.disable(gl.BLEND);
    this.dye = this.createDoubleFbo(dyeRes.width, dyeRes.height, this.rgba, filter);
    this.velocity = this.createDoubleFbo(simRes.width, simRes.height, this.rg, filter);
    this.divergence = this.createFbo(simRes.width, simRes.height, this.r, gl.NEAREST);
    this.curlFbo = this.createFbo(simRes.width, simRes.height, this.r, gl.NEAREST);
    this.pressure = this.createDoubleFbo(simRes.width, simRes.height, this.r, gl.NEAREST);
  }

  private createFbo(w: number, h: number, fmt: { internal: number; format: number }, filter: number): FBO {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error("Failed to create FBO");

    this.textures.add(tex);
    this.fbos.add(fbo);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, this.texType, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture: tex,
      raw: fbo,
      width: w,
      height: h,
      texelX: 1 / w,
      texelY: 1 / h,
    };
  }

  private createDoubleFbo(
    w: number,
    h: number,
    fmt: { internal: number; format: number },
    filter: number
  ): DoubleFBO {
    const read = this.createFbo(w, h, fmt, filter);
    const write = this.createFbo(w, h, fmt, filter);
    const dfbo: DoubleFBO = {
      read,
      write,
      width: w,
      height: h,
      texelX: 1 / w,
      texelY: 1 / h,
      swap: () => {
        const tmp = dfbo.read;
        dfbo.read = dfbo.write;
        dfbo.write = tmp;
      },
    };
    return dfbo;
  }

  private releaseTargets() {
    if (this.divergence) this.deleteFbo(this.divergence);
    if (this.curlFbo) this.deleteFbo(this.curlFbo);
    if (this.dye) {
      this.deleteFbo(this.dye.read);
      this.deleteFbo(this.dye.write);
    }
    if (this.velocity) {
      this.deleteFbo(this.velocity.read);
      this.deleteFbo(this.velocity.write);
    }
    if (this.pressure) {
      this.deleteFbo(this.pressure.read);
      this.deleteFbo(this.pressure.write);
    }
    this.dye = null;
    this.velocity = null;
    this.divergence = null;
    this.curlFbo = null;
    this.pressure = null;
  }

  private deleteFbo(fbo: FBO) {
    this.gl.deleteTexture(fbo.texture);
    this.gl.deleteFramebuffer(fbo.raw);
    this.textures.delete(fbo.texture);
    this.fbos.delete(fbo.raw);
  }

  private calcResolution(res: number): { width: number; height: number } {
    const dw = this.gl.drawingBufferWidth;
    const dh = this.gl.drawingBufferHeight;
    const aspect = Math.max(dw / Math.max(dh, 1), dh / Math.max(dw, 1));
    const small = Math.round(res);
    const big = Math.round(res * aspect);
    return dw > dh ? { width: big, height: small } : { width: small, height: big };
  }

  private resizeCanvas(): boolean {
    const dpr = Math.min(this.view.devicePixelRatio || 1, this.cfg.maxPixelRatio);
    const w = this.cssWidth || this.canvas.clientWidth || this.canvas.width || 1;
    const h = this.cssHeight || this.canvas.clientHeight || this.canvas.height || 1;
    const targetW = Math.max(1, Math.floor(w * dpr));
    const targetH = Math.max(1, Math.floor(h * dpr));

    if (this.canvas.width === targetW && this.canvas.height === targetH) {
      return false;
    }
    this.canvas.width = targetW;
    this.canvas.height = targetH;
    return true;
  }

  private toPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    const x = clamp((clientX - rect.left) / w);
    const y = 1 - clamp((clientY - rect.top) / h);
    return { x, y };
  }

  private correctX(val: number): number {
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    return aspect < 1 ? val * aspect : val;
  }

  private correctY(val: number): number {
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    return aspect > 1 ? val / aspect : val;
  }

  private correctRadius(rad: number): number {
    const aspect = this.canvas.width / Math.max(this.canvas.height, 1);
    return aspect > 1 ? rad * aspect : rad;
  }

  private makeColor(hue: number, intensityScale = 1) {
    const rgb = hsvToRgb(normalizeHue(hue), this.cfg.colorSaturation, this.cfg.colorValue);
    const scale = this.cfg.colorIntensity * intensityScale;
    return { r: rgb.r * scale, g: rgb.g * scale, b: rgb.b * scale };
  }

  private nextColor(intensityScale = 1) {
    const col = this.makeColor(this.hue, intensityScale);
    this.hue = normalizeHue(this.hue + this.cfg.colorStep);
    return col;
  }

  private queue(item: PointerInput) {
    if (this.inputs.length >= 128) this.inputs.shift();
    this.inputs.push(item);
  }

  private wake() {
    this.lastInput = this.view.performance.now();
    this.active = true;
    this.fading = false;
    if (!this.frame && this.visible && !this.contextLost) {
      this.lastTime = this.lastInput;
      this.frame = this.view.requestAnimationFrame(this.update);
    }
  }

  private stop() {
    if (this.frame) {
      this.view.cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private applyInputs() {
    const count = Math.min(this.inputs.length, 10);
    for (let i = 0; i < count; i += 1) {
      const item = this.inputs.shift();
      if (item) this.applySplat(item);
    }
  }

  private applySplat(item: PointerInput) {
    if (!this.prog || !this.velocity || !this.dye) return;
    const prog = this.prog.splat;
    const gl = this.gl;
    const vel = this.velocity;
    const dye = this.dye;

    this.bindProg(prog);
    this.u1f(prog, "aspectRatio", this.canvas.width / Math.max(this.canvas.height, 1));
    this.u2f(prog, "point", item.x, item.y);
    this.u1f(
      prog,
      "radius",
      this.correctRadius((this.cfg.splatRadius * (item.radius ?? 1)) / 100)
    );

    // Splat velocity
    this.u1i(prog, "uTarget", this.attachTex(vel.read, 0));
    this.u3f(prog, "color", item.vx, item.vy, 0);
    this.blit(vel.write);
    vel.swap();

    // Splat dye color
    this.u1i(prog, "uTarget", this.attachTex(dye.read, 0));
    this.u3f(prog, "color", item.color.r, item.color.g, item.color.b);
    this.blit(dye.write);
    dye.swap();

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private step(dt: number) {
    if (!this.prog || !this.velocity || !this.pressure || !this.dye || !this.divergence || !this.curlFbo) {
      return;
    }
    const gl = this.gl;
    const prog = this.prog;
    const vel = this.velocity;
    const press = this.pressure;
    const dye = this.dye;
    const div = this.divergence;
    const curl = this.curlFbo;

    gl.disable(gl.BLEND);

    // 1. Curl
    this.bindProg(prog.curl);
    this.u2f(prog.curl, "texelSize", vel.texelX, vel.texelY);
    this.u1i(prog.curl, "uVelocity", this.attachTex(vel.read, 0));
    this.blit(curl);

    // 2. Vorticity confinement
    this.bindProg(prog.vorticity);
    this.u2f(prog.vorticity, "texelSize", vel.texelX, vel.texelY);
    this.u1i(prog.vorticity, "uVelocity", this.attachTex(vel.read, 0));
    this.u1i(prog.vorticity, "uCurl", this.attachTex(curl, 1));
    this.u1f(prog.vorticity, "curl", this.cfg.curl);
    this.u1f(prog.vorticity, "dt", dt);
    this.blit(vel.write);
    vel.swap();

    // 3. Divergence
    this.bindProg(prog.divergence);
    this.u2f(prog.divergence, "texelSize", vel.texelX, vel.texelY);
    this.u1i(prog.divergence, "uVelocity", this.attachTex(vel.read, 0));
    this.blit(div);

    // 4. Clear pressure
    this.bindProg(prog.clear);
    this.u1i(prog.clear, "uTexture", this.attachTex(press.read, 0));
    this.u1f(prog.clear, "value", this.cfg.pressure);
    this.blit(press.write);
    press.swap();

    // 5. Pressure Poisson solve (Jacobi iterations)
    this.bindProg(prog.pressure);
    this.u2f(prog.pressure, "texelSize", vel.texelX, vel.texelY);
    this.u1i(prog.pressure, "uDivergence", this.attachTex(div, 0));
    for (let i = 0; i < this.cfg.pressureIterations; i += 1) {
      this.u1i(prog.pressure, "uPressure", this.attachTex(press.read, 1));
      this.blit(press.write);
      press.swap();
    }

    // 6. Subtract gradient
    this.bindProg(prog.gradient);
    this.u2f(prog.gradient, "texelSize", vel.texelX, vel.texelY);
    this.u1i(prog.gradient, "uPressure", this.attachTex(press.read, 0));
    this.u1i(prog.gradient, "uVelocity", this.attachTex(vel.read, 1));
    this.blit(vel.write);
    vel.swap();

    // 7. Advect velocity
    this.bindProg(prog.advection);
    this.u2f(prog.advection, "texelSize", vel.texelX, vel.texelY);
    if (!this.linear) this.u2f(prog.advection, "dyeTexelSize", vel.texelX, vel.texelY);
    const velTex = this.attachTex(vel.read, 0);
    this.u1i(prog.advection, "uVelocity", velTex);
    this.u1i(prog.advection, "uSource", velTex);
    this.u1f(prog.advection, "dt", dt);
    this.u1f(prog.advection, "dissipation", this.cfg.velocityDissipation);
    this.blit(vel.write);
    vel.swap();

    // 8. Advect dye
    if (!this.linear) this.u2f(prog.advection, "dyeTexelSize", dye.texelX, dye.texelY);
    this.u1i(prog.advection, "uVelocity", this.attachTex(vel.read, 0));
    this.u1i(prog.advection, "uSource", this.attachTex(dye.read, 1));
    this.u1f(prog.advection, "dissipation", this.cfg.densityDissipation + (this.fading ? FADE_OUT_DISSIPATION : 0));
    this.blit(dye.write);
    dye.swap();
  }

  private render() {
    if (!this.prog || !this.dye) return;
    const gl = this.gl;
    const prog = this.prog.display;
    const dye = this.dye;

    this.clearScreen();
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    this.bindProg(prog);
    this.u2f(prog, "texelSize", 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    this.u1i(prog, "uTexture", this.attachTex(dye.read, 0));
    this.blit(null);
  }

  private clearAll() {
    const gl = this.gl;
    const targets: (FBO | null)[] = [
      this.divergence,
      this.curlFbo,
      this.dye ? this.dye.read : null,
      this.dye ? this.dye.write : null,
      this.velocity ? this.velocity.read : null,
      this.velocity ? this.velocity.write : null,
      this.pressure ? this.pressure.read : null,
      this.pressure ? this.pressure.write : null,
    ];

    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    for (const t of targets) {
      if (t) {
        gl.viewport(0, 0, t.width, t.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.raw);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    }
    this.clearScreen();
  }

  private clearScreen() {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private bindProg(p: ProgramInfo) {
    this.gl.useProgram(p.raw);
  }

  private attachTex(fbo: FBO, slot: number): number {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + slot);
    gl.bindTexture(gl.TEXTURE_2D, fbo.texture);
    return slot;
  }

  private blit(target: FBO | null) {
    const gl = this.gl;
    if (target) {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.raw);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  private u1i(p: ProgramInfo, name: string, val: number) {
    const loc = p.uniforms[name];
    if (loc != null) this.gl.uniform1i(loc, val);
  }

  private u1f(p: ProgramInfo, name: string, val: number) {
    const loc = p.uniforms[name];
    if (loc != null) this.gl.uniform1f(loc, val);
  }

  private u2f(p: ProgramInfo, name: string, x: number, y: number) {
    const loc = p.uniforms[name];
    if (loc != null) this.gl.uniform2f(loc, x, y);
  }

  private u3f(p: ProgramInfo, name: string, x: number, y: number, z: number) {
    const loc = p.uniforms[name];
    if (loc != null) this.gl.uniform3f(loc, x, y, z);
  }

  private releaseGl() {
    const gl = this.gl;
    this.releaseTargets();
    this.textures.forEach((t) => gl.deleteTexture(t));
    this.fbos.forEach((f) => gl.deleteFramebuffer(f));
    this.programs.forEach((p) => gl.deleteProgram(p));
    this.shaders.forEach((s) => gl.deleteShader(s));
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    this.textures.clear();
    this.fbos.clear();
    this.programs.clear();
    this.shaders.clear();
    this.buffers.clear();
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.useProgram(null);
    this.prog = null;
    this.dye = null;
    this.velocity = null;
    this.divergence = null;
    this.curlFbo = null;
    this.pressure = null;
  }
}

export const PointerRipples: React.FC<PointerRipplesProps> = ({
  simResolution = 128,
  dyeResolution = 768,
  densityDissipation = 2.4,
  velocityDissipation = 1.6,
  pressure = 0.8,
  pressureIterations = 20,
  curl = 13,
  splatRadius = 0.24,
  splatForce = 4800,
  shading = true,
  colorSpeed = 0.055,
  colorStep = 0.012,
  colorSaturation = 0.72,
  colorValue = 1.0,
  colorIntensity = 0.26,
  idleMs = 4000,
  maxPixelRatio = 1.5,
  className = "fixed inset-0 pointer-events-none w-full h-full -z-10",
  style,
  opacity = 0.58,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;

    // Respect the OS-level reduced-motion preference by not starting the effect at all.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduceMotion.matches) return;

    let engine: FluidSimulationEngine | null = null;
    try {
      engine = new FluidSimulationEngine(canvas, {
        simResolution,
        dyeResolution,
        densityDissipation,
        velocityDissipation,
        pressure,
        pressureIterations,
        curl,
        splatRadius,
        splatForce,
        shading,
        colorSpeed,
        colorStep,
        colorSaturation,
        colorValue,
        colorIntensity,
        idleMs,
        maxPixelRatio,
      });
      engine.setVisible(!document.hidden);
    } catch (e) {
      // Graceful fallback when WebGL / float extensions unavailable
      return;
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!engine || !e.isPrimary) return;
      const events = (e as any).getCoalescedEvents?.() ?? [e];
      for (const ev of events) {
        engine.move(ev.clientX, ev.clientY);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!engine || !e.isPrimary) return;
      engine.splat(e.clientX, e.clientY);
    };

    const onVisibility = () => {
      engine?.setVisible(!document.hidden);
    };

    const onPointerLeave = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      engine?.releasePointer();
    };

    const onPointerCancel = () => {
      engine?.releasePointer();
    };

    const onWindowBlur = () => {
      engine?.releasePointer();
    };

    const onContextLost = (e: Event) => {
      // Preventing the default lets the browser attempt a restore instead of
      // leaving the canvas permanently blank.
      e.preventDefault();
      engine?.handleContextLost();
    };

    const onContextRestored = () => {
      engine?.handleContextRestored();
    };

    // Track the CSS box here so the frame loop never forces a layout read.
    const sizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const rect = entries[0]?.contentRect;
            if (!rect || !engine) return;
            engine.setViewportSize(rect.width, rect.height);
            engine.resize();
          });
    sizeObserver?.observe(canvas);

    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    window.addEventListener("pointercancel", onPointerCancel, { capture: true, passive: true });
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      sizeObserver?.disconnect();
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      engine?.destroy();
      engine = null;
    };
  }, [
    simResolution,
    dyeResolution,
    densityDissipation,
    velocityDissipation,
    pressure,
    pressureIterations,
    curl,
    splatRadius,
    splatForce,
    shading,
    colorSpeed,
    colorStep,
    colorSaturation,
    colorValue,
    colorIntensity,
    idleMs,
    maxPixelRatio,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={{
        opacity,
        ...style,
      }}
    />
  );
};

import { LEFT_WALL_INNER_PX, RIGHT_WALL_INNER_PX, VIEW } from '../sim/constants';

export interface BackgroundLayout {
  x: number; width: number; height: number; imageY: number; imageHeight: number;
}

/** Smoothed scene focus in [-1, 1], independent of physical world coordinates. */
export interface SceneryFocus { x: number; y: number }

/** Contain the complete environment inside the court, preserving its aspect ratio. */
export function resortBackgroundLayout(width: number, height: number, imageWidth: number, imageHeight: number): BackgroundLayout {
  const unit = width / VIEW.stageW;
  const left = Math.max(0, (LEFT_WALL_INNER_PX * VIEW.scale + VIEW.offsetX) * unit);
  const right = Math.min(width, (RIGHT_WALL_INNER_PX * VIEW.scale + VIEW.offsetX) * unit);
  const scale = Math.min((right - left) / imageWidth, height / imageHeight);
  const fittedWidth = imageWidth * scale, fittedHeight = imageHeight * scale;
  return { x: left + (right - left - fittedWidth) / 2, width: fittedWidth, height,
    imageY: height - fittedHeight, imageHeight: fittedHeight };
}

/** A travelling gust drives both the palm layer and the near-camera plants. */
export function resortWind(seconds: number, x: number): number {
  const phase = ((seconds / 18 - x * 0.24) % 1 + 1) % 1;
  const gust = Math.exp(-(((phase - 0.42) / 0.12) ** 2));
  return 0.32 * Math.sin(seconds * 0.72 - x * 2.4)
    + 0.12 * Math.sin(seconds * 1.31 - x * 4.1) + 0.8 * gust;
}

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image, u_foliage;
uniform float u_time, u_height_ratio, u_motion, u_layer;
uniform vec2 u_focus;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  return noise(p) * 0.57 + noise(p * 2.03 + 9.7) * 0.28 + noise(p * 4.11 + 21.3) * 0.15;
}
float wind(float x) {
  float phase = fract(u_time / 18.0 - x * 0.24);
  float gust = exp(-pow((phase - 0.42) / 0.12, 2.0));
  return 0.32 * sin(u_time * 0.72 - x * 2.4)
    + 0.12 * sin(u_time * 1.31 - x * 4.1) + 0.8 * gust;
}
vec4 plate(vec2 p) { return texture2D(u_image, vec2(clamp(p.x, 0.0, 1.0), 1.0 - clamp(p.y, 0.0, 1.0))); }

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y * u_height_ratio);
  float t = u_time;
  if (u_layer < 0.5) {
    // A rigid distant plate: foliage and water deformation cannot touch the hotel.
    vec3 color = plate(p).rgb;
    color = mix(color, vec3(0.012, 0.035, 0.11), smoothstep(0.0, 0.12, max(0.0, -p.y)));
    gl_FragColor = vec4(color, 1.0); return;
  }
  if (p.y < 0.0 || p.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  if (u_layer < 1.5) {
    // Thin clouds have their own opacity and drift across a clean sky plate.
    float sky = smoothstep(0.025, 0.08, p.y) * (1.0 - smoothstep(0.31, 0.43, p.y));
    float n = fbm(vec2(p.x * 6.5 - t * 0.017, p.y * 30.0 + 1.8));
    float wisps = smoothstep(0.49, 0.77, n);
    float bands = 0.55 + 0.45 * sin(p.y * 39.0 + p.x * 3.0);
    float a = wisps * sky * bands * 0.23;
    gl_FragColor = vec4(vec3(0.25, 0.34, 0.49) * a, a); return;
  }
  if (u_layer < 2.5) {
    // The coast rises on the right below the hotel; only the ocean receives motion.
    float coast = 0.46 + 0.019 * smoothstep(0.69, 1.0, p.x);
    float mask = smoothstep(coast + 0.004, coast + 0.018, p.y)
      * (1.0 - smoothstep(0.707, 0.732, p.y));
    if (mask < 0.001) { gl_FragColor = vec4(0.0); return; }
    float depth = clamp((p.y - 0.46) / 0.265, 0.0, 1.0);
    float scale = mix(0.24, 1.0, depth);
    float flow = sin(p.x * 67.0 / scale + p.y * 31.0 - t * 1.2);
    float cross = sin(p.x * 131.0 / scale - p.y * 81.0 + t * 0.81);
    vec2 drift = vec2(flow * (0.0008 + depth * 0.0035), cross * (0.0004 + depth * 0.002));
    vec3 color = plate(p + drift * u_motion).rgb;
    float ripples = noise(vec2(p.x * 190.0 / scale + t * 0.5, p.y * 440.0 - t * 1.7));
    color *= 1.0 + (ripples - 0.5) * 0.18 * u_motion;
    // A lunar path, broken into short sparkling wavelets, follows surface waves.
    float pathWidth = mix(0.022, 0.13, depth);
    float path = exp(-pow((p.x - 0.665 + flow * 0.004) / pathWidth, 2.0));
    float shimmer = pow(max(0.0, sin(p.y * 740.0 / scale - t * 1.9 + flow * 1.4)), 10.0);
    shimmer *= smoothstep(0.48, 0.73, noise(vec2(p.x * 240.0 / scale + t * 0.2, p.y * 380.0 - t * 0.4)));
    color += vec3(0.52, 0.63, 0.77) * path * shimmer * 0.52 * u_motion;
    // Shoreward fronts arrive, break unevenly and fade on the wet sand.
    for (int i = 0; i < 3; i++) {
      float age = fract(t * 0.095 + float(i) / 3.0);
      float front = mix(0.565, 0.724, age);
      float curl = sin(p.x * 23.0 + float(i) * 2.1 + t * 0.17) * 0.0025
        + (noise(vec2(p.x * 43.0, float(i) * 5.0 + t * 0.07)) - 0.5) * 0.005;
      float distance = p.y - front - curl;
      float crest = exp(-pow(distance / mix(0.0015, 0.004, age), 2.0));
      float trail = exp(-abs(distance + 0.005) / 0.008) * 0.18;
      float broken = 0.35 + 0.65 * noise(vec2(p.x * 95.0 + t * 0.35, float(i) * 11.0));
      float life = smoothstep(0.0, 0.18, age) * (1.0 - smoothstep(0.83, 1.0, age));
      color = mix(color, vec3(0.40, 0.57, 0.67), (crest + trail) * broken * life * 0.70 * u_motion);
    }
    gl_FragColor = vec4(color * mask, mask); return;
  }
  // Empty pixels in the alpha layer reveal the clean plate, rather than pulling
  // adjacent sky or sea around with the foliage. The crown hub stays nearly fixed.
  vec2 q = p + u_focus * vec2(0.008, 0.0035) * u_motion;
  float left = 1.0 - smoothstep(0.40, 0.60, q.x);
  float wx = wind(mix(0.90, 0.16, left));
  float rooted = pow(clamp((0.73 - q.y) / 0.60, 0.0, 1.0), 2.0);
  vec2 root = mix(vec2(0.9, 0.13), vec2(0.16, 0.14), left);
  float crown = 1.0 - smoothstep(0.26, 0.31, q.y);
  float tip = smoothstep(0.035, 0.21, length((q - root) * vec2(1.0, 0.63)));
  float flutter = sin(t * 1.7 - q.x * 38.0 + q.y * 17.0);
  float smallPalm = (1.0 - smoothstep(0.32, 0.39, q.x))
    * smoothstep(0.27, 0.31, q.y) * (1.0 - smoothstep(0.43, 0.48, q.y));
  float bush = smoothstep(0.51, 0.57, q.y) * (1.0 - smoothstep(0.67, 0.735, q.y));
  vec2 bend = vec2(0.0022 * wx * rooted, 0.0);
  bend += vec2(0.008 * wx + 0.0013 * flutter, 0.002 * wx * sin(q.x * 25.0)) * crown * tip;
  bend += vec2(0.004 * wind(q.x) + 0.0008 * flutter, 0.001 * flutter) * smallPalm;
  bend += vec2(0.0032 * wind(q.x), 0.0007 * flutter) * bush;
  q += bend * u_motion;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  gl_FragColor = texture2D(u_foliage, vec2(q.x, 1.0 - q.y));
}`;

/** Four GPU passes: clean plate, clouds, water, and independent transparent foliage. */
export class ResortBackground {
  private readonly surface = document.createElement('canvas');
  private readonly gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private time: WebGLUniformLocation | null = null;
  private ratio: WebGLUniformLocation | null = null;
  private motion: WebGLUniformLocation | null = null;
  private focus: WebGLUniformLocation | null = null;
  private layer: WebGLUniformLocation | null = null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly image: HTMLImageElement, private readonly foliage: HTMLImageElement) {
    this.gl = this.surface.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    if (this.gl) this.initialize(this.gl);
    this.surface.addEventListener('webglcontextlost', event => { event.preventDefault(); this.program = null; });
    this.surface.addEventListener('webglcontextrestored', () => { if (this.gl) this.initialize(this.gl); });
  }

  private initialize(gl: WebGLRenderingContext): void {
    const shader = (type: number, source: string): WebGLShader | null => {
      const result = gl.createShader(type);
      if (!result) return null;
      gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); return null; }
      return result;
    };
    const vertex = shader(gl.VERTEX_SHADER, VERTEX), fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return; }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    for (const [index, image] of [this.image, this.foliage].entries()) {
      gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_foliage'), 1);
    this.time = gl.getUniformLocation(program, 'u_time');
    this.ratio = gl.getUniformLocation(program, 'u_height_ratio');
    this.motion = gl.getUniformLocation(program, 'u_motion');
    this.focus = gl.getUniformLocation(program, 'u_focus');
    this.layer = gl.getUniformLocation(program, 'u_layer');
    this.program = program;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number, focus: SceneryFocus = { x: 0, y: 0 }): void {
    const fit = resortBackgroundLayout(width, height, this.image.naturalWidth, this.image.naturalHeight);
    ctx.fillStyle = '#03091c'; ctx.fillRect(0, 0, width, height);
    const k = Math.abs(ctx.getTransform().a);
    const w = Math.max(1, Math.round(fit.width * k)), h = Math.max(1, Math.round(height * k));
    const enabled = !this.reducedMotion.matches;
    if (this.gl && this.program && !this.gl.isContextLost()) {
      if (this.surface.width !== w || this.surface.height !== h) { this.surface.width = w; this.surface.height = h; }
      const gl = this.gl;
      gl.viewport(0, 0, w, h); gl.useProgram(this.program);
      gl.uniform1f(this.time, enabled ? seconds : 0);
      gl.uniform1f(this.ratio, height / fit.imageHeight);
      gl.uniform1f(this.motion, enabled ? 1 : 0);
      gl.uniform2f(this.focus, enabled ? focus.x : 0, enabled ? focus.y : 0);
      gl.disable(gl.BLEND); gl.uniform1f(this.layer, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const layer of [1, 2, 3]) { gl.uniform1f(this.layer, layer); gl.drawArrays(gl.TRIANGLES, 0, 6); }
      ctx.drawImage(this.surface, fit.x, 0, fit.width, height);
    } else {
      // Both registered plates remain visible when WebGL is unavailable or lost.
      ctx.drawImage(this.image, fit.x, fit.imageY, fit.width, fit.imageHeight);
      ctx.drawImage(this.foliage, fit.x, fit.imageY, fit.width, fit.imageHeight);
    }
  }
}

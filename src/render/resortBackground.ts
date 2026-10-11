import { LEFT_WALL_INNER_PX, RIGHT_WALL_INNER_PX, VIEW } from '../sim/constants';

export interface BackgroundLayout {
  x: number;
  width: number;
  height: number;
  imageY: number;
  imageHeight: number;
}

/** Contain the whole photograph inside the visible court, preserving its aspect ratio. */
export function resortBackgroundLayout(width: number, height: number, imageWidth: number, imageHeight: number): BackgroundLayout {
  const unit = width / VIEW.stageW;
  const left = Math.max(0, (LEFT_WALL_INNER_PX * VIEW.scale + VIEW.offsetX) * unit);
  const right = Math.min(width, (RIGHT_WALL_INNER_PX * VIEW.scale + VIEW.offsetX) * unit);
  const available = right - left;
  const scale = Math.min(available / imageWidth, height / imageHeight);
  const fittedWidth = imageWidth * scale;
  const fittedHeight = imageHeight * scale;
  return { x: left + (available - fittedWidth) / 2, width: fittedWidth, height,
    imageY: height - fittedHeight, imageHeight: fittedHeight };
}

const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_image;
uniform float u_time;
uniform float u_height_ratio;
uniform float u_motion;

float crown(vec2 p, vec2 center, vec2 radius) {
  return 1.0 - smoothstep(0.38, 1.0, length((p - center) / radius));
}

void main() {
  // Top-down photograph coordinates; the full image is bottom-aligned, never cropped.
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y * u_height_ratio);
  float above = max(0.0, -p.y);
  vec2 q = clamp(p, vec2(0.0), vec2(1.0));
  float t = u_time;

  // Crown masks taper to zero toward each trunk and surrounding masonry.
  float palms = crown(q, vec2(0.045, 0.12), vec2(0.155, 0.255));
  palms += crown(q, vec2(0.056, 0.444), vec2(0.135, 0.145));
  palms += 0.4 * crown(q, vec2(0.849, 0.235), vec2(0.044, 0.057));
  palms += 0.4 * crown(q, vec2(0.775, 0.292), vec2(0.045, 0.063));
  palms += 0.4 * crown(q, vec2(0.705, 0.327), vec2(0.045, 0.068));
  palms += 0.35 * crown(q, vec2(0.625, 0.376), vec2(0.045, 0.065));
  palms += 0.3 * crown(q, vec2(0.534, 0.442), vec2(0.038, 0.058));
  palms = min(1.0, palms) * (1.0 - smoothstep(0.0, 0.025, above));
  float breeze = sin(t * 0.72) + 0.3 * sin(t * 1.31 + q.y * 13.0);
  vec2 offset = vec2(0.0025 * breeze, 0.00065 * sin(t * 0.93 + q.x * 9.0)) * palms;

  // Water-only ripples: boats, cliffs, buildings and foreground sand stay still.
  float water = smoothstep(0.697, 0.724, q.y) * (1.0 - smoothstep(0.822, 0.862, q.y));
  water *= smoothstep(0.045, 0.16, q.x) * (1.0 - smoothstep(0.9, 0.98, q.x));
  offset.x += water * (0.0015 * sin(q.y * 270.0 - t * 1.15) + 0.0005 * sin(q.x * 95.0 + q.y * 170.0 + t * 0.67));
  offset.y += water * 0.00085 * sin(q.x * 130.0 - q.y * 160.0 + t * 0.82);
  float foam = smoothstep(0.843, 0.861, q.y) * (1.0 - smoothstep(0.872, 0.886, q.y));
  foam *= smoothstep(0.13, 0.25, q.x) * (1.0 - smoothstep(0.79, 0.9, q.x));
  offset.y += foam * 0.0011 * sin(t * 0.66 + q.x * 27.0);

  // A subtle downward shimmer inside the main waterfall.
  float fall = crown(q, vec2(0.646, 0.608), vec2(0.032, 0.089));
  fall += crown(q, vec2(0.97, 0.626), vec2(0.023, 0.064));
  fall += crown(q, vec2(0.718, 0.484), vec2(0.013, 0.042));
  offset.y += fall * 0.0015 * sin(q.y * 180.0 - t * 2.7);

  vec2 sampleAt = clamp(q + offset * u_motion, vec2(0.0), vec2(1.0));
  vec3 color = texture2D(u_image, vec2(sampleAt.x, 1.0 - sampleAt.y)).rgb;
  float highlight = smoothstep(0.72, 0.98, max(color.r, max(color.g, color.b)));
  float sparkle = pow(max(0.0, sin(q.x * 110.0 + q.y * 510.0 - t * 1.4)), 16.0);
  color += water * highlight * sparkle * 0.045 * u_motion;
  // The narrow contain margin continues the sky, without stretching the photograph.
  color = mix(color, vec3(0.012, 0.035, 0.11), smoothstep(0.0, 0.12, above));
  gl_FragColor = vec4(color, 1.0);
}`;

/** One reusable GPU surface; image-space animation is independent of game physics. */
export class ResortBackground {
  private readonly surface = document.createElement('canvas');
  private readonly gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private time: WebGLUniformLocation | null = null;
  private ratio: WebGLUniformLocation | null = null;
  private motion: WebGLUniformLocation | null = null;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly image: HTMLImageElement) {
    this.gl = this.surface.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    if (this.gl) this.initialize(this.gl);
    this.surface.addEventListener('webglcontextlost', event => { event.preventDefault(); this.program = null; });
    this.surface.addEventListener('webglcontextrestored', () => { if (this.gl) this.initialize(this.gl); });
  }

  private initialize(gl: WebGLRenderingContext): void {
    const shader = (type: number, source: string): WebGLShader | null => {
      const result = gl.createShader(type);
      if (!result) return null;
      gl.shaderSource(result, source);
      gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); return null; }
      return result;
    };
    const vertex = shader(gl.VERTEX_SHADER, VERTEX);
    const fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, this.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    this.time = gl.getUniformLocation(program, 'u_time');
    this.ratio = gl.getUniformLocation(program, 'u_height_ratio');
    this.motion = gl.getUniformLocation(program, 'u_motion');
    this.program = program;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, seconds: number): void {
    const fit = resortBackgroundLayout(width, height, this.image.naturalWidth, this.image.naturalHeight);
    // Fill subpixel contain margins; the cached court covers the outer wall areas.
    ctx.fillStyle = '#03091c';
    ctx.fillRect(0, 0, width, height);
    const k = Math.abs(ctx.getTransform().a);
    const w = Math.max(1, Math.round(fit.width * k));
    const h = Math.max(1, Math.round(height * k));
    if (this.gl && this.program && !this.gl.isContextLost()) {
      if (this.surface.width !== w || this.surface.height !== h) { this.surface.width = w; this.surface.height = h; }
      const gl = this.gl;
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.program);
      gl.uniform1f(this.time, seconds);
      gl.uniform1f(this.ratio, height / fit.imageHeight);
      gl.uniform1f(this.motion, this.reducedMotion.matches ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      ctx.drawImage(this.surface, fit.x, 0, fit.width, height);
    } else {
      // Static contain fallback for devices without WebGL, also preserving every edge.
      ctx.fillStyle = '#03091c';
      ctx.fillRect(fit.x, 0, fit.width, height);
      ctx.drawImage(this.image, fit.x, fit.imageY, fit.width, fit.imageHeight);
    }
  }
}

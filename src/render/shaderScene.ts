import type { PartName } from '../sim/constants';
import type { Player } from '../sim/player';
import { DRAW_ORDER } from './dollArt';
import type { PoseSource } from './dollPose';

type Volume = readonly [x: number, y: number, rx: number, ry: number];

/** Joint frames describe a single smoothly fused body, not separate drawn parts. */
const VOLUMES: Record<PartName, readonly Volume[]> = {
  Head: [[0, 0, 10.6, 12]],
  Tors: [[0, 0, 17, 23], [0, -20, 6, 10]],
  Ass: [[0, 1, 16, 11]],
  ArmLeft: [[0, 0, 16, 8]], ArmRight: [[0, 0, 16, 8]],
  HandLeft: [[0, 0, 15, 7]], HandRight: [[0, 0, 15, 7]],
  FingerLeft: [[-1, 0, 7, 5.5]], FingerRight: [[1, 0, 7, 5.5]],
  LegLeft: [[0, -2, 9, 21]], LegRight: [[0, -2, 9, 21]],
  FootLeft: [[-1, 5, 8, 17]], FootRight: [[1, 5, 8, 17]],
};

const VERTEX = `
attribute vec2 a_position;
uniform vec2 u_resolution;
void main() {
  gl_Position = vec4(a_position / u_resolution * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
}`;

/** Original GLSL inspired by Silk Curtain, Fluid Chrome and Glass on shaders.com. */
const FRAGMENT = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time, u_floor, u_material, u_blend, u_thickness;
uniform vec4 u_background_map;
uniform int u_count;
uniform vec4 u_shapes[16];
uniform vec2 u_rotations[16];
uniform sampler2D u_scene;

float bodyDistance(vec2 p) {
  float result = 100000.0;
  for (int i = 0; i < 16; i++) {
    if (i >= u_count) break;
    vec4 shape = u_shapes[i];
    vec2 rotation = u_rotations[i];
    vec2 q = p - shape.xy;
    q = vec2(rotation.x * q.x + rotation.y * q.y, -rotation.y * q.x + rotation.x * q.y);
    float k0 = length(q / shape.zw);
    float k1 = length(q / (shape.zw * shape.zw));
    float distance = k1 > 0.00001 ? k0 * (k0 - 1.0) / k1 : -min(shape.z, shape.w);
    float h = clamp(0.5 + 0.5 * (distance - result) / u_blend, 0.0, 1.0);
    result = mix(distance, result, h) - u_blend * h * (1.0 - h);
  }
  return result;
}


vec3 silk(vec2 uv) {
  float t = u_time * 0.13;
  vec2 p = uv;
  p.x += sin(p.y * 5.4 + t * 0.7) * 0.16;
  p.y += sin(p.x * 4.2 - t * 0.9) * 0.10;
  vec3 color = mix(vec3(0.016, 0.029, 0.055), vec3(0.025, 0.085, 0.13), uv.y);
  for (int i = 0; i < 4; i++) {
    float k = float(i);
    float frequency = 3.0 + k * 0.55 + sin(t * 0.3 + k) * 0.6;
    float center = 0.08 + k * 0.22 + sin(p.x * frequency + t + k * 1.7) * 0.20;
    center += (p.x - 0.5) * (p.x - 0.5) * (0.9 - k * 0.2);
    float d = p.y - center;
    float fold = exp(-abs(d) * 20.0);
    float edge = exp(-abs(d + 0.014) * 140.0);
    float shoulder = exp(-abs(d - 0.028) * 32.0);
    vec3 tint = mix(vec3(0.08, 0.47, 0.74), vec3(0.63, 0.67, 0.69), 0.5 + 0.5 * sin(k * 2.1 + t * 0.32));
    color += tint * (fold * 0.48 + edge * 0.32 + shoulder * 0.32);
  }
  // Reserve a quieter region immediately behind the rally.
  float quiet = smoothstep(0.48, 0.86, uv.y) * (1.0 - smoothstep(0.15, 0.55, abs(uv.x - 0.5)));
  color *= 1.0 - quiet * 0.32;
  return color;
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_resolution;
  if (u_material < 0.0) {
    vec2 backgroundUV = uv * u_background_map.zw + u_background_map.xy;
    vec3 color = silk(vec2(backgroundUV.x, backgroundUV.y / max(u_floor, 0.1)));
    if (backgroundUV.y > u_floor) {
      float depth = backgroundUV.y - u_floor;
      vec2 reflected = vec2(backgroundUV.x, 1.0 - depth * 3.0);
      reflected.x += sin(backgroundUV.y * 320.0 + u_time * 0.25) * 0.001;
      color = silk(reflected) * exp(-depth * 13.0) * 0.32 + vec3(0.009, 0.02, 0.035);
      color += vec3(0.2, 0.51, 0.65) * exp(-depth * 140.0) * 0.18;
    }
    gl_FragColor = vec4(color, 1.0); return;
  }
  vec2 pixel = uv * u_resolution;
  float distance = bodyDistance(pixel);
  if (distance > 0.8) discard;
  // Derive normals from the fused silhouette, so highlights never restart at joints.
  float epsilon = 0.65;
  vec2 gradient = vec2(bodyDistance(pixel + vec2(epsilon, 0.0)) - bodyDistance(pixel - vec2(epsilon, 0.0)),
    bodyDistance(pixel + vec2(0.0, epsilon)) - bodyDistance(pixel - vec2(0.0, epsilon)));
  float edge = clamp(1.0 + distance / u_thickness, 0.0, 1.0);
  float z = sqrt(max(0.001, 1.0 - edge * edge));
  vec2 xy = gradient / max(length(gradient), 0.001) * edge;
  vec3 normal = normalize(vec3(xy, z));
  float fresnel = pow(1.0 - z, 2.4);
  float light = max(0.0, dot(normal, normalize(vec3(-0.45, -0.65, 0.65))));
  float spec = pow(light, 34.0);
  float t = u_time * 0.15;
  float band = sin(normal.x * 2.8 + normal.y * 1.8 + z * 2.0 + t);
  float bright = exp(-pow((band - 0.76) * 4.0, 2.0));
  vec3 color;
  if (u_material < 1.5) {
    // Sample the actual court beneath the surface, including the central divider.
    vec2 bend = xy * u_thickness / u_resolution * (0.4 + z * 0.5);
    vec2 sampleUV = clamp(uv + bend, vec2(0.001), vec2(0.999));
    color = texture2D(u_scene, sampleUV).rgb * vec3(0.88, 0.98, 1.03);
    color += vec3(0.10, 0.24, 0.30) * z * 0.52;
    color += vec3(0.42, 0.85, 1.0) * fresnel * 0.95;
    color += vec3(0.66, 0.88, 1.0) * (spec * 0.9 + bright * 0.36 + light * 0.10);
    color += vec3(0.35, 0.65, 0.78) * pow(1.0 - z, 9.0) * 0.65;
  } else {
    // Rounded normals reflect broad moving studio bands rather than flat gradients.
    color = mix(vec3(0.16, 0.21, 0.26), vec3(0.60, 0.68, 0.73), smoothstep(-0.65, 0.68, band));
    color += vec3(0.8, 0.88, 0.94) * bright * 0.45;
    color += vec3(0.9, 0.75, 0.55) * pow(max(0.0, normal.x * 0.7 + normal.y * -0.1), 4.0) * 0.6;
    color += vec3(0.65, 0.83, 0.94) * fresnel * 0.52 + spec * 0.55;
    color *= 0.75 + light * 0.25;
  }
  float alpha = 1.0 - smoothstep(-0.7, 0.7, distance);
  gl_FragColor = vec4(color * alpha, alpha);
}`;

interface Shape { x: number; y: number; rx: number; ry: number; angle: number }
interface PlayerSurface { shapes: Shape[]; material: 1 | 2; unit: number }

/** One reusable GPU surface, with a background pass and one continuous material pass per player. */
export class ShaderScene {
  private readonly surface = document.createElement('canvas');
  private readonly gl = this.surface.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
  });
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private readonly sceneTexture = document.createElement('canvas');
  private floor = 0.84;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor() {
    this.initialize();
    this.surface.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.program = null;
    });
    this.surface.addEventListener('webglcontextrestored', () => this.initialize());
  }

  private initialize(): void {
    const gl = this.gl;
    if (!gl) return;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('Arena shader compilation failed:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader); return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX), fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vertex || !fragment) { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); return; }
    const program = gl.createProgram();
    if (!program) { gl.deleteShader(vertex); gl.deleteShader(fragment); return; }
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return; }
    this.program = program;
    this.buffer = gl.createBuffer(); this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  private render(ctx: CanvasRenderingContext2D, players: readonly PlayerSurface[] | null, seconds: number, floor = 0.84,
    backgroundMap: readonly number[] = [0, 0, 1, 1]): boolean {
    const gl = this.gl, program = this.program;
    if (!gl || !program || !this.buffer || !this.texture) return false;
    // Cap GPU work on high-DPI displays; compositing retains the canvas resolution.
    const scale = Math.min(1, 1600 / ctx.canvas.width);
    const w = Math.max(1, Math.round(ctx.canvas.width * scale));
    const h = Math.max(1, Math.round(ctx.canvas.height * scale));
    if (this.surface.width !== w || this.surface.height !== h) { this.surface.width = w; this.surface.height = h; }
    gl.viewport(0, 0, w, h); gl.useProgram(program);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), w, h);
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), this.reducedMotion.matches ? 0 : seconds);
    gl.uniform1f(gl.getUniformLocation(program, 'u_floor'), floor);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_background_map'), backgroundMap);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(gl.getUniformLocation(program, 'u_scene'), 0);
    if (players) {
      if (this.sceneTexture.width !== w || this.sceneTexture.height !== h) {
        this.sceneTexture.width = w; this.sceneTexture.height = h;
      }
      this.sceneTexture.getContext('2d')!.drawImage(ctx.canvas, 0, 0, w, h);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sceneTexture);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const quad = (left: number, top: number, right: number, bottom: number) => {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([left, top, right, top, left, bottom, left, bottom, right, top, right, bottom]), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    if (!players) {
      gl.uniform1f(gl.getUniformLocation(program, 'u_material'), -1);
      quad(0, 0, w, h);
    } else for (const player of players) {
      const shapes = new Float32Array(64), rotations = new Float32Array(32);
      let left = w, top = h, right = 0, bottom = 0;
      player.shapes.forEach((shape, i) => {
        shapes.set([shape.x * scale, shape.y * scale, shape.rx * scale, shape.ry * scale], i * 4);
        rotations.set([Math.cos(shape.angle), Math.sin(shape.angle)], i * 2);
        const radius = Math.max(shape.rx, shape.ry) * scale + player.unit * scale * 5;
        left = Math.min(left, shape.x * scale - radius); top = Math.min(top, shape.y * scale - radius);
        right = Math.max(right, shape.x * scale + radius); bottom = Math.max(bottom, shape.y * scale + radius);
      });
      gl.uniform1i(gl.getUniformLocation(program, 'u_count'), player.shapes.length);
      gl.uniform4fv(gl.getUniformLocation(program, 'u_shapes[0]'), shapes);
      gl.uniform2fv(gl.getUniformLocation(program, 'u_rotations[0]'), rotations);
      gl.uniform1f(gl.getUniformLocation(program, 'u_blend'), Math.max(0.5, player.unit * scale * 5));
      gl.uniform1f(gl.getUniformLocation(program, 'u_thickness'), Math.max(1, player.unit * scale * 13));
      gl.uniform1f(gl.getUniformLocation(program, 'u_material'), player.material);
      quad(left, top, right, bottom);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (players) {
      const floorY = this.floor * ctx.canvas.height;
      ctx.save(); ctx.beginPath(); ctx.rect(0, floorY, ctx.canvas.width, ctx.canvas.height - floorY); ctx.clip();
      ctx.globalAlpha = 0.16; ctx.translate(0, floorY * 1.28); ctx.scale(1, -0.28);
      ctx.drawImage(this.surface, 0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
    }
    ctx.drawImage(this.surface, 0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
    return true;
  }

  drawBackground(ctx: CanvasRenderingContext2D, seconds: number, floor: number,
    backgroundMap: readonly number[] = [0, 0, 1, 1]): void {
    this.floor = floor;
    if (this.render(ctx, null, seconds, floor, backgroundMap)) return;
    // A fluid Canvas fallback keeps the court usable when WebGL is unavailable.
    const t = this.reducedMotion.matches ? 0 : seconds * 0.1;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#071321'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (let i = 0; i < 3; i++) {
      const x = ctx.canvas.width * (0.5 + Math.sin(t + i * 2) * 0.35 - backgroundMap[0]) / backgroundMap[2];
      const y = ctx.canvas.height * (0.35 + Math.cos(t * 0.7 + i) * 0.2 - backgroundMap[1]) / backgroundMap[3];
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, ctx.canvas.width / backgroundMap[2] * 0.55);
      gradient.addColorStop(0, 'rgba(55,146,188,0.25)'); gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.restore();
  }

  drawPlayers(ctx: CanvasRenderingContext2D, players: readonly Player[], poses: PoseSource, alpha: number, seconds: number): void {
    const transform = ctx.getTransform();
    const unit = Math.hypot(transform.a, transform.b);
    const surfaces: PlayerSurface[] = [];
    for (const p of players) {
      const shapes: Shape[] = [];
      for (const name of DRAW_ORDER) {
        const pose = poses.pose(p.part(name), alpha);
        const c = Math.cos(pose.a), s = Math.sin(pose.a);
        for (const [x, y, rx, ry] of VOLUMES[name]) {
          const wx = pose.x + (c * x - s * y) * p.sizeScale;
          const wy = pose.y + (s * x + c * y) * p.sizeScale;
          shapes.push({ x: transform.a * wx + transform.c * wy + transform.e,
            y: transform.b * wx + transform.d * wy + transform.f,
            rx: rx * unit * p.sizeScale, ry: ry * unit * p.sizeScale, angle: pose.a });
        }
      }
      surfaces.push({shapes, material: p.id, unit: unit * p.sizeScale});
    }
    if (this.render(ctx, surfaces, seconds)) return;
    // Build one opacity mask per player; a single material fill has no internal seams.
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const player of surfaces) {
      const mask = this.sceneTexture;
      if (mask.width !== ctx.canvas.width || mask.height !== ctx.canvas.height) {
        mask.width = ctx.canvas.width; mask.height = ctx.canvas.height;
      }
      const paint = mask.getContext('2d')!;
      paint.clearRect(0, 0, mask.width, mask.height); paint.fillStyle = '#fff';
      let left = mask.width, top = mask.height, right = 0, bottom = 0;
      paint.beginPath();
      for (const shape of player.shapes) {
        paint.save(); paint.translate(shape.x, shape.y); paint.rotate(shape.angle);
        paint.moveTo(shape.rx, 0); paint.ellipse(0, 0, shape.rx, shape.ry, 0, 0, Math.PI * 2); paint.restore();
        const r = Math.max(shape.rx, shape.ry);
        left = Math.min(left, shape.x - r); right = Math.max(right, shape.x + r);
        top = Math.min(top, shape.y - r); bottom = Math.max(bottom, shape.y + r);
      }
      paint.fill(); paint.globalCompositeOperation = 'source-in';
      const fill = paint.createLinearGradient(left, top, right, bottom);
      fill.addColorStop(0, player.material === 1 ? 'rgba(167,234,255,0.65)' : '#dae8ef');
      fill.addColorStop(0.45, player.material === 1 ? 'rgba(61,135,168,0.25)' : '#475766');
      fill.addColorStop(0.75, player.material === 1 ? 'rgba(112,207,243,0.5)' : '#d7c2a7');
      fill.addColorStop(1, '#80b6cc');
      paint.fillStyle = fill; paint.fillRect(0, 0, mask.width, mask.height);
      paint.globalCompositeOperation = 'source-over';
      ctx.shadowColor = player.material === 1 ? '#9ce7ff' : '#c9deed'; ctx.shadowBlur = player.unit * 1.5;
      ctx.drawImage(mask, 0, 0);
    }
    ctx.restore();
  }
}

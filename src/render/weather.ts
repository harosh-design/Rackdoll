export const WEATHER_OPTIONS = [
  { id: 'rain', label: 'Light rain', caption: 'Distant lightning', description: 'A light drizzle with soft, occasional lightning behind the trees.' },
  { id: 'snow', label: 'Snowfall', caption: 'Drifting flakes', description: 'Slow snow in three layers, with a few larger flakes close to the camera.' },
  { id: 'autumn', label: 'Autumn night', caption: 'Leaves & stars', description: 'A clear, starry sky with occasional gusts of tumbling autumn leaves.' },
] as const;

export type WeatherId = typeof WEATHER_OPTIONS[number]['id'];
export type WeatherChoice = 'random' | WeatherId;
type Layer = 'distant' | 'court' | 'foreground';

/** Resolve once per match; automatic weather avoids the previous match's sky. */
export function pickWeather(choice: WeatherChoice, previous?: WeatherId, random = Math.random): WeatherId {
  if (choice !== 'random') return choice;
  const candidates = WEATHER_OPTIONS.filter(option => option.id !== previous);
  return candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))].id;
}

interface Particle {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
  spin: number;
  variant: number;
}

const TAU = Math.PI * 2;
const wrap = (value: number, span: number) => ((value % span) + span) % span;
const DENSITY = [0.4, 0.65, 1] as const;
const QUALITY = ['low', 'medium', 'high'] as const;
const LEAF_COLORS = ['#c48a4e', '#b46551', '#c9aa68'] as const;

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width); canvas.height = Math.ceil(height);
  return canvas;
}

/** Small shared stamps are independent of stage size and device pixel ratio. */
const cloudStamps: Partial<Record<WeatherId, HTMLCanvasElement>> = {};
let starGlow: HTMLCanvasElement | undefined;
let lightningGlow: HTMLCanvasElement | undefined;
let leafStamps: HTMLCanvasElement[] | undefined;

function glowStamp(color: string, size: number, strength = 1): HTMLCanvasElement {
  const canvas = canvasOf(size, size), ctx = canvas.getContext('2d')!;
  const center = size / 2;
  const glow = ctx.createRadialGradient(center, center, 0, center, center, center);
  glow.addColorStop(0, `rgba(${color},${strength})`); glow.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = glow; ctx.fillRect(0, 0, size, size);
  return canvas;
}

function cloudStamp(id: WeatherId): HTMLCanvasElement {
  let canvas = cloudStamps[id];
  if (canvas) return canvas;
  canvas = canvasOf(384, 112);
  const ctx = canvas.getContext('2d')!;
  const color = id === 'rain' ? '22,27,47' : '192,204,216';
  const opacity = id === 'rain' ? 0.2 : 0.055;
  ctx.translate(192, 56); ctx.rotate(-0.035); ctx.scale(1, 0.2);
  const mist = ctx.createRadialGradient(0, 0, 0, 0, 0, 180);
  mist.addColorStop(0, `rgba(${color},${opacity})`);
  mist.addColorStop(0.45, `rgba(${color},${opacity * 0.55})`);
  mist.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = mist; ctx.fillRect(-180, -180, 360, 360);
  cloudStamps[id] = canvas;
  return canvas;
}

function leaves(): HTMLCanvasElement[] {
  return leafStamps ??= LEAF_COLORS.map(color => {
    const canvas = canvasOf(32, 48), ctx = canvas.getContext('2d')!;
    ctx.translate(16, 21); ctx.fillStyle = color; ctx.strokeStyle = '#483244'; ctx.lineWidth = 0.75;
    ctx.beginPath(); ctx.moveTo(0, -10);
    ctx.bezierCurveTo(9.5, -4, 6.5, 6.5, 0, 10);
    ctx.bezierCurveTo(-8, 2.5, -5.5, -6.5, 0, -10);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -6.5); ctx.lineTo(0, 13.5); ctx.stroke();
    return canvas;
  });
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Decorative only. Absolute elapsed time makes pause, resize and frame rate stable. */
export class WeatherEffects {
  private readonly particles: Record<Layer, Particle[]>;
  private readonly stars: Particle[];
  private readonly twinkles: Particle[];
  private readonly seed: number;
  private qualityIndex = 2;
  private sampleSeconds = 0;
  private sampleFrames = 0;
  private recoveryWindows = 0;
  private tint?: CanvasGradient;
  private tintContext?: CanvasRenderingContext2D;
  private tintFloor = 0;
  private tintPixels = 0;
  private starPoints?: Path2D;
  private starCrosses?: Path2D;
  private starFieldWidth = 0;
  private starFieldFloor = 0;
  private lightningPath?: Path2D;
  private lightningCycle = Number.NaN;
  private lightningWidth = 0;
  private lightningFloor = 0;
  private lightningX = 0;
  private readonly foregroundSnow = new Float32Array(9 * 3);

  constructor(readonly id: WeatherId, seed = Math.floor(Math.random() * 0x100000000)) {
    this.seed = seed >>> 0;
    const random = seededRandom(this.seed);
    const make = (count: number): Particle[] => Array.from({ length: count }, () => ({
      x: random(), y: random(), speed: 0.7 + random() * 0.6,
      size: 0.65 + random() * 0.7, phase: random() * TAU,
      spin: (random() < 0.5 ? -1 : 1) * (0.4 + random() * 0.8),
      variant: Math.floor(random() * 3),
    }));
    const counts = id === 'rain' ? [64, 44, 12] : id === 'snow' ? [48, 30, 9] : [9, 6, 3];
    this.particles = { distant: make(counts[0]), court: make(counts[1]), foreground: make(counts[2]) };
    this.stars = make(92);
    this.twinkles = this.stars.filter(star => star.variant === 0).sort((a, b) => b.size - a.size).slice(0, 12);
  }

  get quality(): typeof QUALITY[number] { return QUALITY[this.qualityIndex]; }

  /** One-second samples shed decorative work quickly; recovery needs five healthy samples. */
  observeFrame(seconds: number, active = true): void {
    if (!active || !Number.isFinite(seconds) || seconds <= 0 || seconds > 0.2) {
      this.sampleFrames = this.sampleSeconds = this.recoveryWindows = 0;
      return;
    }
    this.sampleSeconds += seconds; this.sampleFrames++;
    if (this.sampleSeconds < 1) return;
    const average = this.sampleSeconds / this.sampleFrames;
    const target = average > 1 / 28 ? 0 : average > 1 / 45 ? 1 : 2;
    if (target < this.qualityIndex) {
      this.qualityIndex = target;
      this.recoveryWindows = 0;
    } else if (average < 1 / 55 && this.qualityIndex < 2) {
      if (++this.recoveryWindows >= 5) {
        this.qualityIndex++; this.recoveryWindows = 0;
      }
    } else this.recoveryWindows = 0;
    this.sampleFrames = this.sampleSeconds = 0;
  }

  /** Sky effects and distant particles sit behind the moon and tree silhouettes. */
  drawSky(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number, seconds: number, reducedMotion = false): void {
    const t = reducedMotion ? 0 : seconds;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, floorY); ctx.clip();
    if (!this.tint || this.tintContext !== ctx || this.tintFloor !== floorY || this.tintPixels !== ctx.canvas.width) {
      const tint = ctx.createLinearGradient(0, 0, 0, floorY);
      const colors = this.id === 'autumn' ? ['rgba(16,13,38,0.64)', 'rgba(65,36,57,0.13)']
        : this.id === 'snow' ? ['rgba(116,155,181,0.24)', 'rgba(184,199,209,0.13)']
        : ['rgba(15,25,46,0.56)', 'rgba(45,59,80,0.18)'];
      tint.addColorStop(0, colors[0]); tint.addColorStop(1, colors[1]);
      this.tint = tint; this.tintContext = ctx; this.tintFloor = floorY; this.tintPixels = ctx.canvas.width;
    }
    ctx.fillStyle = this.tint; ctx.fillRect(0, 0, width, floorY);
    if (this.id === 'autumn') this.drawStars(ctx, width, floorY, t);
    else this.drawClouds(ctx, width, floorY, t);
    if (this.id === 'rain' && !reducedMotion) this.drawLightning(ctx, width, floorY, t);
    this.drawLayer(ctx, 'distant', width, height, floorY, t);
    ctx.restore();
  }

  /** Middle particles cross the scenery but remain behind both players. */
  drawCourt(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number, seconds: number, reducedMotion = false): void {
    const t = reducedMotion ? 0 : seconds;
    this.drawLayer(ctx, 'court', width, height, floorY, t);
    if (this.id === 'rain') this.drawRipples(ctx, width, floorY, t);
  }

  /** Sparse, larger particles cross in front of the action, below the HUD. */
  drawForeground(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number, seconds: number, reducedMotion = false): void {
    this.drawLayer(ctx, 'foreground', width, height, floorY, reducedMotion ? 0 : seconds);
  }

  private drawStars(ctx: CanvasRenderingContext2D, width: number, floorY: number, t: number): void {
    // Cached paths stay crisp at every DPI without a full-screen star texture.
    if (!this.starPoints || this.starFieldWidth !== width || this.starFieldFloor !== floorY) {
      const points = new Path2D(), crosses = new Path2D();
      for (const star of this.stars) {
        const x = star.x * width, y = 5 + star.y * floorY * 0.7;
        const size = star.size * (star.variant === 0 ? 0.8 : 0.4);
        points.moveTo(x + size, y); points.arc(x, y, size, 0, TAU);
        if (star.variant === 0 && star.size > 1.1) {
          crosses.moveTo(x - 2.4, y); crosses.lineTo(x + 2.4, y);
          crosses.moveTo(x, y - 2.4); crosses.lineTo(x, y + 2.4);
        }
      }
      this.starPoints = points; this.starCrosses = crosses;
      this.starFieldWidth = width; this.starFieldFloor = floorY;
    }
    ctx.fillStyle = '#e3e1ce'; ctx.globalAlpha = 0.3; ctx.fill(this.starPoints);
    ctx.strokeStyle = '#e3e1ce'; ctx.globalAlpha = 0.14; ctx.lineWidth = 0.45; ctx.stroke(this.starCrosses!);
    if (!starGlow) {
      starGlow = glowStamp('227,225,206', 48, 0.3);
      const glow = starGlow.getContext('2d')!;
      glow.fillStyle = '#e3e1ce'; glow.beginPath(); glow.arc(24, 24, 2.5, 0, TAU); glow.fill();
      glow.strokeStyle = '#e3e1ce'; glow.lineWidth = 1;
      glow.beginPath(); glow.moveTo(16, 24); glow.lineTo(32, 24);
      glow.moveTo(24, 16); glow.lineTo(24, 32); glow.stroke();
    }
    const count = Math.ceil(this.twinkles.length * DENSITY[this.qualityIndex]);
    for (let i = 0; i < count; i++) {
      const star = this.twinkles[i];
      const wave = 0.5 + 0.5 * Math.sin(t * 0.85 * star.speed + star.phase);
      ctx.globalAlpha = 0.1 + wave * wave * wave * 0.32;
      const size = star.size * 8;
      ctx.drawImage(starGlow, star.x * width - size / 2, 5 + star.y * floorY * 0.7 - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  private drawClouds(ctx: CanvasRenderingContext2D, width: number, floorY: number, t: number): void {
    const cloud = cloudStamp(this.id);
    const count = this.qualityIndex === 2 ? 5 : this.qualityIndex === 1 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const x = wrap(i * width * 0.29 + t * 1.6, width + 240) - 120;
      const y = floorY * (0.13 + (i % 3) * 0.16);
      const radius = 100 + i * 11;
      ctx.drawImage(cloud, x - radius, y - radius * 0.28, radius * 2, radius * 0.56);
    }
  }

  private drawLightning(ctx: CanvasRenderingContext2D, width: number, floorY: number, t: number): void {
    const period = 19 + this.seed % 11;
    const elapsed = wrap(t - 6 - this.seed % 4, period);
    if (elapsed > 0.75) return;
    const brightness = Math.sin(Math.PI * elapsed / 0.75) ** 2;
    const cycle = Math.floor((t - 6 - this.seed % 4) / period);
    const top = floorY * 0.08;
    if (!this.lightningPath || this.lightningCycle !== cycle || this.lightningWidth !== width || this.lightningFloor !== floorY) {
      const random = seededRandom(this.seed + cycle * 7919);
      this.lightningX = width * (random() < 0.5 ? 0.12 + random() * 0.14 : 0.74 + random() * 0.14);
      const bolt = new Path2D(); bolt.moveTo(this.lightningX, top);
      let bx = this.lightningX, by = top;
      for (let i = 0; i < 6; i++) {
        bx += (random() - 0.48) * 26; by += floorY * (0.035 + random() * 0.025);
        bolt.lineTo(bx, by);
        if (i === 2) { bolt.lineTo(bx + 13, by + 12); bolt.moveTo(bx, by); }
      }
      this.lightningPath = bolt; this.lightningCycle = cycle;
      this.lightningWidth = width; this.lightningFloor = floorY;
    }
    lightningGlow ??= glowStamp('195,204,234', 192);
    const radius = width * 0.3;
    ctx.save(); ctx.globalAlpha = brightness * 0.24;
    ctx.drawImage(lightningGlow, this.lightningX - radius, top + 50 - radius, radius * 2, radius * 2);
    ctx.globalAlpha = brightness * 0.65; ctx.strokeStyle = '#dadff5';
    ctx.lineWidth = 0.8; ctx.lineJoin = 'round'; ctx.stroke(this.lightningPath); ctx.restore();
  }

  private drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, width: number, height: number, floorY: number, t: number): void {
    const depth = layer === 'distant' ? 0 : layer === 'court' ? 1 : 2;
    const particles = this.particles[layer];
    const count = Math.ceil(particles.length * DENSITY[this.qualityIndex]);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    if (this.id === 'rain') this.drawRain(ctx, particles, count, depth, width, floorY, t);
    else if (this.id === 'snow') this.drawSnow(ctx, particles, count, depth, width, height, t * 0.5);
    else this.drawLeaves(ctx, particles, count, depth, width, height, floorY, t);
    ctx.restore();
  }

  /** One stroke per depth layer, rather than one stroke per drop. */
  private drawRain(ctx: CanvasRenderingContext2D, particles: Particle[], count: number, depth: number, width: number, floorY: number, t: number): void {
    ctx.globalAlpha = depth === 0 ? 0.18 : depth === 1 ? 0.3 : 0.28;
    ctx.strokeStyle = '#bfcede'; ctx.lineWidth = 0.45 + depth * 0.2;
    const drift = t * (13 + depth * 8), speed = t * (95 + depth * 65);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const x = wrap(p.x * (width + 40) + drift, width + 40) - 20;
      const y = wrap(p.y * (floorY + 24) + speed * p.speed, floorY + 24) - 12;
      const length = (3 + depth * 3) * p.size;
      ctx.moveTo(x, y); ctx.lineTo(x + length * 0.17, y + length);
    }
    ctx.stroke();
  }

  /** A single fill draws the flakes; a second fill handles the sparse near halos. */
  private drawSnow(ctx: CanvasRenderingContext2D, particles: Particle[], count: number, depth: number, width: number, height: number, t: number): void {
    const radius = depth === 0 ? 0.45 : depth === 1 ? 0.8 : 1.6;
    const drift = t * (4 + depth * 4), fall = t * (8 + depth * 7), sway = 6 + depth * 5;
    ctx.globalAlpha = depth === 0 ? 0.35 : depth === 1 ? 0.65 : 0.55;
    ctx.fillStyle = '#e4e8df'; ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p = particles[i], size = radius * p.size;
      const x = wrap(p.x * (width + 40) + drift + Math.sin(t * 0.7 + p.phase) * sway, width + 40) - 20;
      const y = wrap(p.y * (height + 24) + fall * p.speed, height + 24) - 12;
      ctx.moveTo(x + size, y); ctx.ellipse(x, y, size, size * 0.75, 0, 0, TAU);
      if (depth === 2) {
        this.foregroundSnow[i * 3] = x; this.foregroundSnow[i * 3 + 1] = y; this.foregroundSnow[i * 3 + 2] = size * 1.65;
      }
    }
    ctx.fill();
    if (depth === 2) {
      ctx.globalAlpha = 0.12; ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const x = this.foregroundSnow[i * 3], y = this.foregroundSnow[i * 3 + 1], size = this.foregroundSnow[i * 3 + 2];
        ctx.moveTo(x + size, y); ctx.arc(x, y, size, 0, TAU);
      }
      ctx.fill();
    }
  }

  private drawLeaves(ctx: CanvasRenderingContext2D, particles: Particle[], count: number, depth: number, width: number, height: number, floorY: number, t: number): void {
    const stamps = leaves();
    const radius = depth === 0 ? 1.8 : depth === 1 ? 3.1 : 6;
    const opacity = depth === 0 ? 0.45 : depth === 1 ? 0.8 : 0.72;
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      // Each leaf spends most of its cycle offstage; a gust brings it through.
      const duration = 9 + p.speed * 3;
      const travel = wrap(t + p.phase * 5, duration + 9 + p.phase) / duration;
      if (travel > 1) continue;
      const x = -30 + travel * (width + 60);
      const y = p.y * floorY * 0.75 + travel * height * 0.38 + Math.sin(travel * TAU * 1.7 + p.phase) * (10 + depth * 6);
      const size = radius * p.size;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * p.spin + p.phase);
      ctx.scale(0.35 + Math.abs(Math.cos(t * p.spin * 0.8 + p.phase)) * 0.65, 1);
      ctx.globalAlpha = opacity * Math.min(1, travel * 10, (1 - travel) * 10);
      ctx.drawImage(stamps[p.variant], -size * 1.6, -size * 2.1, size * 3.2, size * 4.8);
      ctx.restore();
    }
  }

  private drawRipples(ctx: CanvasRenderingContext2D, width: number, floorY: number, t: number): void {
    ctx.save(); ctx.strokeStyle = '#b2c4d5'; ctx.lineWidth = 0.45;
    const count = Math.ceil(12 * DENSITY[this.qualityIndex]);
    for (let band = 0; band < 3; band++) {
      ctx.globalAlpha = (1 - (band + 0.5) / 3) * 0.18; ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const p = this.particles.court[i], phase = wrap(t * 0.8 + p.phase, 1);
        if (Math.floor(phase * 3) !== band) continue;
        const x = width * p.x, y = floorY + 1 + p.y * 9, radius = 1 + phase * 4;
        ctx.moveTo(x + radius, y); ctx.ellipse(x, y, radius, 0.4 + phase, 0, 0, TAU);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

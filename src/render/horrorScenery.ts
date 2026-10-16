/** Geometry stays fixed; only ink edges get a subpixel redraw. */
export const SCENERY_BOIL_PX = 0.025;
export const SCENERY_BOIL_HZ = 5;
const SEQUENCE = [0, 1, 0, 2, 1, 2] as const;
const STAGE_WIDTH = 640;

interface Point { x: number; y: number }
interface Branch { points: Point[]; width: number; seed: number }

/** Seeded Canvas geometry; no scenery photograph or sprite is used. */
export class HorrorScenery {
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private cacheKey = '';
  private frames: HTMLCanvasElement[] = [];

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number, seconds: number): void {
    const deviceScale = Math.abs(ctx.getTransform().a);
    const resolution = Math.max(1280, Math.min(3840, Math.ceil(width * deviceScale / 640) * 640));
    const key = resolution + ':' + height / width + ':' + floorY / width;
    if (key !== this.cacheKey) {
      this.frames = makeFrames(resolution, height / width * STAGE_WIDTH, floorY / width * STAGE_WIDTH);
      this.cacheKey = key;
    }
    const frame = this.reducedMotion.matches ? 0 : SEQUENCE[Math.floor(seconds * SCENERY_BOIL_HZ) % SEQUENCE.length];
    ctx.drawImage(this.frames[frame], 0, 0, width, height);
  }
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeFrames(resolution: number, height: number, floor: number): HTMLCanvasElement[] {
  const trees = makeEdgeTrees(floor);
  return [0, 1, 2].map(frame => {
    const canvas = document.createElement('canvas');
    canvas.width = resolution; canvas.height = Math.round(height * resolution / STAGE_WIDTH);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(resolution / STAGE_WIDTH, resolution / STAGE_WIDTH);
    ctx.beginPath(); ctx.rect(0, 0, STAGE_WIDTH, floor); ctx.clip();
    drawMoon(ctx, 474, floor * 0.19, 29, frame);
    drawCrosses(ctx, floor);
    // A single solid skyline matches the reference; no individual distant trees.
    const bank = new Path2D();
    bank.moveTo(0, floor);
    for (let x = 0; x <= 640; x += 1) {
      const y = forestTop(x, floor);
      bank.lineTo(x, y + edgeOffset(x, frame, 1));
    }
    bank.lineTo(640, floor); bank.closePath();
    ctx.fillStyle = '#0c0d13'; ctx.fill(bank);
    ctx.save(); ctx.clip(bank);
    const paper = random(1977);
    ctx.fillStyle = 'rgba(143,124,143,0.12)';
    for (let i = 0; i < 6500; i++) {
      const x = paper() * STAGE_WIDTH, y = floor - paper() * 95;
      const size = 0.15 + paper() * 0.4;
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
    const treePath = new Path2D();
    for (const branch of trees) treePath.addPath(branchPath(branch, frame));
    ctx.fillStyle = '#0b0e19'; ctx.fill(treePath);
    // Stationary dry-pencil marks inside the ink. They never travel with boil.
    ctx.save(); ctx.clip(treePath);
    const rng = random(5127);
    ctx.strokeStyle = 'rgba(104,100,133,0.22)'; ctx.lineWidth = 0.24;
    for (const side of [0, 1]) for (let i = 0; i < 70; i++) {
      const x = side === 0 ? 27 + rng() * 22 : 591 + rng() * 22;
      const y = rng() * floor;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rng() * 2 - 1, y + 3 + rng() * 11); ctx.stroke();
    }
    ctx.restore();
    return canvas;
  });
}

/** Smooth broad masses with a lightly rough ink edge, without separate trunks. */
function forestTop(x: number, floor: number): number {
  const anchors = [[0, 102], [24, 83], [44, 57], [72, 39], [108, 55], [150, 34],
    [181, 22], [210, 40], [235, 24], [280, 31], [321, 24], [358, 42],
    [391, 28], [429, 17], [462, 25], [495, 17], [535, 24], [569, 18],
    [596, 42], [640, 65]];
  const right = anchors.findIndex(([px]) => px >= x);
  const a = anchors[Math.max(0, right - 1)], b = anchors[Math.max(0, right)];
  const t = a[0] === b[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
  const smooth = t * t * (3 - 2 * t);
  const height = a[1] + (b[1] - a[1]) * smooth;
  return floor - height + Math.sin(x * 0.48) * 1.1 + Math.sin(x * 1.19 + 0.7) * 0.55;
}

/** Small weathered crosses protrude above the solid forest, their bases hidden. */
function drawCrosses(ctx: CanvasRenderingContext2D, floor: number): void {
  const crosses = [
    { x: 108, base: 7, height: 26, tilt: -0.1 },
    { x: 178, base: 8, height: 19, tilt: 0.07 },
    { x: 259, base: 5, height: 32, tilt: -0.06 },
    { x: 367, base: 10, height: 23, tilt: 0.11 },
    { x: 493, base: 5, height: 28, tilt: -0.09 },
    { x: 550, base: 8, height: 21, tilt: 0.055 },
  ];
  for (const cross of crosses) {
    ctx.save(); ctx.translate(cross.x, forestTop(cross.x, floor) + cross.base); ctx.rotate(cross.tilt);
    const h = cross.height, arm = h * 0.23, y = -h * 0.7;
    ctx.beginPath();
    ctx.moveTo(-1.2, 0); ctx.lineTo(-1.4, y + 1.2);
    ctx.lineTo(-arm, y + 1.4); ctx.lineTo(-arm - 0.2, y - 1.1);
    ctx.lineTo(-1.3, y - 1.3); ctx.lineTo(-1.1, -h);
    ctx.lineTo(1.3, -h + 0.2); ctx.lineTo(1.2, y - 1.2);
    ctx.lineTo(arm + 0.1, y - 1.4); ctx.lineTo(arm, y + 1.2);
    ctx.lineTo(1.4, y + 1.1); ctx.lineTo(1.1, 0); ctx.closePath();
    ctx.fillStyle = '#0c0d13'; ctx.fill();
    ctx.strokeStyle = 'rgba(94,103,130,0.26)'; ctx.lineWidth = 0.2;
    ctx.beginPath(); ctx.moveTo(-0.6, -h + 2); ctx.lineTo(-0.4, -h * 0.39);
    ctx.moveTo(-arm + 0.9, y - 0.5); ctx.lineTo(arm - 1, y - 0.6); ctx.stroke();
    ctx.restore();
  }
}

function edgeOffset(seed: number, frame: number, axis: number): number {
  if (!frame) return 0;
  return Math.sin(seed * 1.731 + axis * 2.61 + frame * 2.399) * SCENERY_BOIL_PX;
}

/** Tapered ink ribbons keep even the smallest twigs crisp at high DPI. */
function branchPath(branch: Branch, frame: number): Path2D {
  const path = new Path2D();
  const sides: Point[][] = [[], []];
  for (let i = 0; i < branch.points.length; i++) {
    const p = branch.points[i], a = branch.points[Math.max(0, i - 1)], b = branch.points[Math.min(branch.points.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    const radius = branch.width * (1 - i / (branch.points.length - 1) * 0.68) / 2;
    for (let side = 0; side < 2; side++) {
      const sign = side ? -1 : 1;
      // Root points are locked; redraw is confined to the outline elsewhere.
      const jitter = i === 0 ? 0 : edgeOffset(branch.seed + i * 3 + side, frame, 0);
      sides[side].push({ x: p.x - dy / length * radius * sign + jitter, y: p.y + dx / length * radius * sign + edgeOffset(branch.seed + i, frame, 1) * (i === 0 ? 0 : 1) });
    }
  }
  const points = [...sides[0], ...sides[1].reverse()];
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
  path.closePath();
  return path;
}

function grow(branches: Branch[], rng: () => number, root: Point, angle: number, length: number, width: number, depth: number, limit?: { min: number; max: number }): void {
  const bend = (rng() - 0.5) * 0.23;
  const points = [root, ...[0.35, 0.72, 1].map(t => ({
    x: root.x + Math.cos(angle + bend * t) * length * t,
    y: root.y + Math.sin(angle + bend * t) * length * t,
  }))];
  if (limit && (points[3].x < limit.min || points[3].x > limit.max)) return;
  branches.push({ points, width, seed: Math.floor(rng() * 10000) });
  if (!depth || length < 3) return;
  grow(branches, rng, points[3], angle + (rng() - 0.5) * 0.36, length * 0.59, width * 0.56, depth - 1, limit);
  grow(branches, rng, points[2], angle + (rng() > 0.5 ? 1 : -1) * (0.48 + rng() * 0.35), length * 0.46, width * 0.38, depth - 1, limit);
}

function makeEdgeTrees(floor: number): Branch[] {
  const branches: Branch[] = [];
  for (const side of [0, 1]) {
    const rng = random(139 + side * 213), mirror = (x: number) => side ? 640 - x : x;
    const trunk: Branch = {
      points: [{ x: mirror(7), y: 94 }, { x: mirror(30), y: 67 },
        { x: mirror(47), y: 28 }, { x: mirror(61), y: -12 }],
      width: 15, seed: 987 + side,
    };
    branches.push(trunk);
    const roots = [{ x: 27, y: 70, length: 65, width: 6, angle: -0.48 },
      { x: 43, y: 35, length: 46, width: 3.8, angle: -0.56 },
      { x: 15, y: 181, length: 68, width: 5.8, angle: -0.67 },
      { x: 18, y: 146, length: 66, width: 5.2, angle: -1.04 },
      { x: 13, y: 232, length: 33, width: 2.5, angle: -0.2 }];
    for (const root of roots) {
      const angle = side ? -Math.PI - root.angle : root.angle;
      grow(branches, rng, { x: mirror(root.x), y: root.y * floor / 385 }, angle,
        root.length, root.width, 4, side ? { min: 506, max: 669 } : { min: -29, max: 134 });
    }
  }
  return branches;
}

function drawMoon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, frame: number): void {
  const outline = new Path2D();
  const rng = random(9931);
  for (let i = 0; i < 96; i++) {
    const angle = i / 96 * Math.PI * 2;
    const r = radius + (rng() - 0.5) * 0.22 + edgeOffset(i + 1, frame, 0);
    const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r;
    if (!i) outline.moveTo(px, py); else outline.lineTo(px, py);
  }
  outline.closePath();
  ctx.fillStyle = '#e8d8aa'; ctx.fill(outline);
  ctx.strokeStyle = '#171827'; ctx.lineWidth = 0.65; ctx.stroke(outline);
  ctx.save(); ctx.clip(outline); ctx.translate(x, y);
  const craters = [[-0.38, -0.4, 0.28], [0.15, -0.18, 0.31], [0.42, 0.08, 0.17],
    [-0.38, 0.25, 0.19], [-0.18, 0.5, 0.12], [0.38, -0.58, 0.08], [0.43, 0.5, 0.055]];
  const marks = random(34333);
  for (const [cx, cy, size] of craters) {
    const path = new Path2D();
    for (let i = 0; i < 13; i++) {
      const angle = i / 13 * Math.PI * 2;
      const r = size * radius * (0.65 + marks() * 0.45);
      const px = cx * radius + Math.cos(angle) * r, py = cy * radius + Math.sin(angle) * r * 0.78;
      if (!i) path.moveTo(px, py); else path.lineTo(px, py);
    }
    path.closePath(); ctx.fillStyle = 'rgba(91,79,58,0.12)'; ctx.fill(path);
    ctx.save(); ctx.clip(path);
    ctx.strokeStyle = '#222019';
    for (let i = 0; i < 32; i++) {
      let px = cx * radius + (marks() - 0.5) * size * radius * 2;
      let py = cy * radius + (marks() - 0.5) * size * radius * 1.6;
      ctx.lineWidth = 0.3 + marks() * 0.95;
      ctx.beginPath(); ctx.moveTo(px, py);
      for (let j = 0; j < 3; j++) {
        px += (marks() - 0.5) * 4; py += (marks() - 0.5) * 4;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
    for (let i = 0; i < 18; i++) {
      const px = cx * radius + (marks() - 0.5) * size * radius * 2;
      const py = cy * radius + (marks() - 0.5) * size * radius * 1.6;
      ctx.fillStyle = 'rgba(24,24,31,0.78)';
      ctx.beginPath(); ctx.ellipse(px, py, 0.25 + marks() * 0.8, 0.15 + marks() * 0.55, marks() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(72,63,51,0.24)'; ctx.lineWidth = 0.2;
  for (let i = 0; i < 125; i++) {
    const px = (marks() - 0.5) * radius * 2, py = (marks() - 0.5) * radius * 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 0.5 + marks() * 1.8, py - 0.3 - marks() * 0.8); ctx.stroke();
  }
  ctx.restore();
}

export interface ChameleonPoint { x: number; y: number }

export interface ChameleonPlacement {
  /** Actual wall face in the inward-facing local coordinates of the crawler. */
  wallX: number;
  /** Interpolated vertical distance travelled, so planted feet do not slide. */
  travelPx: number;
}

export interface ChameleonLegPose {
  root: ChameleonPoint;
  elbow: ChameleonPoint;
  wrist: ChameleonPoint;
  foot: ChameleonPoint;
  planted: boolean;
  far: boolean;
}

export const CHAMELEON_BODY_ANGLE = 0.48;
export const CHAMELEON_STRIDE_PX = 14;
const STANCE = 0.68;
/** The rotated toe pad's measured contact point relative to its wrist. */
const WRIST_FROM_PAD = { x: 5.54, y: 1.05 };

const LEGS = [
  { root: { x: -9, y: -15 }, y: -17, phase: 0, upper: 10, lower: 10, bend: -1, far: true },
  { root: { x: -6, y: 9 }, y: 19, phase: 0.5, upper: 12, lower: 12, bend: 1, far: true },
  { root: { x: -2, y: -17 }, y: -11, phase: 0.5, upper: 13, lower: 12, bend: -1, far: false },
  { root: { x: 2, y: 14 }, y: 25, phase: 0, upper: 14, lower: 13, bend: 1, far: false },
] as const;

/** A two-segment limb bends at its elbow while its gripping foot stays at the target. */
function elbow(root: ChameleonPoint, wrist: ChameleonPoint, upper: number, lower: number, bend: number): ChameleonPoint {
  const dx = wrist.x - root.x, dy = wrist.y - root.y;
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const ux = dx / distance, uy = dy / distance;
  // The small emergence pose can put the wall closer than the folded limb's reach.
  const a = Math.max(-upper, Math.min(upper, (upper * upper - lower * lower + distance * distance) / (2 * distance)));
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  return { x: root.x + ux * a - uy * h * bend, y: root.y + uy * a + ux * h * bend };
}

/** Diagonal pairs alternate: plant, unload, lift inward, reach down, then grip again. */
export function chameleonLegPoses({ wallX, travelPx }: ChameleonPlacement): ChameleonLegPose[] {
  return LEGS.map(leg => {
    const cycle = travelPx / CHAMELEON_STRIDE_PX + leg.phase;
    const phase = cycle - Math.floor(cycle);
    const planted = phase < STANCE;
    const swing = planted ? 0 : (phase - STANCE) / (1 - STANCE);
    const ease = swing * swing * (3 - 2 * swing);
    const foot = {
      x: wallX + (planted ? 0 : Math.sin(swing * Math.PI) * 4),
      y: leg.y - (planted ? phase : STANCE * (1 - ease)) * CHAMELEON_STRIDE_PX,
    };
    const wrist = { x: foot.x + WRIST_FROM_PAD.x, y: foot.y + WRIST_FROM_PAD.y };
    return { root: leg.root, elbow: elbow(leg.root, wrist, leg.upper, leg.lower, leg.bend), wrist, foot, planted, far: leg.far };
  });
}

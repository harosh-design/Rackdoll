import { BALL, FLOOR_TOP_PX, MS_PER_FRAME, TIMERS } from '../sim/constants';
import type { Tomb } from '../sim/tomb';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

export type TombScenePose = NonNullable<ReturnType<typeof tombScenePose>>;

/** World-pixel choreography: every hand, opening and ball shares the scored slab. */
export function tombScenePose(tomb: Tomb, frame: number, reduced = false) {
  const scene = tomb.transition;
  if (!scene) return null;
  const progress = clamp((frame - scene.frame) / (TIMERS.goalMs / MS_PER_FRAME - 1));
  const slab = scene.broken === null ? null : tomb.slabs[scene.broken];
  const repair = reduced ? Number(progress >= 0.76) : clamp((progress - 0.72) / 0.22);
  const opening = reduced ? Number(progress < 0.76) : clamp((progress - 0.08) / 0.08);
  const grab = reduced ? 1 : clamp((progress - 0.12) / 0.14);
  const lift = reduced ? 0.6 : clamp((progress - 0.28) / 0.15);
  const retreat = reduced ? Number(progress >= 0.68) : clamp((progress - 0.48) / 0.2);
  const contactPalmY = scene.ballY + BALL.radiusPx * 0.8;
  const palmY = mix(mix(FLOOR_TOP_PX + 52, contactPalmY, grab) - lift * 95,
    FLOOR_TOP_PX + 120, retreat);
  const ballY = progress < 0.26 && !reduced ? scene.ballY : palmY - BALL.radiusPx * 0.8;
  const originX = slab ? Math.max(slab.left + 16, Math.min(slab.right - 16, scene.ballX)) : scene.ballX;
  return {
    progress, slab, repair, opening: opening * (1 - repair), grab, retreat,
    originX, palmX: scene.ballX, palmY, ballX: scene.ballX, ballY, ballAngle: scene.ballAngle,
    playerOpacity: reduced ? 0 : 1 - clamp(progress / 0.07),
    handVisible: !!slab && (reduced || progress >= 0.1) && progress < 0.69,
    ballVisible: !!slab && retreat < 0.95,
  };
}

import { LEFT_WALL_INNER_PX, RIGHT_WALL_INNER_PX, VIEW } from '../sim/constants';

/** Arena framing is visual only; every collider retains its original coordinates. */
export const STAGE = {
  offsetX: VIEW.stageW / 2 - ((LEFT_WALL_INNER_PX + RIGHT_WALL_INNER_PX) / 2) * VIEW.scale,
  offsetY: 138,
} as const;

/** Side-view padel tuning. The depth/diagonal service boxes of a real court
 * cannot be represented in this two-dimensional court. */
export const PADEL = {
  ballRadiusPx: 7,
  ballMass: 0.055,
  ballInertia: 0.0015,
  ballRestitution: 0.72,
  netTopPx: 305,
  racketRadiusPx: 17,
  racketOffsetPx: 17,
  hitReachPx: 20,
  hitFrames: 11,
  serveSpeedX: 11,
  serveSpeedY: -9,
  hitSpeedX: 10,
  hitSpeedY: -5.8,
  lobSpeedX: 8.5,
  lobSpeedY: -10.5,
} as const;

export type Sport = 'volleyball' | 'padel';

import type { PartName } from '../sim/constants';

/**
 * The doll's geometry as the original draws it, in stage px relative to each
 * body's centre at angle 0.
 *
 * In the original every part is one MovieClip (`mc_HandL` … `mc_Ass`, the
 * default set 1) holding a single bitmap-filled rectangle, and every frame its
 * registration point is put on the body: `sprite.x = x * 30`,
 * `sprite.rotation = angle` (`world::Update`). So a part's art never moves
 * relative to its body, and where it ends at each joint is fixed by the
 * bitmap. The outlines below are those bitmaps' silhouettes (traced at 50%
 * alpha; 25% for the hands, whose fingers are hairline-thin) carried through
 * each sprite's own bitmap matrix, so every part but the head covers exactly
 * the area the original's sprite does. With the original's stacking order
 * (`DRAW_ORDER`), the joints meet as the original's do:
 *
 * - **Neck.** The torso's neck starts 0.9 px above the pivot; the head, drawn
 *   over it, reaches 3 px below the pivot with its chin.
 * - **Shoulders.** The upper arm's head is a ball centred on the pivot, which
 *   sits 1.2 px outside the torso's edge. The ball is drawn under the torso.
 * - **Elbows.** The forearm starts 0.7 px short of the pivot and runs under
 *   the upper arm's rounded end, which reaches 5 px past it.
 * - **Wrists.** The forearm ends 1.3 px past the pivot, under the palm. The
 *   palm sits on the pivot and is drawn over the forearm.
 * - **Waist.** The hips cover the torso's last 6.3 px and start 2 px above
 *   the pivot.
 * - **Hips.** The hips' leg openings sit on the hip pivots. Both thighs' domed
 *   tops reach 7.3 px above the pivots, under the hips.
 * - **Knees.** The shin is cut off flat 1.7 px above the pivot. The thigh's
 *   rounded end reaches 3.5 px below it and is drawn over that edge.
 * - **Ankles.** There is no ankle joint. The shin's collider ends at the
 *   ankle, and the foot is drawn below it, 10.7 px past the collider. The
 *   original's floor is a perspective plane that starts above the physics
 *   floor, so the feet stand on it.
 */
export const OUTLINES: Record<Exclude<PartName, 'Head'>, readonly number[]> = {
  HandLeft: [
    4.78, -3.17, 7.93, -1.7, 8.83, -1.67, 9.73, -1.98, 10.18, -1.79, 10.84, -0.83, 11.13, 0.06,
    10.74, 1.41, 10.18, 2.33, 8.38, 2.87, 5.68, 4.16, 3.88, 4.36, -9.15, 2.88, -11.85, 2.47,
    -12.3, 2.21, -12.79, 1.41, -12.9, 0.51, -12.76, -0.39, -12.43, -1.28, -11.85, -1.88, -7.35, -1.6,
    -1.96, -1.93, 2.09, -3.14,
  ],
  HandRight: [
    -1.69, -3.14, 2.36, -1.93, 7.75, -1.6, 12.25, -1.88, 12.83, -1.28, 13.16, -0.39, 13.3, 0.51,
    13.19, 1.41, 12.7, 2.21, 12.25, 2.47, 9.55, 2.88, -3.48, 4.36, -5.28, 4.16, -7.98, 2.87,
    -9.78, 2.33, -10.34, 1.41, -10.73, 0.06, -10.44, -0.83, -9.78, -1.79, -9.33, -1.98, -8.43, -1.67,
    -7.53, -1.7, -4.38, -3.17,
  ],
  ArmLeft: [
    9.48, -4.5, 11.73, -4.02, 12.62, -3.58, 13.67, -1.78, 14.43, -0.94, 14.88, -0.8, 15.06, -0.44,
    15.04, 0.01, 13.98, 1.93, 14.03, 3.6, 13.53, 3.94, 11.28, 4.61, 10.83, 4.97, 9.03, 5.1, 8.13, 4.77,
    6.33, 5.08, 5.44, 4.73, 4.99, 4.78, 2.74, 3.86, -4.9, 4.34, -8.95, 4.05, -11.2, 3.66, -12.1, 3.11,
    -12.6, 2.25, -12.62, 0.46, -12.33, -0.44, -11.54, -1.34, -10.3, -2.05, -7.6, -2.48, -1.76, -2.85,
    1.84, -2.8, 3.19, -2.48, 3.64, -2.55, 4.99, -3.4, 6.78, -4.1, 8.58, -4.54,
  ],
  ArmRight: [
    -7.18, -4.54, -5.38, -4.1, -3.59, -3.4, -2.24, -2.55, -1.79, -2.48, -0.44, -2.8, 3.16, -2.85,
    9, -2.48, 11.7, -2.05, 12.94, -1.34, 13.73, -0.44, 14.02, 0.46, 14, 2.25, 13.5, 3.11, 12.6, 3.66,
    10.35, 4.05, 6.3, 4.34, -1.34, 3.86, -3.59, 4.78, -4.04, 4.73, -4.93, 5.08, -6.73, 4.77, -7.63, 5.1,
    -9.43, 4.97, -9.88, 4.61, -12.13, 3.94, -12.63, 3.6, -12.58, 1.93, -13.64, 0.01, -13.66, -0.44,
    -13.48, -0.8, -13.03, -0.94, -12.27, -1.78, -11.22, -3.58, -10.33, -4.02, -8.08, -4.5,
  ],
  Tors: [
    0.71, -22.88, 1.82, -22.68, 3.49, -21.78, 3.76, -21.33, 4.02, -19.98, 4.75, -18.86, 6.1, -18.11,
    8.8, -17.15, 11.05, -17.12, 11.32, -16.83, 11.2, -15.48, 10.91, -14.58, 10.91, -10.98, 11.35, -9.18,
    11.94, -8.45, 12.06, -7.84, 11.96, -6.49, 10.73, -1.09, 10.15, 0.62, 8.64, 3.86, 8.25, 5.65,
    8.28, 8.35, 9.29, 11.5, 10.32, 13.3, 10.2, 14.2, 9.17, 16, 7.9, 17.21, 5.2, 18.43, 0.71, 19.29,
    -1.54, 19.18, -6.03, 17.97, -8.58, 16, -9.18, 15.1, -9.4, 14.2, -9.38, 12.85, -7.79, 9.7,
    -7.18, 6.55, -7.7, 4.31, -9.24, 1.16, -10.14, -1.54, -10.69, -3.79, -11.19, -7.84, -10.46, -10.08,
    -10.05, -12.33, -10.33, -16.83, -10.08, -17.09, -7.83, -17.23, -4.68, -18.43, -3.57, -19.53,
    -3.06, -21.78, -2.44, -22.43, -1.54, -22.8,
  ],
  FingerLeft: [
    -5.32, -6, 0.48, -2.6, 1.65, -2.53, 2.06, -2.71, 2.93, -2.33, 4.14, 0.6, 4.03, 1.14, 3.67, 1.55,
    2.84, 1.9, 1.72, 2.95, 0.48, 3.5, -0.45, 3.52, -2.2, 3.92, -4.55, 5.56, -5, 5.63, -5.36, 5.47,
    -5.28, 4.98, -4.53, 3.91, -3.56, 3.13, -3.72, 2.7, -6.75, 4.3, -7.19, 4.39, -7.49, 4.18,
    -7.57, 3.73, -7.1, 2.98, -5.94, 2.12, -4.89, 1.62, -4.47, 1.05, -4.87, 0.91, -5.77, 1.01,
    -7.04, 1.48, -9.33, 1.6, -9.66, 1.04, -9.15, 0.56, -5.26, -0.6, -6.28, -0.89, -8.58, -0.78,
    -9.09, -0.97, -9.42, -1.35, -9.3, -1.77, -8.91, -2.02, -5.26, -2.29, -3.61, -3.06, -3.49, -3.4,
    -3.78, -3.7, -5.13, -4.35, -5.86, -5.09, -5.93, -5.53,
  ],
  FingerRight: [
    5.38, -5.28, 5.31, -4.84, 4.58, -4.1, 3.23, -3.45, 2.94, -3.15, 3.06, -2.81, 4.71, -2.04,
    8.36, -1.77, 8.75, -1.52, 8.87, -1.1, 8.54, -0.72, 8.03, -0.53, 5.73, -0.64, 4.71, -0.35, 8.6, 0.81,
    9.11, 1.29, 8.78, 1.85, 6.49, 1.73, 5.22, 1.26, 4.32, 1.16, 3.92, 1.3, 4.34, 1.87, 5.39, 2.37,
    6.55, 3.23, 7.02, 3.98, 6.94, 4.43, 6.64, 4.64, 6.2, 4.55, 3.17, 2.95, 3.01, 3.38, 3.98, 4.16,
    4.73, 5.23, 4.81, 5.72, 4.45, 5.88, 4, 5.81, 1.65, 4.17, -0.1, 3.77, -1.03, 3.75, -2.27, 3.2,
    -3.39, 2.15, -4.22, 1.8, -4.58, 1.39, -4.69, 0.85, -3.48, -2.08, -2.61, -2.46, -2.2, -2.28,
    -1.03, -2.35, 4.77, -5.75,
  ],
  FootLeft: [
    3.43, -11.61, 4.33, -11.14, 4.51, -10.63, 4.7, -8.83, 5.3, -6.58, 5.64, -3.43, 5.5, -1.18,
    4.2, 4.21, 3.74, 9.16, 3.84, 11.85, 4.58, 13.65, 4.52, 15, 5.43, 17.25, 5.72, 19.5, 5.23, 20.22,
    2.54, 20.7, 0.29, 21.55, -1.5, 21.74, -1.98, 21.3, -1.81, 20.85, 0.01, 18.15, 0.54, 16.8,
    0.52, 12.75, -0.25, 12.3, 0.46, 11.4, 0.03, 9.16, -2.96, -1.18, -3, -2.53, -2.57, -6.13,
    -1.83, -10.18, -1.66, -10.63, -1.05, -11.19, 0.29, -11.7,
  ],
  FootRight: [
    0.61, -11.7, 1.95, -11.19, 2.56, -10.63, 2.73, -10.18, 3.47, -6.13, 3.9, -2.53, 3.86, -1.18,
    0.87, 9.16, 0.44, 11.4, 1.15, 12.3, 0.38, 12.75, 0.36, 16.8, 0.89, 18.15, 2.71, 20.85, 2.88, 21.3,
    2.4, 21.74, 0.61, 21.55, -1.64, 20.7, -4.33, 20.22, -4.82, 19.5, -4.53, 17.25, -3.62, 15,
    -3.68, 13.65, -2.94, 11.85, -2.84, 9.16, -3.3, 4.21, -4.6, -1.18, -4.74, -3.43, -4.4, -6.58,
    -3.8, -8.83, -3.61, -10.63, -3.43, -11.14, -2.53, -11.61,
  ],
  LegLeft: [
    -0.71, -20.28, 1.98, -19.79, 3.78, -18.77, 5.36, -17.13, 6.04, -15.78, 6.2, -14.88, 6.17, -11.73,
    5.53, -7.24, 5.24, 4.45, 4.74, 8.5, 4.79, 11.2, 4.47, 12.55, 3.78, 13.49, 1.98, 14.37, 1.09, 14.48,
    -0.26, 14.24, -1.16, 13.72, -1.77, 13, -1.93, 12.1, -1.82, 9.85, -1.97, 8.05, -4.48, 0.41,
    -6.28, -6.79, -6.66, -9.03, -6.7, -15.78, -6.61, -16.68, -6.18, -17.58, -5.2, -18.61, -3.85, -19.48,
    -2.5, -20.05,
  ],
  LegRight: [
    3.2, -20.05, 4.55, -19.48, 5.9, -18.61, 6.88, -17.58, 7.31, -16.68, 7.4, -15.78, 7.36, -9.03,
    6.98, -6.79, 5.18, 0.41, 2.67, 8.05, 2.52, 9.85, 2.63, 12.1, 2.47, 13, 1.86, 13.72, 0.96, 14.24,
    -0.39, 14.48, -1.28, 14.37, -3.08, 13.49, -3.77, 12.55, -4.09, 11.2, -4.04, 8.5, -4.54, 4.45,
    -4.83, -7.24, -5.47, -11.73, -5.5, -14.88, -5.34, -15.78, -4.66, -17.13, -3.08, -18.77,
    -1.28, -19.79, 1.41, -20.28,
  ],
  Ass: [
    -8.02, -6.28, -4.58, -5.23, -1.44, -4.77, 0.81, -4.73, 4.41, -5.19, 8.9, -7.03, 9.93, -5.83,
    10.7, -4.48, 13.44, 1.36, 13.07, 1.81, 10.25, 2.68, 8, 3.76, 5.3, 5.73, 1.26, 9.96, -1.44, 9.95,
    -4.14, 7.03, -6.38, 5.04, -8.18, 3.76, -10.43, 2.69, -12.68, 2.02, -12.83, 1.81, -12.89, 0.46,
    -12.47, -0.89, -11.5, -3.13, -10.03, -5.83, -9.08, -6.94,
  ],
};

/**
 * Bottom to top: the order the original's `player` constructor adds the
 * sprites, which is its body creation order. The forearms are lowest, the
 * hips cover everything, and the hands are over the head.
 */
export const DRAW_ORDER: readonly PartName[] = [
  'HandLeft', 'HandRight', 'ArmLeft', 'ArmRight', 'Tors', 'Head',
  'FingerLeft', 'FingerRight', 'FootLeft', 'FootRight', 'LegLeft', 'LegRight', 'Ass',
];

/** The head keeps its own oval face, fitted to the original head sprite's bounds. */
export const HEAD = { cx: -0.35, cy: 0.25, rx: 10.55, ry: 10.8 } as const;

/** Torso y where the neck widens into the shoulders. */
export const NECKLINE_Y = -17.5;
/** Shin y of the ankle, the narrowest point. The foot starts below it. */
export const ANKLE_Y = 12.5;
/** Shin y of the drawn sole, 10.74 px below the collider's bottom. */
export const SOLE_Y = 21.74;
/** Thigh y of the shorts' hem. */
export const HEM_Y = -6;
/** How far a sleeve reaches down the upper arm from the shoulder pivot. */
export const SLEEVE_PX = 7.5;

const paths = new Map<PartName, Path2D>();

/** A part's outline as a reusable path, built on first use. */
export function outlinePath(name: PartName): Path2D {
  let path = paths.get(name);
  if (!path) {
    path = new Path2D();
    if (name === 'Head') {
      path.ellipse(HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry, 0, 0, Math.PI * 2);
    } else {
      const pts = OUTLINES[name];
      path.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
      path.closePath();
    }
    paths.set(name, path);
  }
  return path;
}

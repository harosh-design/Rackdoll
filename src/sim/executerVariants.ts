/** One shared, deterministic ten-hit sequence for both prize buttons. */
export const EXECUTER_VARIANTS = [
  { id: 'kettlebell', kind: 'ball', mass: 6, speed: 1, launch: 1, force: 1, friction: 0.3, restitution: 1, wave: 0, magnet: 0 },
  { id: 'magnet', kind: 'ball', mass: 4.8, speed: 0.82, launch: 0.9, force: 0.9, friction: 0.45, restitution: 0.65, wave: 0, magnet: 3.2 },
  { id: 'boxer', kind: 'head', mass: 5.5, speed: 1.08, launch: 1.05, force: 1.05, friction: 0.3, restitution: 0.8, wave: 0, magnet: 0 },
  { id: 'comet', kind: 'ball', mass: 3.7, speed: 1.45, launch: 1.35, force: 0.8, friction: 0.2, restitution: 0.85, wave: 0, magnet: 0 },
  { id: 'anchor', kind: 'ball', mass: 7.2, speed: 0.72, launch: 0.82, force: 1.12, friction: 0.7, restitution: 0.35, wave: 0, magnet: 0 },
  { id: 'spring', kind: 'ball', mass: 3.2, speed: 1.18, launch: 1.16, force: 0.8, friction: 0.18, restitution: 1.3, wave: 0, magnet: 0 },
  { id: 'saw', kind: 'ball', mass: 5.2, speed: 1.12, launch: 1.05, force: 1.05, friction: 0.55, restitution: 0.6, wave: 0, magnet: 0 },
  { id: 'crystal', kind: 'ball', mass: 4.1, speed: 1.05, launch: 1.08, force: 0.9, friction: 0.25, restitution: 0.95, wave: 0.3, magnet: 0 },
  { id: 'gear', kind: 'ball', mass: 6.5, speed: 0.9, launch: 0.92, force: 1.08, friction: 0.8, restitution: 0.5, wave: 0, magnet: 0 },
  { id: 'drone', kind: 'ball', mass: 3.9, speed: 1.3, launch: 1.2, force: 0.85, friction: 0.12, restitution: 0.75, wave: 0.5, magnet: 0 },
] as const;

export type ExecuterVariant = (typeof EXECUTER_VARIANTS)[number];

export function executerVariantForHit(hitIndex: number): ExecuterVariant {
  return EXECUTER_VARIANTS[hitIndex % EXECUTER_VARIANTS.length];
}

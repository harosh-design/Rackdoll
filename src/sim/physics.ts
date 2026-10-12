import { BALL, GRAVITY } from './constants';

/** Per-world tuning; defaults preserve the original simulation. */
export interface PhysicsSettings {
  gravity: number;
  ballMass: number;
  airDensity: number;
  movementSpeed: number;
  jumpStrength: number;
  ballRestitution: number;
}

export const DEFAULT_PHYSICS: Readonly<PhysicsSettings> = Object.freeze({
  gravity: GRAVITY.y,
  ballMass: BALL.mass,
  airDensity: 0,
  movementSpeed: 1,
  jumpStrength: 1,
  ballRestitution: BALL.restitution,
});

export const PHYSICS_FIELDS = [
  { key: 'gravity', label: 'Gravity', min: 0, max: 30, step: 0.1, digits: 1, unit: 'm/s²', hint: 'Downward acceleration for all bodies.' },
  { key: 'ballMass', label: 'Ball mass', min: 0.02, max: 1, step: 0.005, digits: 3, unit: 'kg', hint: 'Mass and rotational inertia; heavier balls need more impulse.' },
  { key: 'airDensity', label: 'Air density', min: 0, max: 5, step: 0.01, digits: 2, unit: 'kg/m³', hint: 'Air drag on the ball, players and hazards. Zero preserves the original.' },
  { key: 'movementSpeed', label: 'Player movement', min: 0, max: 3, step: 0.05, digits: 2, unit: '×', hint: 'Horizontal movement strength for both humans and CPUs.' },
  { key: 'jumpStrength', label: 'Jump strength', min: 0, max: 3, step: 0.05, digits: 2, unit: '×', hint: 'Jump impulse; combines with powers and stun.' },
  { key: 'ballRestitution', label: 'Ball bounce', min: 0, max: 1.5, step: 0.01, digits: 2, unit: '×', hint: 'Bounce multiplier for court, head and limb collisions.' },
] as const satisfies readonly { key: keyof PhysicsSettings; label: string; min: number; max: number; step: number; digits: number; unit: string; hint: string }[];

export function normalizePhysics(value: unknown, base: Readonly<PhysicsSettings> = DEFAULT_PHYSICS): PhysicsSettings {
  const result = { ...base };
  if (!value || typeof value !== 'object') return result;
  for (const field of PHYSICS_FIELDS) {
    const number = (value as Record<string, unknown>)[field.key];
    if (typeof number === 'number' && Number.isFinite(number)) {
      result[field.key] = Math.max(field.min, Math.min(field.max, number));
    }
  }
  return result;
}

/** Arcade approximation: air density maps to uniform linear damping (1/s). */
export const airDamping = (density: number): number => density * 0.2;

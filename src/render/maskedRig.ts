import { JOINTS, PARTS, type PartName } from '../sim/constants';
import layouts from './horrorAtlas.json';

export type AtlasPoint = readonly [number, number];
export type AtlasMatrix = readonly [number, number, number, number, number, number];

interface Socket { source: AtlasPoint; other: PartName }

// Landmarks are measured in a 256px atlas cell, independently of its padding.
// A glove's cuff center, rather than the cell center, is the wrist's pivot.
export const MASKED_SOCKETS: Partial<Record<PartName, readonly Socket[]>> = {
  FingerLeft: [{ source: [214, 110], other: 'HandLeft' }],
  FingerRight: [{ source: [42, 110], other: 'HandRight' }],
  HandLeft: [{ source: [208, 112], other: 'ArmLeft' }, { source: [36, 116], other: 'FingerLeft' }],
  HandRight: [{ source: [48, 112], other: 'ArmRight' }, { source: [220, 116], other: 'FingerRight' }],
  Ass: [{ source: [128, 56], other: 'Tors' }],
};

function localAnchor(name: PartName, other: PartName): AtlasPoint {
  const part = PARTS.find(p => p.name === name)!;
  const joint = JOINTS.find(j => (j.a === name && j.b === other) || (j.b === name && j.a === other))!;
  return [joint.dx - part.dx, joint.dy - part.dy];
}

function register(name: PartName): AtlasMatrix {
  const uv = layouts.masked[name];
  const sockets = MASKED_SOCKETS[name];
  if (!sockets) return [uv.w / 256, 0, 0, uv.h / 256, uv.x, uv.y];
  const { source: s0, other } = sockets[0];
  const t0 = localAnchor(name, other);
  let a = uv.w / 256, b = 0, c = 0, d = uv.h / 256;
  if (sockets.length === 2) {
    const s1 = sockets[1].source, t1 = localAnchor(name, sockets[1].other);
    const sx = s1[0] - s0[0], sy = s1[1] - s0[1], length = Math.hypot(sx, sy);
    const tx = t1[0] - t0[0], ty = t1[1] - t0[1], targetLength = Math.hypot(tx, ty);
    const ux = sx / length, uy = sy / length, vx = tx / targetLength, vy = ty / targetLength;
    const along = targetLength / length, across = uv.h / 256;
    a = along * vx * ux + across * vy * uy;
    b = along * vy * ux - across * vx * uy;
    c = along * vx * uy - across * vy * ux;
    d = along * vy * uy + across * vx * ux;
  }
  return [a, b, c, d, t0[0] - a * s0[0] - c * s0[1], t0[1] - b * s0[0] - d * s0[1]];
}

const matrices = Object.fromEntries(PARTS.map(p => [p.name, register(p.name)])) as Record<PartName, AtlasMatrix>;
export const maskedPartMatrix = (name: PartName): AtlasMatrix => matrices[name];

// Keep the head and shoulders fixed. The lower vest's painted waist must end
// at the torso/pelvis hinge instead of placing that hinge at its pointed hem.
export const MASKED_TORSO_WAIST: AtlasPoint = [132, 167];
const torso = layouts.masked.Tors;
const split = 112;
const splitY = torso.y + torso.h * split / 256;
const waist = localAnchor('Tors', 'Ass');
const lowerY = (waist[1] - splitY) / (MASKED_TORSO_WAIST[1] - split);
const shear = (waist[0] - torso.x - MASKED_TORSO_WAIST[0] * torso.w / 256) / (MASKED_TORSO_WAIST[1] - split);

export const MASKED_TORSO_BANDS: readonly { from: number; to: number; matrix: AtlasMatrix }[] = [
  { from: 0, to: split + 0.5, matrix: matrices.Tors },
  { from: split - 0.5, to: 179, matrix: [torso.w / 256, 0, shear, lowerY, torso.x - shear * split, splitY - lowerY * split] },
];

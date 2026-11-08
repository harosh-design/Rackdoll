import type { Body, Joint, Vec2Value } from 'planck';
import { describe, expect, it } from 'vitest';
import { toPx, type PartName } from '../src/sim/constants';
import { closeJoints, type PoseSource } from '../src/render/dollPose';
import type { Pose } from '../src/render/interp';
import layouts from '../src/render/horrorAtlas.json';
import { maskedPartMatrix, MASKED_SOCKETS, MASKED_TORSO_BANDS, MASKED_TORSO_WAIST,
  type AtlasMatrix, type AtlasPoint } from '../src/render/maskedRig';
import { world } from './helpers';

const mapped = ([a, b, c, d, e, f]: AtlasMatrix, [x, y]: AtlasPoint): AtlasPoint => [a * x + c * y + e, b * x + d * y + f];
const at = (pose: Pose, [x, y]: AtlasPoint): AtlasPoint => [pose.x + Math.cos(pose.a) * x - Math.sin(pose.a) * y,
  pose.y + Math.sin(pose.a) * x + Math.cos(pose.a) * y];
const pixelAnchor = (anchor: Vec2Value): AtlasPoint => [toPx(anchor.x), toPx(anchor.y)];
const scaled = ([x, y]: AtlasPoint, scale: number): AtlasPoint => [x * scale, y * scale];
const expectSame = (a: AtlasPoint, b: AtlasPoint) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-8);

describe('masked artwork attachment landmarks', () => {
  it.each([2 / 3, 1, 1.5])('keeps glove cuffs, both sleeve ends and the belt on their hinges at scale %s', scale => {
    const gw = world(), player = gw.p1;
    player.setSizeScale(scale);
    for (const bend of [-0.5, 0, 0.5]) {
      const raw = new Map<Body, Pose>();
      let i = 0;
      for (const body of player.bodies) raw.set(body, { x: toPx(body.getPosition().x), y: toPx(body.getPosition().y), a: Math.sin(i++ * 1.7) * bend });
      const closed = new Map<Body, Pose>();
      closeJoints(player, { pose: body => raw.get(body)! }, 1, closed);
      for (const [key, sockets] of Object.entries(MASKED_SOCKETS)) {
        const name = key as PartName, body = player.part(name), pose = closed.get(body)!;
        for (const socket of sockets) {
          const other = player.part(socket.other);
          const joint = player.revolutes.find(j => (j.getBodyA() === body && j.getBodyB() === other) || (j.getBodyB() === body && j.getBodyA() === other))!;
          const local = other === joint.getBodyA() ? joint.getLocalAnchorA() : joint.getLocalAnchorB();
          const point = scaled(mapped(maskedPartMatrix(name), socket.source), player.partScale(name));
          expectSame(at(pose, point), at(closed.get(other)!, pixelAnchor(local)));
        }
      }
      const waist = player.revolutes.find(j => j.getBodyA() === player.ass && j.getBodyB() === player.tors)!;
      const waistInArt = scaled(mapped(MASKED_TORSO_BANDS[1].matrix, MASKED_TORSO_WAIST), scale);
      expectSame(at(closed.get(player.tors)!, waistInArt), at(closed.get(player.ass)!, pixelAnchor(waist.getLocalAnchorA())));
    }
  });

  it('joins the two torso texture bands continuously while keeping the shoulders unchanged', () => {
    for (const x of [72, 112, 152, 184]) expectSame(mapped(MASKED_TORSO_BANDS[0].matrix, [x, 112]), mapped(MASKED_TORSO_BANDS[1].matrix, [x, 112]));
    const uv = layouts.masked.Tors;
    for (const point of [[128, 27], [80, 66], [176, 66]] as const) expectSame(mapped(MASKED_TORSO_BANDS[0].matrix, point), [uv.x + point[0] * uv.w / 256, uv.y + point[1] * uv.h / 256]);
  });

  it('keeps a detached glove attached to its own forearm when the surviving player grows', () => {
    const gw = world(), player = gw.p1;
    expect(player.sever('HandLeft')).toBe(true);
    player.setSizeScale(1.5);
    expect(player.partScale('FingerLeft')).toBe(1);
    expect(player.partScale('ArmLeft')).toBe(1.5);
    const hand = player.part('FingerLeft'), forearm = player.part('HandLeft');
    let hinge: Joint | null = gw.world.getJointList();
    while (hinge && !((hinge.getBodyA() === hand && hinge.getBodyB() === forearm) || (hinge.getBodyB() === hand && hinge.getBodyA() === forearm))) hinge = hinge.getNext();
    expect(hinge).not.toBeNull();
    const source: PoseSource = { pose: body => ({ x: toPx(body.getPosition().x), y: toPx(body.getPosition().y), a: body.getAngle() }) };
    const pin = mapped(maskedPartMatrix('FingerLeft'), MASKED_SOCKETS.FingerLeft![0].source);
    const wrist = hinge!.getBodyA() === hand ? hinge!.getAnchorA() : hinge!.getAnchorB();
    expectSame(at(source.pose(hand, 1), pin), pixelAnchor(wrist));
  });
});

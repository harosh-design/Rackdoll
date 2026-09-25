import type { Body, Fixture } from 'planck';
import type { BodyType, PartName } from './constants';

/** What the original stored on each body as `e_bodytype`, plus our own hooks. */
export interface BodyUserData {
  e_bodytype: BodyType | null;
  /** Ragdoll part name, when this body is part of a doll. */
  part?: PartName;
  /** Owning player id, when this body is part of a doll. */
  playerId?: 1 | 2;
  /** Sprite key used by the renderer. */
  sprite?: string;
}

export const ud = (b: Body): BodyUserData => b.getUserData() as BodyUserData;

export const bodyTypeOf = (b: Body): BodyType | null => {
  const d = b.getUserData() as BodyUserData | null;
  return d ? d.e_bodytype : null;
};

/** The other fixture in a contact, given one of them. */
export function otherFixture(
  a: Fixture,
  b: Fixture,
  mine: Fixture,
): Fixture {
  return a === mine ? b : a;
}

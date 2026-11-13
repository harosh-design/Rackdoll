import type { GameWorld } from '../sim/world';
import type { PlayerId } from '../sim/player';
import type { Sfx } from './sfx';

type EventSounds = Pick<Sfx,
  'charge' | 'stopCharges' | 'swing' | 'swingReady' | 'dive' | 'slide' |
  'serveWarning' | 'powerEnd' | 'matchEnd'>;

function snapshot(world: GameWorld) {
  const player = (id: PlayerId) => {
    const doll = id === 1 ? world.p1 : world.p2;
    return {
      swing: world.swingEffects[id].frame,
      cooldown: world.swingCooldownFramesLeft(id),
      diving: doll.diving,
      sliding: doll.sliding,
      power: world.powerUps.active[id],
    };
  };
  return {
    phase: world.game.phase,
    seconds: world.game.serveSecondsLeft,
    holder: world.ball.ballOfPlayer,
    players: { 1: player(1), 2: player(2) },
  };
}

/** Observe state transitions once per simulation frame without changing gameplay. */
export class GameAudio {
  private previous: ReturnType<typeof snapshot> | null = null;

  constructor(private readonly sounds: EventSounds) {}

  reset(world: GameWorld): void {
    this.sounds.stopCharges();
    this.previous = snapshot(world);
  }

  update(world: GameWorld): void {
    const previous = this.previous;
    if (!previous) {
      this.reset(world);
      return;
    }
    const current = snapshot(world);
    if (current.phase === 'play') {
      for (const id of [1, 2] as const) {
        const before = previous.players[id];
        const after = current.players[id];
        const charge = world.isCpu(id) || current.holder !== 0 ? null : world.control.chargeLevel(id);
        this.sounds.charge(id, charge?.power ?? null);
        if (after.swing !== before.swing) this.sounds.swing(id, world.swingEffects[id].power);
        if (!world.isCpu(id) && before.cooldown > 0 && after.cooldown === 0) this.sounds.swingReady(id);
        if (after.diving && !before.diving) this.sounds.dive(id);
        if (after.sliding && !before.sliding) this.sounds.slide(id);
        if (before.power && !after.power && world.frame >= before.power.expiresAt) this.sounds.powerEnd(id);
      }
      const holder = current.holder;
      if ((holder === 1 || holder === 2) && !world.isCpu(holder) && holder === previous.holder &&
          current.seconds !== previous.seconds && current.seconds > 0 && current.seconds <= 3) {
        this.sounds.serveWarning(current.seconds, holder);
      }
    } else {
      this.sounds.stopCharges();
    }
    if (current.phase === 'matchOver' && previous.phase !== 'matchOver' && world.game.matchWinner) {
      this.sounds.matchEnd(!world.singlePlayer || world.game.matchWinner === 1);
    }
    this.previous = current;
  }
}

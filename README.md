# Ragdoll Volleyball

A faithful rebuild of *Ragdoll Volleyball* (Yuriy Shevchenko / Sedoiga, 2009),
driven entirely by the numbers in [`RAGDOLL-VOLLEYBALL-SPEC.md`](RAGDOLL-VOLLEYBALL-SPEC.md),
which were read out of the original's own AS3 bytecode.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # the spec's §17 checks, headless
npm run build      # static site in dist/
```

## Engine: planck.js

The spec is written in Box2D terms: prismatic and revolute limits, `SetMass`
overriding density, restitution 1, bullet CCD, and `ApplyImpulse(impulse, point)`
semantics that `jump()` depends on. [planck.js](https://github.com/piqnt/planck.js)
is a TypeScript port of Box2D 2.3, the closest living relative of the
original's Box2DFlash 2.0, so every constant carries over 1:1.

Why not the alternatives:

- **Rapier**: faster, but its joint and solver model differs in exactly the places §18 warns about.
- **box2d-wasm**: the same Box2D, but it adds async WASM init and manual memory management.

planck is pure JS, which is why the whole simulation can run headless in the test suite.

## Layout

```
src/sim/        the game — no DOM anywhere, runs headless
  constants.ts  every number from the spec, with § references
  player.ts     13 bodies, 12 revolute joints, the two prismatic rails, all actions
  ball.ts       explicit mass, bullet, per-frame speed clamps
  game.ts       touch counting, three-touch rule, serve clock, scoring, rounds
  ai.ts         the level-2 opponent (§12)
  contacts.ts   MyContactListener (§10)
  prizeButton.ts the wall buttons: press, re-arm, launch point (§13)
  executer.ts   the hazard (§13, reworked — see below)
  timer.ts      Flash Timer(delay, repeat) as deterministic frame counting
  world.ts      one frame in the original's exact order (§3)
src/render/     canvas renderer at the original's 0.56 world scale + interpolation
src/input/      physical-key mapping to the original's raw key codes
src/audio/      Stable Audio 3 sample playback with procedural fallback
public/audio/   generated sound effects (Ogg Vorbis)
test/           the §17 build-order checks as assertions
```

Each frame runs in the original's order: step, controls, rules, AI, then the
ball clamps. Input therefore lands one step late, as it did in the original.
The step is 1/28 s at 30 fps, so the game runs about 7% fast, also as in the
original.

## Measured against the spec's §17 reference figures

| Check | Spec | This build |
| --- | --- | --- |
| Ball dropped from y=20 | returns to ~20, indefinitely | 16.8 – 20.4, for 60 s |
| Standing head height | ~260–280 | 261 |
| Feet at rest | on y=355 | sole at ~353 |
| Hips travel, 1 s holding right | ~200 px | 198 px |
| Jump lift | ~170 px, clears the 149 px net | 169 px |
| 90 s random-input soak | points both sides, no NaN | yes, and deterministic |

## How to play it

In the main menu, click any key in the **Controls** panel to reassign that
action for either player. Press Esc to cancel, or **Reset keys** to restore the
original layout. Assignments are saved in this browser. P and M remain the
pause and sound shortcuts; a key already assigned to another action cannot be
assigned again.

**Serve in the air.** The held ball hangs at your feet. Tap Space (or R for
player 2) to serve with a fixed underhand flick. Jump first to clear the net.
Once the ball is free, hold the same key to wind up the outside arm and release
to hit. Hold Shift (or E for player 2) to hit with the other arm instead.
The windup briefly slows the physics and gently draws a nearby free
ball toward the striking hand. A full charge delivers a stronger hit. Both hands
share a 45-second cooldown after each swing, which resets at the start of every
round; serving remains available. A swing that reaches a nearby opponent
also knocks them back, with force set by the charge.

Releasing a swing within two frames of contact between the selected hand and
ball adds a perfect-hit boost. Nearly simultaneous swings by the net trap the
ball briefly before the stronger side sends it across.

Holding jump bunny-hops. That is deliberate: Flash re-fired key-down on OS key
repeat, which re-armed the consumed jump flag.

## Goal gifts

Every third point, however it was scored, produces a gift in the next round.
Gifts alternate between player 1's and player 2's side, stay for 10 seconds,
and can be collected only by the player on that side. Pickup grants one random
ability for 30 seconds: 1.5× body size, ⅔ body size, feather ball (a free ball
over your half falls at 40% gravity), 1.5× jump, faster movement, a nearby-ball
magnet, or protection against opponent and boxer knockback. The player then returns to normal. The HUD shows the ability and its
remaining time.

Size changes affect the ragdoll's actual collision shapes. The doll grows or
shrinks over about 13 frames. An instant ×1.5 would teleport a hand through the
2 px net, where it stays caught. Each resize rebuilds the joints from the joint
table rather than the current pose, so a stretched joint never becomes
permanent. A new pickup replaces any existing ability outright. Every ability
is just `player.power` plus a target size, so nothing can stack.

The doll hangs from its head on the vertical rail, so the rail's lower limit
moves with the size: otherwise a ⅔-size doll dangles ~17 px above the floor and
`jump()` never sees it as grounded. A shrunken doll also gets extra jump lift
so its head peaks as high as a full-size jump. Crouch, arm wind-up and the
grounded checks scale with the doll as well.

## Fidelity notes

The rules and constants follow the spec exactly. The points below are where a
modern engine or an unstated detail forced a decision. Each one is marked in the
code where it happens.

**Solver differences (§18). Expected, not tuned away:**

- **Head rotation transients.** `jump()` pushes the head at the *fingertips*
  (§16.7), a median ~300 rad/s spin kick. The rail cancels almost all of it:
  the median residue is 0.04°. On rare frames with very asymmetric arms, about 6
  times in 12 minutes of flailing, it leaves 10–60° for one or two frames. The
  cause is the ~1:500 mass ratio between PrismBody and the doll, the same one §6
  gives for the head sag.
- **The rail gives a few pixels** under violent input (at most ~10 px of lateral
  play). That is the same mass ratio at work.
- **Iterations.** Box2DFlash 2.0 had one `m_iterations = 10`. planck splits it,
  so this build uses 10 velocity and 10 position iterations. Varying the
  position count from 1 to 10 left every §17 figure within noise.

**Unstated details, and the reading taken:**

- **Timers** count frames (200 ms = 6 frames). At the original's steady 30 fps
  that equals wall clock, and it makes the whole game deterministic.
- **`standPlayer`** moves the 13 parts but not PrismBody, as the spec lists.
  The rail pulls PrismBody back under the head within one step, invisibly.
- **`newRound`** first releases any grip still on the ball. `takeBall` refuses a
  jointed ball, so restarting a match mid-serve would otherwise leave it stuck to
  the wrong hand. Normal play never reaches this.
- **The AI's `DisableMoveAfterPas`** is cleared once the ball reaches the human's
  half. The spec says when it is set but not when it is cleared.
- **The executer's ×2 burst** fires every third second of its life. The spec
  marks the cadence as its least certain detail.
- **Campaign levels** scale the points a goal is worth. Levels 1–5 use the
  spec's AI defaults (`AImaxSpeed` 7). **Level 6** is a champion challenge. It
  forecasts the ball's flight (walls, net, feather ball), finds where the ball
  will meet its head, and picks the contact angle whose rebound lands farthest
  from the opponent. It does this with a bounce model fitted to real head
  contacts: restitution 0.8, friction and spin. With its swing ready it lines
  the ball up in the measured strike zone instead. In bot-vs-bot play it beats
  level 1 about 85% of points from either side. It follows the same physics
  and touch rules as the other levels.
- **Bot vs bot** puts the AI on both sides, each at its own level. The AI is
  written for player 2; on player 1 it sees the court mirrored about the net.
- **Pause** freezes the physics and every timer, serve clock included.
- **A held ball can't land.** Only a free ball sets the floor flag. Otherwise a
  held ball brushing the floor would be scored the moment it was served.
- **Sounds** use short Stable Audio 3 samples for hits, serves, points, buttons,
  and special moves. Procedural cues cover the first moments while samples load
  or if a file is unavailable. Press M to mute. **Render interpolation** blends
  the last two frames on high-refresh displays. Neither touches the simulation.

## The hazard: deliberately reworked from §13

§13 sends an executer 2 s after a rally ends, at whoever the ball finished
beside, as a 400 kg ball whose velocity is overwritten every frame. This build
changes that on purpose:

- **When and where.** Every ball on a wall button launches an executer *in
  that step*, out of that button, into that button's half. There is no limit
  on how many can be alive; one impact is one launch. It hunts the player on
  that side, so aim for your opponent's button. An executer-only barrier above
  the net (collision-filtered, so nothing else ever meets it) keeps it on its
  half.
- **Ten-object sequence.** Both buttons share one hit counter: the first hit
  launches a heavy kettlebell, the second a slower magnet that gently attracts
  nearby players, and the third a hovering boxer that punches the target's
  head. Seven more objects follow (comet, anchor, spring, saw, crystal, gear,
  drone), each with its own artwork and physical tuning. After the tenth, the
  sequence repeats. A player's swinging hand can knock any type away and
  briefly interrupt its pursuit. A new match starts again at the kettlebell.
- **The button** sinks into the wall with a flash and a shockwave. It stays
  pressed and glowing red while any of its executers lives, with a column that
  drains with the longest-lived one, and springs back out when the last dies.
  Every hit replays the press. With hazards off, a button still clicks and
  pops back, but launches nothing.
- **Pinning.** Within 45 px of its player a ball executer stops hunting, spins up
  to 14 rad/s, and tries to pin them:
  - *Against their half's outer wall* (the usual case). It gets round to the
    far side of the player — over the top if needed — and pushes their torso
    into the wall. Pushing at head height instead tore the neck and waist
    whenever the player fought back.
  - *Against the ceiling*, if it arrives below their shoulders. The doll hangs
    from its head, so a ball pushing on a limb only swings it away like a
    pendulum. Instead it rides alongside the shoulder and puts its lifting
    force into the head, which rides a vertical rail. It climbs at 5 m/s,
    reaching the ceiling in ~7 s, far above the frame (an arrow marks the
    player). Before it expires, it lowers them again rather than dropping them
    37 m.
  - Contact with dolls is nearly frictionless (0.05). The spin is the cue; with
    normal friction an 8 m/s surface whips the doll's light limbs.
  - It lets go if knocked more than 150 px clear.
- **No more tearing through the doll.** Measured on scripted play (standing,
  pacing, hopping, crouching), the spec's executer stretched the ragdoll's
  joints 55–134 px (p99), with tears lasting up to 9 s. That was the break-apart
  and snap-back. Four things caused it, and each is changed:

  | | §13 | Now | Why |
  | --- | --- | --- | --- |
  | Mass | 400 kg | 6 kg | No iterative solver holds a 2.75 kg doll's joints against 400 kg. Still 60× the ball, so shots bounce off it. |
  | Steering | velocity overwrite | force-limited seek, 45 N | An overwrite is unstoppable and crushes the doll into its rail limits. |
  | Contact with dolls | restitution 1 | inelastic | It shoves instead of batting a 0.07 kg hand away. |
  | Solver near a doll | 10 iterations | 20, within 40 px | A light hand hitting a heavy ball is badly conditioned. It is 10 everywhere else. |

  It is a bullet (CCD), because a doll's hands whip past 25 m/s in a jump and
  would otherwise tunnel into it. It has no gravity: it hovers at head height,
  as the velocity overwrite made the original's do. It comes out of the button
  as a sensor and turns solid once clear, so it can never spawn inside the ball
  that pressed it.

  Result: joint separation while being rammed stays within what the doll shows
  on its own (e.g. pacing: 21.6 px max against 30.4 alone). Penetration stays
  under 3.5 px. The test suite pins this, alongside a negative control proving
  the 400 kg original still tears.
- **Ball behaviour retained from §13:** its size, the aim point (target's torso
  x, head y), the 1.3 m/s hunting speed with ×2 bursts, and the 25 s life. At
  that speed it takes ~8–9 s to drift from a wall button to a player.

## The ball off a body

Also not in the original: the ball comes off every body part except the head
30% less elastic (restitution 0.7 instead of 1). The head keeps §5's 1.2.
Box2D mixes restitution as the larger of the two fixtures, so this is set per
contact. The spec's (0, -1) touch pop (§11) is unchanged.

## Going further

The simulation has no dependency on how it is shown or controlled, so these
build on it without touching the physics:

- **Replays and netplay**: the simulation is deterministic, so seeds plus inputs reproduce a match.
- **Touch controls**: add a `KeySink` next to `src/input/keyboard.ts`.
- **More AI tuning**: `AI.maxSpeed` and the §12 thresholds can vary levels 1–5.
- **Original art**: swap `Renderer.partArt`. The §15 artwork bounds are already wired in.

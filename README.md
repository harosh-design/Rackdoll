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
Once the ball is free, the same key is the one attack: hold it to tuck and
release to front-flip toward the opponent. The doll lunges at the net and
turns one full circle, feet coming over the top and down in front of it. The head normally rides a rail that forbids it
to rotate; for the flip that rail becomes a wheel joint on the same line,
whose motor keeps the spin going until the doll is back upright, when the
rail locks again. The tuck briefly slows the physics and gently draws a
nearby free ball to where the feet will pass. Legs that meet the ball kick
it toward the opponent, harder with more charge. A flip has a 45-second
cooldown, which resets at the start of every round; serving remains
available. Once the legs come round, the kick reaches 225 px forward from
where the flip took off and knocks an opponent back, with force set by the
charge. A kick at head height or a leg meeting the head stuns them for three
seconds: movement, jumping, crouching, serving and the tuck work at 20%
strength, and charging is five times slower. Stars and a draining bar above
the head show the stun. Body hits only knock back; a shield blocks both
knockback and stun. Pausing freezes the stun, and a new round clears it.
Nearly simultaneous flips by the net trap the ball briefly before the
stronger side sends it across.

The ball wears the jersey colour of whoever touched it last, or of the
server holding it.

Holding jump bunny-hops. That is deliberate: Flash re-fired key-down on OS key
repeat, which re-armed the consumed jump flag.

## Powers

Powers come from bees; gifts no longer appear on the floor after goals.
Hitting a bee with the ball grants its ability for 30 seconds: 1.5× body size,
⅔ body size, feather ball (a free ball
over your half falls at 40% gravity), 1.5× jump, faster movement, a nearby-ball
magnet, or protection against knockback from the opponent and the hazards. The player then returns to normal. The HUD shows the ability and its
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

## Bee gifts

During play a bee flies in from
beyond the left or right screen edge every 12–20 seconds, with at most two in
the air. It crosses above the net and leaves by the other edge. Each bee carries one of
the seven abilities, and every ability turns up once in each run of seven. Hit
a bee with the ball and its ability goes to whoever holds the ball or touched
it last for 30 seconds, and it replaces any
current ability. The ball passes straight through, so the rally is unchanged.
A bee is only popped in play. During the goal replay the bees slow down with
the physics.

You can tell what a bee gives before you hit it:

| Ability | The bee |
| --- | --- |
| Giant | 1.6× size, slow and heavy, arrows pushing outward |
| Tiny | 0.6× size, fast and jittery, arrows pulling inward |
| Feather ball | carries a feather, drifts lazily |
| High jump | rides a spring and bounces along |
| Speed | fastest, with speed lines and afterimages |
| Magnet | carries a red horseshoe magnet |
| Shield | flies inside a bubble |

Each bee also has a halo in its ability's colour and a small label. Its hit
radius matches its drawn size, so the giant bee is the easiest target and the
tiny bee the hardest. The flight is a closed-form function of the bee's age, so it
is deterministic: it can be swept against the ball for the hit test and
interpolated for drawing.

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
- **Sounds** use short Stable Audio 3 samples for hits, points, buttons,
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
- **Five hazards, shuffled.** Both buttons share one queue: magnet, boxer,
  comet, spring and slime, each run of five in a fresh random order, never the
  same one twice in a row. The next four are previewed at the top of the screen, in
  the order they will come out, and slide along as each launches. A new match
  shuffles a fresh order. A flipping player's legs can knock any of them
  away and briefly interrupt its attack.
- **Magnet.** The slowest hunter (~1.4 m/s), with a strong field out to
  240 px. Its player is dragged toward it — the same sideways acceleration on
  every part, up to 30 m/s², so the doll moves without stretching — and their
  arms reach for it. Walking away from one at close range is about 45% slower.
  It bends a free ball's flight too: sideways harder than gravity, but upward
  never more than half of it, so it can't hold a ball up. On contact it
  latches and holds still until its player drags themselves 34 px clear.
- **Boxer.** Hovers a fist's length from one part of its player and jabs:
  head, torso, hips, an arm, a hand, a leg or a foot, whichever it can reach
  from its side, picking a new one after every blow. Each blow shoves the
  whole doll a little and jolts the part it lands on, so a leg is swept or an
  arm knocked aside.
- **Comet.** The fastest hunter. It circles to a run-up point 150 px to the
  side of its player nearest the ball (over their head, if it has to cross),
  then dashes through them at 16 m/s and knocks them away from the ball. It
  glances off, brakes, and lines up again — about one ram a second.
- **Spring.** It settles level with its player's chest, then charges,
  building speed the whole way in (8 m/s², up to 11 m/s). Impact strength is
  65% the speed it reached and 35% the distance it ran; the push grows
  steeper than linearly with it, so a bump from a standing start stays a bump
  and a long run throws the player hard. It rebounds off them at a speed set
  by its own, flies free, brakes gradually and settles, then charges again.
- **Slime.** A glob of glue that flies at one of its player's hands, thighs
  or shins (4.5 m/s, bobbing) and sticks to whatever part it reaches first,
  weighing it down. Stuck, it reels the nearest end of another limb in on a
  strand and glues it into itself, two at most: a hand ends up stuck to a
  thigh, the other hand or a foot. It holds on for 6 s, then peels off,
  re-forms and comes again.
  - *It rides on the doll, it isn't jointed to it.* A 2.4 kg body welded to
    a 0.07 kg hand tears the arm, so once stuck it is a sensor that follows
    the part it hit. It has no contact to solve, so it doesn't raise the
    solver to 20 iterations: measured, 20 iterations on a doll that is only
    standing creeps it sideways about 10 px a second.
  - *The glue is a spring, not a joint.* Each strand pulls the two parts
    together with at most 10 N, and the reel at most 8 N (enough to lift a
    hanging arm). Pulled more than 24 px past its rest length, a strand
    snaps, and each snap takes 1.5 s off the hold. A jump often tears one, but
    the slime grabs again a second later: a doll hopping every 1.3 s still
    spends about half its slimed time glued.
  - *Getting it off:* flip, and the spin throws it away and frees everything
    it glued. The shield won't take its
    glue, and a new round shakes it off, since re-standing the doll would
    yank glued parts back together across the court.
- **Knocks.** Every blow is a change of velocity given to every part of the
  doll alike, plus a jolt to the part struck, and locks steering for a few
  frames so it carries. Shoving only the head and hips, as the opponent's
  flip does, tore the doll at hazard strength. The shield ignores them all.
- **No more tearing through the doll.** Measured on scripted play (standing,
  pacing, hopping, crouching), the spec's executer stretched the ragdoll's
  joints 55–134 px (p99), with tears lasting up to 9 s. That was the break-apart
  and snap-back. Four things caused it, and each is changed:

  | | §13 | Now | Why |
  | --- | --- | --- | --- |
  | Mass | 400 kg | 2.4–6 kg | No iterative solver holds a 2.75 kg doll's joints against 400 kg. Still 24–60× the ball, so shots bounce off it. |
  | Steering | velocity overwrite | force-limited, 45–380 N | An overwrite is unstoppable and crushes the doll into its rail limits. |
  | Contact with dolls | restitution 1 | inelastic | It shoves instead of batting a 0.07 kg hand away. |
  | Solver near a doll | 10 iterations | 20, within 40 px | A light hand hitting a heavy ball is badly conditioned. It is 10 everywhere else. |

  It is a bullet (CCD), because a doll's hands whip past 25 m/s in a jump and
  would otherwise tunnel into it. It has no gravity: it hovers, as the velocity
  overwrite made the original's do. It comes out of the button
  as a sensor and turns solid once clear, so it can never spawn inside the ball
  that pressed it.

  Result: joint separation while each hazard works on the doll stays close to
  what the doll shows on its own, with no sustained tear (e.g. pacing: 20 px
  max with the magnet against 23 alone). A limb meeting one at speed can
  overlap it for a single frame, never longer. Frames where a hard knock has
  thrown the doll onto the net are left out: hung on the net top it stretches
  by itself. The test suite pins this for all five hazards, alongside a
  negative control proving the 400 kg original still tears.
- **Retained from §13:** its size, the 1.3 m/s base hunting speed (the magnet
  and boxer scale it), and the 25 s life. The ×2 bursts are gone: each hazard
  now sets its own pace.

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

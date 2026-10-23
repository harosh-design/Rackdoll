# Ragdoll Volleyball

A faithful rebuild of *Ragdoll Volleyball* (Yuriy Shevchenko / Sedoiga, 2009),
driven entirely by the numbers in [`RAGDOLL-VOLLEYBALL-SPEC.md`](RAGDOLL-VOLLEYBALL-SPEC.md),
which were read out of the original's own AS3 bytecode.

All project code and documentation must be written in English. See
[`AGENTS.md`](AGENTS.md) for the project language policy.

The game uses a shared [pencil horror-comic art direction](docs/HORROR-COMIC-ART.md):
a masked player in an ochre coat, a skeleton in plum shorts, and three maps:
Graveyard, Crematorium, and Dead Circus. On Graveyard, the moon moves smoothly across the
sky along the upper half of an ellipse, taking five minutes to cross and
easing into each return pass. It and the black silhouettes use subtle
line-boil animation; coarse cached procedural paper grain overlays the
artwork at a fixed 16% intensity. The Map selector previews each court and its
fixed center obstacle. Old People, Shaders, and location preferences are ignored.
All three maps use a quiet pencil field with low dark silhouettes and scenery
restricted to the edges, keeping the ball clear of detailed background artwork.
Crematorium and Dead Circus combine illustrated static architecture and props
with vector flames, swaying lamps, steam, striped curtain hems and hanging lights.
Decorative motion stays around the perimeter, freezes on pause and respects
reduced motion.

The comic direction also covers hazards, power-carrying bats,
three illustrated ball skins, motion marks, obstacles, scoreboards, menus, pause
and results. Those visual changes preserve the existing physics and rules.
Each match randomly selects a stitched leather ball, a cratered moon or a mint
eyeball, avoiding consecutive repeats. The skin stays fixed throughout that
match's rounds, serves and pauses; a restart or rematch selects another skin.
The two wall buttons use five side-view gravestone designs without crosses or
pedestals. Each side gets a different random design per match, with no immediate
repeat on that side. The carvings face inward and retain press, flash and active
lifetime feedback.
The fullscreen start menu places The Mask and its controls on the left and
Bones and its controls on the right. Map, mode and weather choices sit between
them, above a centered **Start match** button. Illustrated graveyard scenery,
paper control cards and the game's own character cutouts match the court art.
The start animation sends the players outward and reveals the arena; simulation
and the serve clock begin only after the transition finishes. Reduced motion
skips the animation. Compact screens keep Start visible while setup scrolls.

On Graveyard, each match also picks one of three decorative weather presets: light rain with
occasional distant lightning, drifting snowfall, or a starry autumn night with
passing leaves. Random weather avoids consecutive repeats and stays fixed across
rounds and pauses. Distant particles pass behind the scenery, middle particles
behind the players, and a few larger flakes or leaves cross the foreground.
The start menu's **Weather** selector chooses the next match's weather;
**Random** restores automatic selection. This override lasts for the
current page session. Indoor maps replace outdoor weather with drifting ash in
Crematorium and settling dust in Dead Circus; their weather selector is hidden.
Weather and indoor particles freeze when paused, respect reduced motion,
and do not affect physics or gameplay.
The star field has soft, independent glints. Weather reuses bounded-size cached
artwork, batches rain and snow by depth, and reduces particle density after a
sustained frame-rate drop. All three depth layers remain visible at every
quality level; full density returns gradually when performance recovers.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # the spec's §17 checks, headless
npm run build      # static site in dist/
```

## GitHub Pages

The [deployment workflow](.github/workflows/deploy-pages.yml) builds and publishes
the game after every push to `main`. It can also be run manually from the
repository's **Actions** tab. In **Settings → Pages**, select **GitHub Actions**
as the publishing source. GitHub Pages must be available on the repository's
plan; private repositories require a plan that supports Pages.

After enabling Pages, the game is published at
<https://harosh-design.github.io/Rackdoll/>.
Vite uses relative asset paths so images, audio and scripts load from the
repository's subdirectory.

## Repository contents

Only the current game's source, tests, specifications, documentation and runtime
assets are kept in the working tree. Earlier art directions, source renders,
screenshots, one-off previews and validation reports can be recovered from Git
history. New generated experiments and reports belong in the ignored `output/`
directory; raw audio sources belong in the ignored `sa3_raw/` directory.
`node_modules/`, `dist/` and coverage output are also ignored. Use `npm ci` to
restore dependencies and `npm run build` to regenerate the production site.

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

Choose a **Map** in the start menu. Each card previews its court and unique
divider. The selection is remembered in this browser and applies to all modes,
restarts and rematches. Graveyard is the default. Existing saved obstacle choices
migrate to the corresponding map. The divider is part of the map:

- **Graveyard — Impaling spike** is a tapered spear. Its point acts only on a deep impalement;
  grazes and touches are safe.
  An impaled part is physically pinned while the rest of the skeleton remains
  attached. It slides along the shaft and still turns freely on it. Hold
  **jump** (up) to pull it back up and off the point, or **down** to drive it
  deeper, at most 72 world pixels below the point. A hazard's blow or the
  opponent's flip kick also drives it deeper: fully when the blow points down
  the shaft, half when it is sideways, and not at all when it lifts the doll.
  Parts dragged onto the point behind it are caught too, and each 10 px deeper
  bleeds again. Struggling with any movement key while a caught arm or leg is
  under strong tension (above 30 N per kg of doll, typically by pulling away from
  the net) strains its tendons; about 1.5 seconds of that tears the caught part
  and everything beyond it off. It stays on the spike and the rest of the doll
  drops free. The head, torso and hips are never torn off. A freed part cannot
  be caught again until it has moved clear of the point, a doll that has just
  come free is not caught for 20 frames, and freed hinges heal as their gaps
  close. CPU players do not struggle; anything still caught, or torn off, is
  released or restored at the next round.
  Its trapped player's joints visibly stretch under load, with red ligaments
  joining the separated body parts. Hinges next to the caught part become damped
  springs, with a rope limiting each gap to 48 world pixels at normal size.
  The cutouts follow the actual pinned poses; the next round restores the hinges.
- **Crematorium — Blast fan** repels every movable gameplay object from its column within
  30% of the original player's height (32.7 world pixels). The range stays fixed
  through size powers. Side jets accelerate nearby objects at up to 585 m/s², three times
  the previous strength; upward acceleration is one third as strong (up to 195 m/s²).
  The field fades with surface clearance and applies equally per unit mass to players,
  the ball, detached limbs and executers, including moving sensors. Flying bat familiars
  sample the same field, with damped drift included in rendering and pickup sweeps.
  The capped divider cannot impale. Fast lateral streaks, diagonal wisps and slower,
  thinner upward trails show the outlets and their relative strengths.
- **Dead Circus — Stitched pole** has six physical segments connected by spring-driven hinges.
  Players and the ball can bend it into the opposing half; it returns when released.

Each round releases impaled parts, straightens the rubber net and restores
both players' full bodies. Wall-button hazards are always enabled.
The sharp spike collects red bloodstains after a tear or a new impalement,
with a brief spray and streaks running down the blade. Blood clears next round.

The spike's tip must sit inside the part, away from its edges, with at
least 65% of the shorter of the blade length and the part's thickness embedded.
The check accounts for rotation and size powers and detects deep impalement
even during a fast crossing. Torn-off pieces fall and collide
with the court independently. You can keep moving, jumping and serving with the
remaining body; serving uses another attached hand or the surviving body if both
arms are gone. Lost parts cannot strike or count as ball touches. Injuries heal
before every new round.

The main menu shows editable controls directly on both player cards. Defaults
are arrow keys and Space on the left, WASD and R on the right. Click any key,
then press its replacement; Esc cancels. Duplicate keys and reserved shortcuts
are rejected. Custom bindings are saved in this browser and restored on reload,
including previously saved configurations. **Reset controls** restores both
players' defaults. P and Esc remain pause shortcuts. **How to play** opens the
complete instructions without leaving match setup.

**Serve in the air.** The held ball hangs at your feet. Tap Space (or R for
player 2) to serve with a fixed underhand flick. Jump first to clear the net.
Once the ball is free, the same key chooses an attack from actual floor
contact. If any attached body part touches the floor, pressing it immediately
launches a low volleyball dive toward the ball, even when the ball is behind
the player. Both arms reach forward and the legs trail behind; the doll then
returns upright. Walls, sensors and detached limbs do not count as floor
contact. In the air, hold the key to tuck and release to front-flip toward
the opponent. The doll lunges at the net and turns one full circle, feet
coming over the top and down in front of it. The head normally rides a rail
that forbids it to rotate; for the flip that rail becomes a wheel joint on the same line,
whose motor keeps the spin going until the doll is back upright, when the
rail locks again. The tuck briefly slows the physics and gently draws a
nearby free ball to where the feet will pass. Legs that meet the ball kick
it toward the opponent, harder with more charge. Flips and dives share a 45-second
cooldown, which resets at the start of every round; serving remains
available. Once the legs come round, the kick reaches 225 px forward from
where the flip took off and knocks an opponent back, with force set by the
charge. A kick at head height or a leg meeting the head stuns them for three
seconds: movement, jumping, crouching, serving and the tuck work at 20%
strength, and charging is five times slower. Stars and a draining bar above
the head show the stun. Body hits only knock back. Pausing freezes the stun,
and a new round clears it.
Nearly simultaneous flips by the net trap the ball briefly before the
stronger side sends it across.

The ball wears the jersey colour of whoever touched it last, or of the
server holding it.

Holding jump bunny-hops. That is deliberate: Flash re-fired key-down on OS key
repeat, which re-armed the consumed jump flag.

## Physics debug and presets

Click **Debug** in the top-right corner from the menu or during a match.
The panel provides sliders and numeric inputs for gravity, ball mass, air
density, player movement, jump strength and ball bounce. Changes apply
immediately and carry into new rounds and matches. Both human and CPU players
use the movement and jump multipliers. Press P to pause while tuning; text
entry and slider arrow keys do not control the players.

**Save preset** stores the current combination under a name in this browser;
saving the same name updates it. Select a preset and click **Load preset** to
apply it. **Delete** removes the selected custom preset. **Reset physics**
restores the default game values: gravity **11.6 m/s²**, ball mass **0.125 kg**,
air density **0**, player movement **1.30×**, jump strength **1.00×**, and ball
bounce **1.08×**. **Original physics** remains available as a separate preset.
The last applied settings are also remembered
on reload. **Export JSON** downloads the current settings; **Import JSON**
validates, saves and applies an exported preset. If browser storage is blocked,
tuning works for the session and JSON export provides a way to keep presets.
Existing saved copies of the old default upgrade to the new default; custom
tuning and named presets are preserved.

Air density defaults to zero to preserve the existing simulation. It maps to
linear damping at `0.2 × density` per second, an arcade approximation applied
to the ball, ragdoll parts and hazards, excluding the invisible rail sensors.
Ball mass scales rotational inertia proportionally; ball bounce multiplies
the existing court, head and limb restitution values. Physics settings belong
to each world independently and do not modify the reference constants.

## Powers

Powers come from talismans carried by bats.
Hitting a talisman with the ball grants its ability for 30 seconds: 1.5× body size,
⅔ body size, Updraft (1.5× jump height and a free ball
over your half falling at 40% gravity), or faster movement. The player then
returns to normal. The HUD shows the ability and its remaining time.

Updraft combines the higher jump and slower ball in a single power. Its slow
fall applies only over the half belonging to the player who collected it,
regardless of where the bat was hit or who last touched the ball afterward.
Faint streams of air rise across that half while the power is active. They
freeze with the match and disappear when the power expires or is replaced.
The jump boost ends at the same time.

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

## Bat familiars

Power talismans fly in from either screen edge every 12–20 seconds, with at most
two active. They carry one of four abilities. Hit the talisman with a ball you
last touched to collect its 30-second power. A new pickup replaces the current
ability. The ball continues its flight. During goal replays the delivery slows
with the simulation.

Talisman glyphs identify the power: plus for Giant, minus for Tiny, a wave for
Updraft, and chevrons for Speed. The short label beneath each talisman names the effect.
Giant and Tiny deliveries retain their different sizes and flight styles.

The collectible hit sweep and trajectories still use the legacy `Bees`
simulation API. The renderer centers each power seal on that hit region and
adds an inked bat with hinged wings for Giant, Tiny, Updraft, and Speed. This
preserves deterministic pickup behavior and the existing physics tests.

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
  forecasts the ball's flight (walls, net, Updraft), finds where the ball
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
  or if a file is unavailable. Background music is temporarily disabled while
  replacement tracks are planned; sound effects keep playing.
  **Render interpolation** blends the last two frames on high-refresh
  displays. Neither touches the simulation.

## The hazard: deliberately reworked from §13

§13 sends an executer 2 s after a rally ends, at whoever the ball finished
beside, as a 400 kg ball whose velocity is overwritten every frame. This build
changes that on purpose:

- **When and where.** Every ball on a wall button launches an executer *in
  that step*, out of that button, into that button's half. There is no limit
  on how many can be alive; one impact is one launch. It hunts the player on
  that side, so aim for your opponent's button. An executer-only barrier above
  the net (collision-filtered, so nothing else ever meets it) keeps it on its
  half. The two original wall buttons are drawn as cracked gravestones; their
  positions, colliders, launch points and activation rules are unchanged.
- **Six hazards, shuffled.** Both buttons share one queue: magnet, boxer,
  comet, spring, slime and chameleon, each run of six in a fresh random order, never the
  same one twice in a row. The next hazard is previewed at the top of the screen
  and updates as each launches. A new match
  shuffles a fresh order. A flipping player's legs knock flying hazards
  away and interrupt any hazard's attack.
- **Magnet.** The slowest hunter (~1.4 m/s), with a strong field out to
  168 px. A mint dashed circle marks that exact radius, with a faint field tint
  and inward-moving waves behind the players and ball. The field dims while
  emerging or knocked back; reduced-motion mode keeps the boundary and tint
  without the waves. Its player is dragged toward it — the same sideways acceleration on
  every part, up to 30 m/s², so the doll moves without stretching — and their
  arms reach for it. Walking away from one at close range is about 45% slower.
  It bends a free ball's flight too: sideways harder than gravity, but upward
  never more than half of it, so it can't hold a ball up. On contact it
  latches and holds still until its player drags themselves 34 px clear.
- **Voodoo boxer.** Hovers a fist's length from its player's head and aims
  every jab directly at it, following jumps and flips. Each blow shoves the
  whole doll a little and jolts the head.
- **Fire skull (`comet`).** The fastest hunter. It circles to a run-up point 150 px to the
  side of its player nearest the ball (over their head, if it has to cross),
  then dashes through them at 16 m/s and knocks them away from the ball. Every attack, including a miss, ends with a one-second diving
  somersault before it brakes and lines up again. Its skull
  turns smoothly around its centre toward the player independently of its
  flight direction; motion streaks still follow the flight.
- **Bone trap (`spring`).** Drops straight from its gravestone under gravity,
  with a small inward nudge, and first launches toward its player by bouncing
  off the floor. Each floor, wall, net or object contact starts a new hop aimed
  into that surface's outward hemisphere. It never homes or hovers in mid-air:
  gravity curves its flight while acceleration follows its existing momentum.
  The distance flown since the last bounce increases acceleration from 1.5 to
  7.5 m/s², capped at 11 m/s, and contributes to a stronger impact on the player
  and loose objects. The coil stretches and bows in flight, compresses on every
  bounce, and gains ochre highlights and longer ink speed scratches as it charges.
  A player hit sends it sideways at least 6 m/s and suppresses further shoves
  and aimed returns for one second; it can still ricochet off scenery during
  that escape. A flip also interrupts its pursuit without cancelling gravity.
- **Ectoplasm (`slime`).** A glob of glue that flies at one of its player's hands, thighs
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
    it glued. A new round also shakes it off, since re-standing the doll would
    yank glued parts back together across the court.
- **Chameleon.** Wears the approved moss-green fern-and-lichen skin, with a
  curled tail and golden eye. It emerges from a gravestone over 0.8 s and crawls
  down that wall at 23 px per physics second, 15% faster than before. It stops
  clear of the floor and remains for its full 25-second life. It keeps crawling
  while attacking and stays attached to the wall when struck. Every 2.4 s
  after its previous tongue cycle, it aims at the nearest eligible target
  within 420 px: its player or a free ball in play on its half. The tongue
  shoots out over 0.2 s, tugs for 0.4 s and retracts. A moving target can
  dodge the shot or break free by leaving reach. The tongue pulls the whole
  player toward the mouth at 6.4 m/s² and a free ball at 12 m/s², twice its
  previous strength. Upward acceleration is capped at 25% of gravity for
  the player and 45% for the ball, so neither can be held aloft. A flip
  interrupts the tongue, and a round reset releases it.
  Its body remains a kinematic sensor, so it cannot pin a doll against the wall.
- **Knocks.** Every blow is a change of velocity given to every part of the
  doll alike, plus a jolt to the part struck, and locks steering for a few
  frames so it carries. Shoving only the head and hips, as the opponent's
  flip does, tore the doll at hazard strength.
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
  would otherwise tunnel into it. The spring falls under gravity; the other flyers hover. Each comes out of the button
  as a sensor and turns solid once clear, so it can never spawn inside the ball
  that pressed it.

  Result: joint separation while each hazard works on the doll stays close to
  what the doll shows on its own, with no sustained tear (e.g. pacing: 20 px
  max with the magnet against 23 alone). A limb meeting one at speed can
  overlap it for a single frame, never longer. Frames where a hard knock has
  thrown the doll onto the net are left out: hung on the net top it stretches
  by itself. The test suite pins this for all five flying hazards, alongside a
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

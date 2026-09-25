# Ragdoll Volleyball (2009) — replication spec

Everything needed to rebuild the original Flash game *Ragdoll Volleyball*
(Yuriy Shevchenko / Sedoiga, May 2009) from scratch. Every number here was read
out of the game's own ActionScript 3 bytecode and its SWF shape tags, not
observed or tuned by eye.

This document is self-contained: it assumes no earlier code and describes only
the original game. Section 2 tells you how to re-open the original yourself if
you need to check something this spec does not cover.

**Units.** The original works in stage pixels and divides by `m_physScale = 30`
to get physics metres. Everything below is in stage pixels unless it says
metres. Box2D here is **y-down**: `+y` is toward the floor, so a *negative* y
impulse pushes a body *up* the screen.

---

## 1. The ten things that actually matter

1. **The doll does not balance — it hangs.** A tiny sensor body rides a
   horizontal prismatic joint on the static ground, and the head rides a
   vertical prismatic joint on that. Everything else dangles from the neck. Get
   this wrong and nothing else will feel right. (§6)
2. The engine is **Box2DFlash 2.0**, gravity `(0, 10)`, 30 px/m, 10 solver
   iterations.
3. The time step is **1/28 s taken once per 30 fps frame** — the game runs ~7%
   fast against its own clock. Do not "fix" this.
4. The ball has **restitution 1** and an explicitly set mass of 0.1 kg, and its
   speed is clamped every frame to |vx| ≤ 15, |vy| ≤ 20 m/s.
5. Movement is impulses only — there are **no motors anywhere**. Both prismatic
   motors are explicitly disabled.
6. Moving sideways **zeroes the hips' velocity first**, then applies a ±4
   impulse. That stop-and-kick is what gives the game its twitchy feel.
7. Every fresh player touch adds a `(0,-1)` impulse to the ball — on a 0.1 kg
   ball that is a **10 m/s pop upward**. Rallies are impossible without it.
8. The two players are distinguished **by friction alone**: 0.5 for player 1,
   0.51 for player 2. The contact code uses that to decide whose touch it was.
9. There is **no collision filtering at all**. Both dolls collide with each
   other and with their own non-adjacent parts.
10. The collision boxes are much smaller than the artwork drawn on them. Draw
    limbs at collider size and the doll looks long-armed and short-legged. (§13)

---

## 2. Re-opening the original

The distributed SWF is a MochiAds wrapper, not the game. To get at the real
thing (this is what produced every number below):

1. Fetch the SWF, e.g.
   `https://bubblebox.com/gamedata/bubblebox/swf6/1152/ragdoll-volleyball.swf`.
   It is `CWS` — strip the 8-byte header and zlib-inflate the rest.
2. Walk the tags; the one `DefineBinaryData` (tag 87) of ~941 KB is the payload.
   Skip its 6-byte header (id + reserved u32).
3. Decrypt: **RC4**, key = the payload's **last 16 bytes** used cyclically in
   the key schedule, applied to only the **first `min(len-16, 131072)` bytes**.
4. zlib-inflate bytes `0 .. len-16` of the result. You get an uncompressed `FWS`
   SWF of ~1.14 MB.
5. Its single `DoABC` tag holds the game. Classes to read: `world`, `ground`,
   `player`, `ball`, `control`, `game`, `AI`, `MyContactListener`,
   `prizeButton`, `executer`, `options`.

Because the game still runs offline under Ruffle with the MochiAds servers long
dead, the decryption is necessarily local and deterministic.

**Trap:** in AVM2, `pushbyte` is a *signed* int8. Read it unsigned and joint
limits come out as 226° and 253° instead of −30° and −3°.

---

## 3. World

| Setting | Value | Source |
| --- | --- | --- |
| Engine | Box2DFlash 2.0 | class list |
| Gravity | `b2Vec2(0, 10)`, y-down | `world` ctor |
| World AABB | (−1500, −1500) … (2500, 2500) | `world` ctor |
| doSleep | true | `world` ctor |
| `m_physScale` | 30 px per metre | `world` cinit |
| `m_iterations` | 10 | `world` cinit |
| `m_timeStep` (play) | **0.035714** (1/28) | `game` ctor |
| `m_timeStep` (menu) | 0.04 (1/25) — never used in play | `world` ctor |
| `m_timeStep` (goal replay) | 0.005 | `game::viewGoal`, `on_Goal` |
| `m_timeStep` (paused) | 0 | `gameMenu::click_pauseB` |
| SWF frame rate | 30 fps, one `Step` per `ENTER_FRAME` | SWF header, `world::Update` |

**Per-frame order** (`world::Update`), which matters because input lands one
step late:

```
world.Step(m_timeStep, m_iterations)
sync every body's sprite: sprite.x = body.GetPosition().x * 30, etc.
control.update(player1); control.update(player2)
game.update()
AI.update()            // single-player only
ball.update()          // the speed clamps, last
```

---

## 4. Court

From the `ground` class. All bodies are static because the polygon defs are left
at **density 0** — they still call `SetMassFromShapes()`, which yields mass 0.
`e_bodytype` is the game's own tag on each body, used by the contact rules.

| Body | Centre (x, y) | Half extents | friction | `e_bodytype` |
| --- | --- | --- | --- | --- |
| Left wall | (−265, −230) | (50, 650) | default 0.2 | 2 |
| Right wall | (890, −230) | (50, 650) | default 0.2 | 2 |
| Ceiling | (320, −900) | (600, 50) | default 0.2 | — |
| Ground | (320, 405) | (600, 50) | default 0.2 | 15 |
| Net | (320, 281) | (1, 75) | **2.5** | 2 |

Derived surfaces you will actually use:

- **Floor top: y = 355**
- **Net: x = 320, spans y 206 … 356** (2 px wide, 150 tall — the "spike in the
  middle"; its friction of 2.5 is what makes dolls stick to it)
- Left wall inner face x = −215, right wall inner face x = 840

**Spawns:** player 1 at (100, 256) id 1, player 2 / computer at (500, 256) id 2,
ball at (200, 20). At level start player 1 is given the ball:
`player1.takeBall(ball.Body); ball.ballOfPlayer = 1`.

**Court centre for rules:** 10.7 m (= 321 px) for serve legality, 10.6 m for
deciding which side the ball landed on.

---

## 5. The ragdoll — 13 bodies

All from the `player` constructor, `player(world, x, y, id, sex)`. Offsets are
from the spawn point. All have `angularDamping = 0`, call `SetMassFromShapes()`,
and are tagged `e_bodytype = 1`.

| Name | dx | dy | Shape (half extents / radius) | density | restitution |
| --- | --- | --- | --- | --- | --- |
| HandLeft | −41 | 18 | box 12 × 4 | 1 | 1 |
| HandRight | +41 | 18 | box 12 × 4 | 1 | 1 |
| ArmLeft | −22 | 18 | box 12 × 4 | 1 | 1 |
| ArmRight | +22 | 18 | box 12 × 4 | 1 | 1 |
| Tors | 0 | 32 | box 10 × 17 | **0.1** | 1 |
| Head | 0 | 2 | **circle r 10** | 1 | **1.2** |
| FingerLeft | −54 | 18 | box 4 × 4 | 1 | 1 |
| FingerRight | +54 | 18 | box 4 × 4 | 1 | 1 |
| FootLeft | −7 | 90 | box 5 × 11 | 1 | 1 |
| FootRight | +7 | 90 | box 5 × 11 | 1 | 1 |
| LegLeft | −7 | 69 | box 5 × 13 | 1 | 1 |
| LegRight | +7 | 69 | box 5 × 13 | 1 | 1 |
| Ass | 0 | 50 | box 10 × 6 | 1 | 1 |

**Friction is the player's identity:** every part gets **0.5 for id 1** and
**0.51 for id 2**. `game::update` reads the contacting fixture's friction to
decide whose touch it was. Keep the odd 0.51.

Naming note: `Arm` is the upper arm, `Hand` is the forearm, `Finger` is the
hand, `Leg` is the thigh, `Foot` is the shin-and-foot, `Ass` is the hips.

### Joints — 12 revolute, all with limits enabled

Anchor is the spawn point plus (dx, dy). Angles in degrees.

| Body A | Body B | dx | dy | lower | upper |
| --- | --- | --- | --- | --- | --- |
| Tors | Head | 0 | 10 | −30 | 30 |
| Ass | Tors | 0 | 45 | −30 | 30 |
| ArmRight | Tors | +12 | 18 | −100 | 85 |
| ArmLeft | Tors | −12 | 18 | −85 | 100 |
| ArmRight | HandRight | +31 | 18 | −10 | 100 |
| ArmLeft | HandLeft | −31 | 18 | −100 | 10 |
| FingerRight | HandRight | +53 | 18 | −10 | 40 |
| FingerLeft | HandLeft | −53 | 18 | −40 | 10 |
| LegLeft | Ass | −6 | 56 | −30 | 3 |
| LegRight | Ass | +6 | 56 | −3 | 30 |
| LegRight | FootRight | +6 | 80 | −10 | 25 |
| LegLeft | FootLeft | −6 | 80 | −25 | 10 |

The reference angle is whatever the pose is at creation (arms out horizontally),
so limits are relative to the spawn pose.

---

## 6. The rails — why the doll stands up

This is the mechanism almost nobody guesses, and the whole feel depends on it.

**`PrismBody`** — a dynamic body, `fixedRotation = true`, at
`(railX, −645)` where railX is 100 for player 1 and 500 for player 2. Shape: box
half (1, 1), density 1, friction 0.1, restitution 1, **`isSensor = true`** so it
never collides with anything. It is ~0.004 kg, i.e. negligible next to the doll.

**Horizontal rail** — prismatic joint between the **world's static ground body**
and `PrismBody`, anchored at `PrismBody.GetWorldCenter()`, axis `(1, 0)`:

| | lowerTranslation | upperTranslation |
| --- | --- | --- |
| Player 1 | −13 m | 5.8 m |
| Player 2 | −4.4 m | 14 m |

`enableLimit = true`, `enableMotor = false`, `maxMotorForce = 0`,
`motorSpeed = 0`. These limits are what keep each player on their own half: the
upper limit for player 1 and the lower limit for player 2 both stop just short
of the net.

**Vertical rail** — prismatic joint between `PrismBody` and the **Head**,
anchored at `Head.GetWorldCenter()`, axis `(0, −1)`, limits **[0.2, 55] m**,
`enableLimit = true`, motor off, same zeros.

Two consequences, both load-bearing:

- A prismatic joint locks **relative rotation**, so with `PrismBody` at fixed
  rotation the **head can never rotate** — and the horizontal rail in turn locks
  `PrismBody`'s y, so the head only ever moves along one vertical line.
- The 0.2 m lower limit means the head can never sag below its standing line.
  The doll is suspended from its skull; the rest is genuinely ragdoll.

Expect the head to sag slightly below the limit under load — the mass ratio
between `PrismBody` and the doll is about 1:500 and any sequential-impulse
solver gives a little. That sag is part of the original's look.

---

## 7. Controls

`control` stores key state in a table keyed by raw key code and runs
`update(player)` once per frame per player, after the world step.

| Action | Player 1 (left, id 1) | Player 2 (right, id 2) |
| --- | --- | --- |
| Move left | ← (37) | A (65) |
| Move right | → (39) | D (68) |
| Jump | ↑ (38) | W (87) |
| Down | ↓ (40) | S (83) |
| Serve | Space (32) | R (82) |

`update(player)` per frame:

```
if (key[jump])  { player.jump(); key[jump] = false }   // consumed: needs a fresh press
if (key[down])    player.turnDown()                    // repeats while held
if (key[left])    player.turn(b2Vec2(-4, 0))           // repeats while held
if (key[right])   player.turn(b2Vec2( 4, 0))           // repeats while held
if (key[serve])   player.pas(ball)                     // no-op unless holding the ball
```

---

## 8. Player actions

Exact, in the original's order. `wc` = `GetWorldCenter()`. Remember Box2D's
`ApplyImpulse(impulse, point)` adds the **full linear impulse regardless of the
point**; the point only contributes torque. `jump()` leans on this.

```
jump():
    if (!(Ass.wc.y > 296/30)) return        // only when the hips are low, i.e. grounded
    v = normalize(Head.wc - Tors.wc) * 13
    Ass.SetLinearVelocity(0, 0)
    Head.SetLinearVelocity(0, 0)
    Head.ApplyImpulse((0, -4), Head.wc)
    Head.ApplyImpulse(v, FingerLeft.wc)     // applied to the HEAD, at the fingertip
    Head.ApplyImpulse(v, FingerRight.wc)    // applied to the HEAD, at the fingertip
    Ass.ApplyImpulse((0, -4), Head.wc)

turn(impulse):                              // sideways movement
    Ass.SetLinearVelocity(0, 0)
    if (Head.wc.y * 30 > 200) Ass.ApplyImpulse(impulse, Ass.wc)    // grounded: drive the hips
    else                      Head.ApplyImpulse(impulse, Head.wc)  // airborne: drive the head

turnComp(impulse):                          // the AI's softer variant
    Ass.SetLinearVelocity(0, 0); Head.SetLinearVelocity(0, 0)
    if (Head.wc.y * 30 > 200) { Head.ApplyImpulse(impulse*0.5, Head.wc)
                                Ass.ApplyImpulse(impulse*0.5, Ass.wc) }
    else                        Ass.ApplyImpulse(impulse, Ass.wc)

turnUp():                                   // AI only
    if (Head.wc.y * 30 > 255) Head.ApplyImpulse((0, -1.5), Head.wc)

turnDown():
    FootLeft.ApplyImpulse((0, 1), FootLeft.wc)
    FootRight.ApplyImpulse((0, 1), FootRight.wc)

turnHands(target):                          // AI only, lean toward a body
    v = normalize(target.wc - Head.wc) * 4.5
    Head.ApplyImpulse(v, Head.wc)           // twice, identically
    Head.ApplyImpulse(v, Head.wc)

setLinVelZero():
    zero the linear velocity of all 13 parts and PrismBody
```

### standPlayer(x, y) — the round reset

`setLinVelZero()`, then `SetXForm` every part to angle 0 at these offsets, then
`setLinVelZero()` again:

Head (0, 2) · Tors (0, **28**) · ArmRight (22, 18) · ArmLeft (−22, 18) ·
HandRight (41, 18) · HandLeft (−41, 18) · FingerRight (54, 18) ·
FingerLeft (−54, 18) · Ass (0, **47**) · LegLeft (−7, 69) · LegRight (7, 69) ·
FootLeft (−7, 90) · FootRight (**−7**, 90)

Two quirks, both faithful: Tors and Ass sit 4 and 3 px higher than at
construction, and the **right foot is placed at −7, the same as the left** — an
original bug. The parts separate on the next step; harmless.

### Holding and serving

```
takeBall(ballBody):
    if (ballBody.m_jointList != null) return
    hand = (ID == 1) ? FingerRight : FingerLeft
    ballBody.SetXForm(hand.wc, 0)
    ballJoint = revolute(hand, ballBody, anchor = ballBody.wc)
                with lowerAngle -40deg, upperAngle +40deg   // limits set but NOT enabled

pas(ball):                                  // the serve
    if (ball.Body.m_jointList == null || .joint == null) return
    if (ball.ballOfPlayer != ID) return
    if (ID == 1 && !(ball.Body.wc.x < 10.7)) return    // must still be on your own half
    if (ID == 2 && !(ball.Body.wc.x > 10.7)) return
    sign = (ID == 1) ? +1 : -1
    world.DestroyJoint(joint)
    hand.ApplyImpulse((sign * 1, -1.5), hand.wc)       // the flick that does the real work
    ball.Body.ApplyImpulse((sign * 0.7, -0.5), ball.Body.wc)
    ball.ballOfPlayer = 0
    contact = 2
    Timer(50 ms, 1) -> if (contact != 0) contact = 3
```

The ball's own serve impulse is tiny (Δv = 7, −5 m/s). Most of the serve comes
from the hand being flung and hitting the ball.

---

## 9. Ball

```
b2BodyDef:   angularDamping 0, linearDamping 0, isBullet true
b2CircleDef: radius 15/30 m, density 0.1, friction 0.05, restitution 1
after CreateShape: SetMass({ mass: 0.1, I: 0.01 })     // explicit, overrides density
e_bodytype = 3
```

`ball.update()`, run **last** in every frame, four independent clamps:

```
if (v.y >  20) v.y =  20
if (v.y < -20) v.y = -20
if (v.x >  15) v.x =  15
if (v.x < -15) v.x = -15
```

`ballOfPlayer` is 0 while in flight, otherwise the id of whoever holds it.

Cosmetic, if you want it: the ball's sprite gets a blur filter scaled by
`|vx|/7` (or `|angularVelocity|/11` below 4.5 m/s), and a trail sprite scaled by
`speed/25` and rotated to the velocity direction.

---

## 10. Contact rules

`MyContactListener::Result` (a post-solve callback). It identifies the ball by
**fixture friction == 0.05** and reads the other body's `e_bodytype`:

| Other body | Effect |
| --- | --- |
| 7 (prize button) | `ball.vx *= 0.4`; set `bYesPrize` |
| 2 (walls, net) | `ball.vx *= 0.6` |
| 15 (ground) | set `onBallDown` — the rally is over |

Players (type 1) are deliberately absent: the ball keeps everything it has off a
doll.

---

## 11. Game rules

From the `game` class. Timers are Flash `Timer(delay_ms, repeatCount)`.

| Timer | Setting | Purpose |
| --- | --- | --- |
| `contact_timer1/2` | 200 ms, 1 | debounce: clears `bContact1/2` so one hit counts once |
| `goal_timer` | 2000 ms, 1 | goal replay before the next round |
| `delay_timer` | 1000 ms, **6** | the six-second serve clock |
| serve touch timer | 50 ms, 1 | see `pas()` |

`game.update()` each frame:

1. If the ball is in flight (`ballOfPlayer == 0`) and it has a contact, look at
   the contacting fixture's friction:
   - **0.5 → player 1**, **0.51 → player 2**
   - if that player's `bContact` flag is clear:
     `thatPlayer.contact++`, `otherPlayer.contact = 0`,
     **if the ball has no joint: `ball.ApplyImpulse((0, -1), ball.wc)`**,
     set `bContact`, start that player's 200 ms timer.
2. If the ball is held, both players' `contact` reset to 0.
3. If either player's `contact` **> 3**, the opponent scores (the three-touch
   rule; `contact == 3` is what lights their warning indicator).
4. If `onBallDown` and the ball is not held:
   `ball.wc.x < 10.6` → **point to player 2** (`win1 = false`), otherwise
   **point to player 1** (`win1 = true`).
5. On a point: show the goal, set `m_timeStep = 0.005`, start `goal_timer`.
   After 2 s, if the winner has reached `options.gameSet` (**10**) the match
   ends; otherwise `newRound()` and `m_timeStep` back to 0.035714.

`newRound()`: `standPlayer(100, 256)` and `standPlayer(500, 256)`, both
`contact = 0`, the **winner of the last point takes the ball**
(`win1 ? P1 : P2`), restart `delay_timer`.

**Serve clock:** `delay_timer` ticks once a second and shows `6 - count` sec. At
count 6, if the ball is still held, its joint is destroyed and the holder's
`contact` is set to **4** — which immediately hands the point to the opponent.

Match structure: first to 10 points; the campaign is five opponents of rising
level, and the points awarded per goal scale with the opponent's level.

---

## 12. AI opponent (single player)

`AI(computer, ball)` drives player 2 in level 2. `maxSpeed = options.AImaxSpeed`
(**7**), `Pas_timer = Timer(700 ms, 5)`, `act_count = 0`.

`update()` each frame, after the players' controls:

```
if (DisableAI) return
d = ball.Body.wc - computer.Head.wc

if (ball.ballOfPlayer == 2):                 // the AI is holding the ball
    if (act_count == 0):
        if (ball.Body.wc.x < 11) computer.turn((1, 0))   // shuffle into position
        else                      Pas_timer.start()      // then run the serve routine

else:                                        // rally
    if (ball.Body.wc.x > 10 && !DisableMoveAfterPas):
        speed = maxSpeed
        if (|d.x| > 1 && |ball.vx| < 4): speed = clamp(|ball.vx| * 2, -maxSpeed, maxSpeed)
        if (computer.Head.wc.x >= ball.Body.wc.x + 0.3) computer.turnComp((-speed, 0))
        else                                            computer.turnComp(( speed, 0))

    if (ball.Body.wc.x < 10.7):              // ball is on the human's half
        goToXPlace(12.7, 2)                  // return to a home position
        if (d.x in (-7, 0) && d.y in (-7, 0) && ball.ballOfPlayer == 0) computer.jump()

    if (d.x in (0.5, 1.5) && ball.Body.wc.x > 9)  computer.turnComp((1.5, 0))
    if (d.x in (-1.5, 0) && d.y in (-2.5, 0))     computer.jump()
    if (d.x in (-1.5, 0) && d.y in (-5.5, 0))     computer.jump()
    if (ball.Body.wc.x > 10 && d.y > -3 && ball.ballOfPlayer != 2) computer.turnDown()

goToXPlace(x, speed):
    if (computer.Head.wc.x > x) computer.turn((-speed, 0))
    if (computer.Head.wc.x < x) computer.turn(( speed, 0))
```

`on_PasTimer` (fires up to 5 times, 700 ms apart) sequences the serve through
`act_count`: jump, then `computer.pas(ball)` followed by a hard `turn((16, 0))`
to swing the arm through the ball; if the ball is still held it retries,
otherwise it sets `DisableMoveAfterPas` so the AI does not immediately chase its
own serve. When the ball leaves, the timer resets and `act_count` returns to 0.

The exact branch nesting of `update()` and `on_PasTimer` is the one part of this
spec reconstructed from a stack-machine trace rather than read off cleanly —
treat the thresholds as exact and the control flow as very close.

---

## 13. Hazards

The game's tagline is "one-on-one volleyball with hazards", and this is it.

**Prize buttons** (`prizeButton`): two static targets at the far left and right,
centres (−211, −245) and (837, −245), box half (3, 35), friction 0.4,
`e_bodytype = 7`. Hitting one costs the ball 60% of its horizontal speed (§10)
and sets `bYesPrize`. When the rally ends, `game` calls
`prizeButton.sendPrize(P1, P2)`, which after a 2000 ms timer spawns an
**executer** against the player on whose side the ball finished.

**Executer** (`executer`) — a heavy spiked ball that hunts a player:

| Property | Value |
| --- | --- |
| Shape | circle r 18 (= 0.6 m), friction 0.3, density 1, restitution 1 |
| Mass | **`SetMass({ mass: 400, I: 0.1 })`** — deliberately enormous |
| `e_bodytype` | 777 |
| Spawn | (3.5, −4) m against player 1, (17.5, −4) m against player 2 |
| Lifetime | `Timer(1000 ms, Life)` with `Life = options.myExLife` / `compExLife` = **25** s |
| Speed | `options.myExSpeed` / `compExSpeed` = **1.3** |

Each frame it steers toward its target —
`normalize(player.Tors.wc.x − Body.wc.x, player.Head.wc.y − Body.wc.y) × speed`
— with periodic ×2 bursts gated on its timer's tick count. The burst cadence is
the least certain thing in this document; the steering, mass and size are exact.

---

## 14. Defaults (`options`)

| Key | Value |
| --- | --- |
| `gameSet` | 10 (points to win a match) |
| `AImaxSpeed` | 7 |
| `myExLife`, `compExLife` | 25 |
| `myExSpeed`, `compExSpeed` | 1.3 |
| `soundVol`, `musicVol` | 1 |
| `quality` | 0 |
| `Shadows` | true |
| `currentLevel` | 1 (five opponents in the campaign) |

---

## 15. Rendering

The original attaches a MovieClip to each body as `userData` and, every frame,
sets `sprite.x = body.GetPosition().x * 30`, `sprite.y = ... * 30`,
`sprite.rotation = body.GetAngle() * 180 / PI`.

The whole world sprite is scaled **0.56** and placed at (124, 180) on a 640×400
stage, which means the visible window onto the world is roughly
**x ∈ [−221, 921], y ∈ [−321, 393]** — the walls sit just inside the frame and
the floor line lands near the bottom. Drop shadows are a `DropShadowFilter` at
distance 10, angle 70° (player 1) / 110° (player 2), alpha 0.2.

### Artwork bounds — draw limbs from these, not from the colliders

Bounding boxes of the original's own part sprites, in stage pixels. The
colliders in §5 are deliberately simplified and noticeably smaller; a doll drawn
at collider size reads as long-armed and short-legged, which is not how the game
looks.

| Sprite | Art w × h | Collider w × h |
| --- | --- | --- |
| `mc_Head` | 21.1 × 21.6 | 20 (circle) |
| `mc_Body` (Tors) | 23.4 × 42.3 | 20 × 34 |
| `mc_Ass` | 26.5 × 17.5 | 20 × 12 |
| `mc_ArmL/R` | 27.9 × 9.9 | 24 × 8 |
| `mc_HandL/R` | 24.3 × 8.1 | 24 × 8 |
| `mc_FingersL/R` | 16.4 × 14.4 | 8 × 8 |
| `mc_LegL/R` | 13 × 35 | 10 × 26 |
| `mc_FootL/R` | 8.9 × 33.7 | 10 × 22 |
| `mc_Ball` | 31.4 × 28.8 | 30 (circle) |

Practical rule: draw each leg segment at sprite length with its **lower** end
pinned to the bottom of its collider, so the sole stays on the sand and the
thigh runs up under the hips. Note the hand sprite's box is measured across
spread fingers — a solid blob at that width reads as a boxing glove.

---

## 16. Traps

1. `pushbyte` is signed — see §2.
2. Do not "tidy up" the 0.5 / 0.51 friction difference; it *is* the player id.
3. `SetMass` on the ball comes after `CreateShape` and overrides the density.
4. No collision filtering anywhere. Dolls collide with each other and with their
   own non-adjacent parts.
5. The time step is 1/28 while the frame rate is 30 — not a typo.
6. Both prismatic motors are off and `maxMotorForce` is 0. The rails constrain;
   they never drive.
7. `jump()` applies impulses to the **Head** at the **fingertips'** positions.
   That is not a transcription slip.
8. The serve is mostly the hand flick, not the ball impulse.
9. The ball must be a bullet — restitution 1 at up to 20 m/s tunnels otherwise.
10. Court bodies are static only because their polygon defs are left at
    density 0.

---

## 17. Suggested build order

Each step has something you can measure before moving on. Reference figures
below come from a faithful reimplementation; they are sanity checks, not
targets to tune toward.

1. **World + court + ball.** Drop the ball from y = 20 with no players. It
   should bounce back to essentially its drop height, indefinitely — restitution
   1 with a tiny elastic gain is correct.
2. **The doll + rails.** With no input it should stand: head settling around
   y ≈ 260–280, feet resting on y = 355, and it must not topple. If it collapses,
   the vertical rail is wrong.
3. **Controls.** Holding right for one second should carry the hips roughly
   200 px; `jump()` should lift the head on the order of 170 px, i.e. clearly
   above the 149 px net.
4. **Serve + rally rules.** Ball in hand at the fingertips, serve clears the
   hand, touches pop the ball up, floor ends the rally, score changes on the
   correct side.
5. **AI**, then **hazards**. Both are self-contained once 1–4 are right.

A useful shortcut: keep the simulation and rules in a module with no DOM
dependencies, so you can run thousands of frames headless and assert on them. A
90-second soak with random inputs on both sides should score points on both
sides and never produce a non-finite position.

---

## 18. Where a modern port will differ

Box2DFlash 2.0 is not available in JavaScript. Any modern port (planck.js,
box2d-wasm, a later Box2D) shares the bodies, joints, limits and impulse
semantics, but its contact solver is not bit-identical — restitution 1 and
stiff joint limits are exactly where solvers differ most. Expect the behaviour
to match and a long rally to diverge. Everything in this document is engine
independent; only the solver is not.

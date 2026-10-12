# Last Chance Resort: visual concepts

The current game uses the [refined future indoor arena](FUTURE-ARENA-ART.md).
The beach directions below are retained as earlier concept studies.

These two alternatives use the same lore and a readable side-view arena.
The original Moonlit Lagoon concept has been selected and adapted into the
current game. Blue-Hour Beach Club remains a concept for review.

## Implemented Moonlit Lagoon

The environment uses two registered images generated with built-in ImageGen:
[`background-layered.webp`](../public/art/resort/background-layered.webp), a clean
sky, hotel, ocean and sand plate, and
[`palms-layered.webp`](../public/art/resort/palms-layered.webp), transparent palms
and bushes. The previous flattened
[`background-moonlit.webp`](../public/art/resort/background-moonlit.webp) remains
the composition reference. The clean plate restores the scenery behind every
moving plant, so foliage can move without dragging sky or ocean pixels with it.
Character textures are
[`player-1-moonlit.webp`](../public/art/resort/player-1-moonlit.webp) and
[`player-2-moonlit.webp`](../public/art/resort/player-2-moonlit.webp).
The floor rim, stone walls, illuminated wall faces, and metallic net pole are
drawn separately from the photograph, at the existing physics coordinates.
The decorative service buttons retain their actual collision bounds.

The implementation preserves the original camera, court dimensions, player
silhouettes, joints, and scale. Concept poses and enlarged figures are visual
references rather than new physics dimensions. In the base 640-by-400 view,
the collision floor is at y=378.8 and the net collider is 84 pixels tall.
The complete scenery plate fits between the walls above the floor rim,
including when the camera pulls back.

The background renderer composites four WebGL passes: the clean plate, drifting
cloud wisps, ocean motion, and transparent foliage. Water texture displacement,
perspective ripples, lunar glints and three shoreward foam fronts are restricted
to the ocean below the right-hand coast. Foam fronts break unevenly and fade
before reaching the dry sand. Hotel, cliff and sand pixels stay fixed.

Palm trunks bend gently from their rooted bases; fronds flex more strongly
toward their tips while the crown hubs remain nearly fixed. A travelling gust
field drives the palms, low bushes and near-camera plants with different phases.
The transparent foliage layer shifts as a whole for subtle parallax, following
the smoothed mix of ball position, player positions and camera zoom. The distant
plate remains fixed rather than being stretched to imitate depth.

Two independently swaying transparent plant cutouts form middle and near
foreground layers in the lower corners. The near layer has the greatest
parallax displacement. A narrow corner clip keeps the central floor and net
clear. The cutouts are saved in
[`foreground-plants.webp`](../public/art/resort/foreground-plants.webp), created
with built-in ImageGen from
[this prompt](../output/resort-work/foreground-plants-prompt.txt).

Pausing freezes every scenery clock and parallax smoothing. Reduced-motion
settings freeze clouds and disable water, wind and parallax animation. Devices
without WebGL composite both registered images with static Canvas rendering;
context restoration reuploads both textures. Foreground cutouts use Canvas.

The production assets were edited with built-in ImageGen using
[these English prompts](../output/resort-work/moonlit-asset-prompts.json).
The layered asset prompts are saved in
[layered-background-prompts.json](../output/resort-work/layered-background-prompts.json).
The browser validation preview is
[layered-background-preview.html](../output/resort-work/layered-background-preview.html),
with its measured result in
[layered-background-audit.json](../output/resort-work/layered-background-audit.json).
It verifies moving foliage, sea and clouds; stationary hotel, cliff and sand;
separate foliage parallax; deterministic frames; reduced motion; an unobstructed
court; and fallback rendering and WebGL context restoration.

## Shared composition contract

- Use a landscape frame close to the game's 640:400 aspect ratio. Show the
  complete arena and both wall faces.
- Put the collision floor on one continuous horizontal line at about 87% of
  frame height. A narrow pale edge separates the playable floor from a dark,
  shallow foreground strip. Do not use a distant shoreline as the floor cue.
- Show straight, inward-facing walls near both frame edges, with continuous
  contrasting inner edges that meet the floor. Keep their service buttons
  visible and avoid decorative openings that suggest extra exits.
- Place the narrow net at the center, rising about 21% of frame height above
  the floor. An upright player occupies about 17% of frame height. Jumping
  changes the pose and position, not the player's anatomical scale.
- Use warm skin, teal and coral sportswear, restrained pale rim lighting, and
  dark contact shadows. Keep the background behind the players cool and
  low contrast. Preserve distinct ball, limb, floor, and net silhouettes.
- Favor large shapes over foliage detail, window grids, clutter, dramatic
  depth of field, or foreground plants covering the play area.

The relative positions describe the base camera view. Implementation must
derive floor, wall, net, and player positions from the existing renderer and
physics, including its zoom behavior, rather than treating concept pixels as
new collision coordinates.

## Variant 1: Moonlit Lagoon

A restrained realistic 3D beach at night. Midnight blue water and slate-blue
sand support warm, bright tourists. A broad moonlit sky, one low hotel
silhouette with a few amber windows, and sparse palms give the setting its
identity. Pale stone wall edges and the floor rim remain unmistakable.

Image: [Moonlit Lagoon](../output/concepts/last-chance-resort-v2/moonlit-lagoon.png).

## Variant 2: Blue-Hour Beach Club

A modern 3D beach in cool violet-blue twilight. Materials and anatomy remain
realistic, while scenery is simplified into clean silhouettes and broad color
areas. A small amber-lit beach club replaces the larger hotel. Indigo sand,
desaturated lavender water, and pale architectural edges create a distinct
look while keeping the same warm player palette.

Image: [Blue-Hour Beach Club](../output/concepts/last-chance-resort-v2/blue-hour-beach-club.png).

## Animation plan

The delivered images are flattened concept previews. Their composition keeps
moving elements separate and readable; production artwork will need clean
background plates and separate transparent layers or carefully bounded shader
masks. A still image does not itself implement animation.

| Element | Artwork preparation | Motion |
| --- | --- | --- |
| Palm crowns | Isolate each crown with enough clear sky around its full movement envelope; retain a clean sky plate underneath. | Gentle alternating leaf bends, with a small crown sway and slightly different phases between trees. |
| Palm trunks | Separate from crowns; anchor at the ground behind the arena. | Subtle bend strongest near the crown; keep the base fixed. |
| Ocean | Keep an unobstructed horizontal band behind the playable area; separate shoreline foam and broad reflections. | Slow lateral ripples, drifting highlights, and small repeating foam movement. |
| Background plants | Use a few distinct clusters outside the players' silhouettes, with separate bases and leaf tips. | Low-amplitude leaf sway, anchored at each plant's base. |
| Hotel, beach club, walls, net, and floor edge | Keep as static layers with stable outlines. | No background deformation on collision boundaries or architecture. |

Keep motion slow and local. Do not pan or scale the whole background to imitate
wind. Reflections must remain on the water; moving plants must never obscure
the collision edges. Respect reduced-motion preferences and pause decorative
motion when the game is paused.

## Generation record

Both concepts use the built-in ImageGen tool. Their complete English prompts
are saved in [prompts.json](../output/concepts/last-chance-resort-v2/prompts.json).
The final layout corrections are saved in
[refinement-prompts.json](../output/concepts/last-chance-resort-v2/refinement-prompts.json).

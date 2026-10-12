# Switchable locations

Choose **Arena**, **Beach**, or **Rooftop** under **Location** in the main menu.
The landscape icon in the match HUD cycles through the same three locations.
Switching changes only scenery and floor colors, preserving the live match,
score, controls, hazards, and physics. The location is saved under
`rackdoll-arena-scene` in local storage; unavailable storage falls back to a
session-only choice. Arena is the default.

Locations and player graphics are independent. People uses textured players;
Shaders uses glass and chrome players in every location. Arena retains the
original indoor image with People and the procedural flowing light with Shaders.
Beach and Rooftop use their environment plates with either player style.

## Assets

- Arena: `public/art/arena/background.webp` (existing).
- Beach: `public/art/resort/background-moonlit.webp` (existing moonlit coast).
- Rooftop: `public/art/arena/background-rooftop.webp` (new sunset terrace).

The rooftop was edited with built-in ImageGen from the approved rooftop concept.
The exact final prompt, mode, reference, and saved asset path are recorded in
`output/locations-work/rooftop-prompt.json`. The conversion script is
`output/locations-work/package-rooftop.mjs`. The clean plate contains no gameplay
objects; players, drones, net, hazards, and HUD are rendered separately.
All plates remain rigid. The indoor service-light scan retains its pause and
reduced-motion behavior; outdoor plates do not deform buildings or foliage.

## Validation

Production build and TypeScript checks pass. Live browser checks verified menu
selection, HUD cycling during a match without resetting the score, persisted
location after reload, both player styles outdoors, and the original procedural
Arena backdrop. Browser warnings and errors were empty. Screenshots are saved
in `output/locations-work/`.

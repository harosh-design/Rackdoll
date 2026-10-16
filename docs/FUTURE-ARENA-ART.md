# Future indoor arena

Historical art record. The People and Shaders selectors have been removed;
the current background and players use [pencil horror-comic art](HORROR-COMIC-ART.md).
The service-equipment sprites described below remain in use for the current
background/player-only update.

The selected refined concept is implemented as a 2D game scene with pre-rendered
art. The arena background, service robot bodies and gift couriers use the same
ivory, graphite, champagne-metal, teal and coral material direction. Existing
textured player segments retain their physical joints and animation.

`public/art/arena/` contains the clean background and eight transparent sprites.
The scene is never a flattened concept screenshot: scoring, characters, ball,
net, floor, buttons, gifts and hazards are drawn independently.

Courier propellers animate over rigid hull sprites. Each gift sits on the
existing collectible hit region. Magnet field arcs, telescopic boxer arms,
porter motion streaks, the flexible steel spring between rigid caps, and spa
adhesive strands remain animated. The five physics variants and all pickup
rules retain their original tuning. The simulation's legacy `Bees` API remains
an internal compatibility name; game text and graphics use drones.

The renderer centres the court and exposes a shallow foreground through a
render-only layout. This does not move any collider. Architecture stays rigid;
only a subtle independent service-light scan moves across the floor. Pause and
reduced-motion preferences freeze that decorative scan.

The HUD uses small corner score readouts, touch dots, duration arcs and a clipped
service ticket for the hazard queue. Pause, music and fullscreen remain real
HTML buttons with keyboard focus, accessible labels and hover feedback. There
are no bottom keyboard hints or first-serve tutorial captions. Bindings and
instructions remain available in the menu.

Generation uses built-in ImageGen. English source prompts and packaging metadata
are saved in `output/arena-work/asset-prompts.json` and `asset-manifest.json`.
The original concept and earlier beach assets are preserved.

Open `output/arena-work/preview.html` through Vite to inspect the production
renderer with all five hazards, test sprite alpha, and check pause stability.

# Flowing shader arena

Choose **Shaders** under **Graphics** in the start menu to use this variant.
**People** restores the previous indoor arena and textured human players and is
the default for a fresh installation. The choice is stored locally, previews
immediately in the menu, and persists through restarts and return to the menu.

The court uses a procedural WebGL background and continuous glass and chrome
player materials in `src/render/shaderScene.ts`. Visual references are
[Silk Curtain](https://shaders.com/collection/silk-curtain),
[Fluid Chrome](https://shaders.com/collection/fluid-chrome), and the
[Glass component](https://shaders.com/docs/components/glass). The GLSL is an
original implementation adapted to the existing Canvas renderer, rather than
imported preset code.

Each player is rendered in one material pass. The interpolated ragdoll joint
frames define overlapping volumes, which merge through a smooth signed distance
field. Surface normals come from the merged silhouette. Internal joints and
volume boundaries have no individual outlines or material layers. Heads are
plain ovals; hands have no digits. Glass refracts a snapshot of the court below
it, while chrome reflects moving light bands. Both cast faint floor reflections.

The background flows continuously through warped cyan and silver folds. Its
clock freezes on pause, and the system's reduced-motion setting freezes all
decorative shader animation. GPU resolution is capped at 1600 pixels wide.
The same procedural coordinates and animation clock extend across the viewport,
including the side fields on wide screens.
Canvas fallbacks preserve whole-player silhouettes when WebGL is unavailable,
including during context loss; restoration recompiles the shader automatically.

The physics, controls, ball rules, power-ups, drone deliveries, and hazards retain
their existing behavior. Simulation bodies remain articulated internally.

Open `output/shader-work/preview.html` through Vite for the production renderer
and visual checks. The audit verifies connected player silhouettes, continuous
motion, pause stability, reduced motion, context loss/restoration, fallbacks,
small viewports, and giant-player rendering. Build, test, and visual results are
recorded in `output/shader-work/validation-summary.json`.

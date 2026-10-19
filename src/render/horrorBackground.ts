import { HorrorScenery } from './horrorScenery';
import type { WeatherEffects } from './weather';

const SOURCE_FLOOR = 0.84;

/** Quiet pencil plate with code-drawn edge branches, forest skyline and moon. */
export class HorrorBackground {
  private readonly scenery = new HorrorScenery();

  constructor(private readonly plate: HTMLImageElement) {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, floorY: number, seconds: number,
    weather?: WeatherEffects, weatherSeconds = seconds, reducedMotion = false): void {
    const sourceFloor = this.plate.naturalHeight * SOURCE_FLOOR;
    ctx.drawImage(this.plate, 0, 0, this.plate.naturalWidth, sourceFloor, 0, 0, width, floorY);
    ctx.drawImage(this.plate, 0, sourceFloor, this.plate.naturalWidth, this.plate.naturalHeight - sourceFloor,
      0, floorY, width, height - floorY);
    weather?.drawSky(ctx, width, height, floorY, weatherSeconds, reducedMotion);
    this.scenery.draw(ctx, width, height, floorY, seconds);
  }
}

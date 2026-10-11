import fs from 'node:fs';
const file='src/render/renderer.ts';
let code=fs.readFileSync(file,'utf8');
const shadowStart=code.indexOf('/** DropShadowFilter:');
const shadowEnd=code.indexOf('const partDef',shadowStart);
code=code.slice(0,shadowStart)+code.slice(shadowEnd);
code=code.replace('  private readonly shadow: HTMLCanvasElement;\n','').replace("    this.shadow = document.createElement('canvas');\n",'').replace('for (const c of [this.bg, this.shadow])', 'for (const c of [this.bg])');
const start=code.indexOf('  /**\n   * One silhouette pass');
const end=code.indexOf('  private withPose',start);
code=code.slice(0,start)+`  /** Soft sand contact shadows stay on the ground while the doll jumps or flips. */
  private drawShadows(gw: GameWorld, interp: PoseSource, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    this.worldSpace(ctx);
    for (const p of [gw.p1, gw.p2]) {
      const hips = interp.pose(p.ass, alpha);
      const left = interp.pose(p.part('FootLeft'), alpha);
      const right = interp.pose(p.part('FootRight'), alpha);
      const lift = Math.max(0, FLOOR_TOP_PX - Math.max(left.y, right.y) - footHalfHeight * p.sizeScale);
      const radius = (24 + lift * 0.025) * p.sizeScale;
      const opacity = 0.3 / (1 + lift / 100);
      ctx.save();
      ctx.translate(hips.x, FLOOR_TOP_PX + (SOLE_Y - footHalfHeight) * p.sizeScale);
      ctx.scale(1, 0.22);
      const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      fade.addColorStop(0, 'rgba(68,44,25,' + opacity + ')');
      fade.addColorStop(0.4, 'rgba(68,44,25,' + opacity * 0.7 + ')');
      fade.addColorStop(1, 'rgba(68,44,25,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    ctx.restore();
  }

`+code.slice(end);
// Remove the unused old silhouette helper; original paths still clip the textured art.
const shapeStart=code.indexOf('  private partShape(');
if(shapeStart!==-1){const shapeEnd=code.indexOf('\n  /**',shapeStart);code=code.slice(0,shapeStart)+code.slice(shapeEnd);}
code=code.replace(/[ \t]+\n/g,'\n');
fs.writeFileSync(file,code);

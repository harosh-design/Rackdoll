import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const before=fs.readFileSync('output/resort-work/renderer-before.ts','utf8')
 .replaceAll("from '../sim/", "from '/src/sim/")
 .replaceAll("from './", "from '/src/render/");
fs.writeFileSync('output/resort-work/renderer-comparison.ts',before);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1340,height:510},deviceScaleFactor:1});
await page.goto('http://127.0.0.1:5173/');
const result=await page.evaluate(async()=>{
 const [{Renderer:Before},{Renderer:After},{GameWorld},{Interpolator},{closedPoses},{loadResortArt},C]=await Promise.all([
  import('/output/resort-work/renderer-comparison.ts'),import('/src/render/renderer.ts'),
  import('/src/sim/world.ts'),import('/src/render/interp.ts'),import('/src/render/dollPose.ts'),
  import('/src/render/resortArt.ts'),import('/src/sim/constants.ts')
 ]);
 await loadResortArt();
 const gw=new GameWorld({singlePlayer:false,hazards:false,bees:false});
 gw.game.update=()=>{};
 for(let f=0;f<90;f++)gw.step();
 const bodies=[];for(let b=gw.world.getBodyList();b;b=b.getNext())bodies.push(b);
 const interp=new Interpolator();interp.commit(bodies);
 const poses=closedPoses(interp,1,[gw.p1,gw.p2],gw.ball.body);
 const root=document.createElement('main');root.id='comparison';
 root.style.cssText='position:fixed;inset:0;z-index:10000;background:#16242e;display:flex;gap:20px;padding:20px;color:white;font:18px system-ui;align-items:flex-start;';
 document.body.append(root);
 const renderers=[];
 for(const [label,Type] of [['Before replacing the graphics',Before],['After replacing the graphics',After]]){
  const figure=document.createElement('figure');figure.style.margin='0';
  const caption=document.createElement('figcaption');caption.textContent=label;caption.style.marginBottom='12px';
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;canvas.style.cssText='width:640px;height:400px;display:block;';
  figure.append(caption,canvas);root.append(figure);
  const r=new Type(canvas);if(r.ready)await r.ready;
  r.draw(gw,interp,1,{singlePlayer:false,message:null,messageTone:0,controlsHint:null});
  renderers.push(r);
 }
 const dimensions=[];
 for(let n=0;n<renderers.length;n++){
  for(const p of [gw.p1,gw.p2]){
   const canvas=renderers[n].canvas,ctx=canvas.getContext('2d');
   ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#010203';ctx.fillRect(0,0,640,400);
   ctx.setTransform(C.VIEW.scale,0,0,C.VIEW.scale,C.VIEW.offsetX,C.VIEW.offsetY);
   renderers[n].drawDoll(ctx,p,poses,1);
   const {data}=ctx.getImageData(0,0,640,400);
   let x0=640,y0=400,x1=-1,y1=-1,area=0;
   for(let y=0;y<400;y++)for(let x=0;x<640;x++){
    const o=(y*640+x)*4;
    if(Math.abs(data[o]-1)+Math.abs(data[o+1]-2)+Math.abs(data[o+2]-3)>20){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);area++;}
   }
   dimensions.push({version:n===0?'before':'after',player:p.id,width:x1-x0+1,height:y1-y0+1,top:y0,bottom:y1,area});
  }
  renderers[n].draw(gw,interp,1,{singlePlayer:false,message:null,messageTone:0,controlsHint:null});
 }
 return {VIEW:C.VIEW,courtWidthWorld:C.RIGHT_WALL_INNER_PX-C.LEFT_WALL_INNER_PX,courtWidthStage:(C.RIGHT_WALL_INNER_PX-C.LEFT_WALL_INNER_PX)*C.VIEW.scale,netHeightStage:(C.NET_BOTTOM_PX-C.NET_TOP_PX)*C.VIEW.scale,groundStage:C.FLOOR_TOP_PX*C.VIEW.scale+C.VIEW.offsetY,dimensions};
});
await page.locator('#comparison').screenshot({path:'output/resort-work/proportions-comparison.png'});
fs.writeFileSync('output/resort-work/proportions-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
await browser.close();

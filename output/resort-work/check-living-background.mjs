import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
await page.goto('http://127.0.0.1:5173/');await page.waitForFunction(()=>window.__rv);
await page.locator('#play').click();await page.waitForTimeout(700);await page.keyboard.press('p');await page.locator('#pause').evaluate(e=>e.style.visibility='hidden');
await page.locator('#game').screenshot({path:'output/resort-work/living-background-game.png'});
const result=await page.evaluate(async()=>{
 const {loadResortArt,drawResortBackground}=await import('/src/render/resortArt.ts');
 const {resortBackgroundLayout}=await import('/src/render/resortBackground.ts');
 await loadResortArt();
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=400;const ctx=canvas.getContext('2d',{willReadFrequently:true});
 ctx.fillStyle='black';ctx.fillRect(0,0,640,400);drawResortBackground(ctx,640,400,0);const before=ctx.getImageData(0,0,640,400).data;
 drawResortBackground(ctx,640,400,2.1);const after=ctx.getImageData(0,0,640,400).data;
 const fit=resortBackgroundLayout(640,400,1523,1032);
 const diff=(rect)=>{
  let changed=0,total=0,magnitude=0;
  const [x0,y0,x1,y1]=rect;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
   const o=(y*640+x)*4;const d=Math.abs(before[o]-after[o])+Math.abs(before[o+1]-after[o+1])+Math.abs(before[o+2]-after[o+2]);
   if(d>3)changed++;magnitude+=d;total++;
  }
  return {changed,total,meanDifference:magnitude/total};
 };
 const region=p=>[Math.round(fit.x+p[0]*fit.width),Math.round(fit.imageY+p[1]*fit.imageHeight),Math.round(fit.x+p[2]*fit.width),Math.round(fit.imageY+p[3]*fit.imageHeight)];
 const pixelDiff={palms:diff(region([.015,.03,.13,.2])),water:diff(region([.2,.73,.85,.81])),hotel:diff(region([.84,.40,.95,.49])),sand:diff(region([.3,.92,.65,.97]))};
 const start=performance.now();for(let i=0;i<60;i++)drawResortBackground(ctx,640,400,i/30);const renderMsPerFrame=(performance.now()-start)/60;
 const wb=640,wallRight=594.4;
 return {fit,pixelDiff,renderMsPerFrame,imageCompletelyInsideCourt:fit.x>=0&&fit.x+fit.width<=wallRight+1e-6&&fit.imageY>=0&&fit.imageY+fit.imageHeight<=400+1e-6,layouts:[[640,400],[1280,800],[320,200]].map(([w,h])=>resortBackgroundLayout(w,h,1523,1032))};
});
await page.setViewportSize({width:800,height:700});await page.waitForTimeout(150);await page.locator('#game').screenshot({path:'output/resort-work/living-background-small.png'});
await page.emulateMedia({reducedMotion:'reduce'});
const reduced=await page.evaluate(async()=>{
 const {drawResortBackground}=await import('/src/render/resortArt.ts');const c=document.createElement('canvas');c.width=640;c.height=400;const ctx=c.getContext('2d',{willReadFrequently:true});drawResortBackground(ctx,640,400,0);const a=ctx.getImageData(0,0,640,400).data;drawResortBackground(ctx,640,400,3);const b=ctx.getImageData(0,0,640,400).data;let delta=0;for(let i=0;i<a.length;i++)delta+=Math.abs(a[i]-b[i]);return delta===0;
});
const report={...result,reducedMotionStable:reduced,browserErrors:errors};
fs.writeFileSync('output/resort-work/living-background-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!report.imageCompletelyInsideCourt||report.pixelDiff.palms.changed===0||report.pixelDiff.water.changed===0||report.pixelDiff.hotel.changed!==0||report.pixelDiff.sand.changed!==0||!reduced||errors.length)throw new Error('Background validation failed');
await browser.close();

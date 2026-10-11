import { createRequire } from 'node:module';
const require = createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
await page.goto('http://127.0.0.1:5173/');
await page.waitForFunction(()=>window.__rv);
await page.locator('#play').click();
await page.waitForTimeout(800);
await page.keyboard.press('p');
await page.locator('#pause').evaluate(el=>el.style.visibility='hidden');
await page.locator('#game').screenshot({path:'output/resort-work/game-standing.png'});
const poses=await page.evaluate(async()=>{
 const {Renderer}=await import('/src/render/renderer.ts');
 const {GameWorld}=await import('/src/sim/world.ts');
 const {Interpolator}=await import('/src/render/interp.ts');
 const {closedPoses}=await import('/src/render/dollPose.ts');
 const {loadResortArt}=await import('/src/render/resortArt.ts');
 await loadResortArt();
 const states=[];
 const canvases=[];
 const main=document.createElement('main');
 main.id='pose-check';
 main.style.cssText='position:fixed;inset:0;z-index:1000;background:#eef5f5;display:grid;grid-template-columns:repeat(4,320px);grid-template-rows:repeat(2,380px);gap:12px;padding:12px;color:#183637;font:16px system-ui;';
 document.body.append(main);
 for(const name of ['Standing','Crouching','Jump','Flip']){
  const gw=new GameWorld({singlePlayer:false,hazards:false,bees:false});
  gw.game.update=()=>{};
  for(let i=0;i<90;i++)gw.step();
  if(name==='Crouching'){gw.control.press(40);gw.control.press(83);for(let i=0;i<12;i++)gw.step();}
  if(name==='Jump'){gw.control.press(38);gw.control.press(87);gw.step();gw.control.release(38);gw.control.release(87);for(let i=0;i<6;i++)gw.step();}
  if(name==='Flip'){gw.world.destroyJoint(gw.p1.holdingJoint);gw.p1.forgetBallJoint();gw.ball.ballOfPlayer=0;gw.swing(gw.p1,1);gw.swing(gw.p2,1);for(let i=0;i<7;i++)gw.step();}
  const interp=new Interpolator();const bodies=[];for(let b=gw.world.getBodyList();b;b=b.getNext())bodies.push(b);interp.commit(bodies);
  const poses=closedPoses(interp,1,[gw.p1,gw.p2],gw.ball.body);
  for(const p of [gw.p1,gw.p2]){
   const fig=document.createElement('figure');fig.style.margin='0';
   const cap=document.createElement('figcaption');cap.textContent=name+' · Player '+p.id;
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=350;canvas.style.cssText='display:block;width:320px;height:350px';
   fig.append(canvas,cap);main.append(fig);
   const renderer=new Renderer(canvas);await renderer.ready;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#e3eeee';ctx.fillRect(0,0,320,350);
   const t=poses.pose(p.tors,1);const k=3.1;ctx.setTransform(k,0,0,k,160-t.x*k,145-t.y*k);
   renderer.drawDoll(ctx,p,poses,1);
   canvases.push(canvas);
   states.push({name,player:p.id,head:poses.pose(p.head,1)});
  }
 }
 return states;
});
await page.locator('#pose-check').screenshot({path:'output/resort-work/player-poses.png'});
console.log(JSON.stringify({browserErrors:errors,poses:poses.map(p=>({name:p.name,player:p.player,finite:Object.values(p.head).every(Number.isFinite)}))},null,2));
await page.reload();await page.locator('#play').click();await page.waitForTimeout(400);await page.keyboard.press('p');await page.locator('#pause').evaluate(el=>el.style.visibility='hidden');
await page.setViewportSize({width:800,height:700});await page.waitForTimeout(100);await page.locator('#game').screenshot({path:'output/resort-work/game-small.png'});
await browser.close();

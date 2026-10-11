import { createRequire } from 'node:module';
const require=createRequire('/Users/trckwrk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const sharp=require('sharp');
const root='/Users/trckwrk/.codex/generated_images/01a121ab-7ecc-72f3-ada7-8dbad28fb63a/';
const assets={background:'exec-f0c7ada6-72b1-4075-b969-67a9dea23dd9.png','player-1':'exec-d1c134f0-9fb6-439a-b9a1-e40dd19fd081.png','player-2':'exec-ab9b1bc7-52a9-4d12-9d6c-4d5e784120fc.png'};
for(const [name,file] of Object.entries(assets)){
 const result=await sharp(root+file).webp({quality:90}).toFile('public/art/resort/'+name+'.webp');
 console.log(name,result.width+'x'+result.height,result.size+' bytes');
}

import fs from 'node:fs';

import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root=fs.mkdtempSync(path.resolve('output/resort-work/baseline-'));
for(const file of ['src','test','package.json','tsconfig.json','vite.config.ts'])fs.cpSync(file,path.join(root,file),{recursive:true});
fs.copyFileSync('output/resort-work/renderer-before.ts',path.join(root,'src/render/renderer.ts'));
fs.rmSync(path.join(root,'src/render/resortArt.ts'));
fs.symlinkSync(path.resolve('node_modules'),path.join(root,'node_modules'),'dir');
const r=spawnSync(process.execPath,[path.resolve('node_modules/vitest/vitest.mjs'),'run','test/powerUps.test.ts','test/spec.test.ts','--root',root,'--testTimeout','15000','--reporter=json'],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
fs.writeFileSync('output/resort-work/baseline-tests.json',r.stdout);
const j=JSON.parse(r.stdout);
console.log(JSON.stringify({passed:j.numPassedTests,failed:j.numFailedTests,failures:j.testResults.flatMap(s=>s.assertionResults.filter(t=>t.status==='failed').map(t=>t.fullName))},null,2));
fs.rmSync(root,{recursive:true,force:true});

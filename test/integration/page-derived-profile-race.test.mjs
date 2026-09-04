import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {once} from 'node:events';
test('independent processes registering same category have one complete Profile winner',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'page-profile-race-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'profiles'),built=path.join(dir,'built');fs.mkdirSync(built);
 const children=[1,2].map(id=>fork(new URL('../fixtures/profile-register-worker.mjs',import.meta.url),[root,built,String(id)],{stdio:['ignore','pipe','pipe','ipc']}));
 await Promise.all(children.map(c=>once(c,'message')));
 const pending=children.map(c=>once(c,'message'));const exits=children.map(c=>once(c,'exit'));children.forEach(c=>c.send('go'));
 const results=(await Promise.all(pending)).map(x=>x[0]);await Promise.all(exits);
 assert.equal(results.filter(x=>x.profile&&!x.profile_reused).length,1);
 assert.ok(results.every(x=>x.profile?.category_key==='pet-beds'||x.code==='CATEGORY_PROFILE_REGISTRATION_IN_PROGRESS'));
 const files=fs.readdirSync(root).filter(x=>x.endsWith('.json'));assert.equal(files.length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(root,files[0]))).category_key,'pet-beds');
});

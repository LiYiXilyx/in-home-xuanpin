import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createExportController} from '../../src/server/controllers/export-controller.mjs';
import * as exportsModule from '../../src/server/controllers/export-controller.mjs';
import {EventEmitter} from 'node:events';
test('macOS dispatches open with one literal path argument and propagates failure',async()=>{
 const calls=[];let exitCode=0;
 const spawnImpl=(...args)=>{calls.push(args);const child=new EventEmitter();queueMicrotask(()=>child.emit('exit',exitCode));return child;};
 const target='/tmp/中文 export; literal';
 await exportsModule.defaultOpenTarget(target,{platform:'darwin',spawnImpl});
 assert.equal(calls[0][0],'/usr/bin/open');assert.deepEqual(calls[0][1],[target]);assert.notEqual(calls[0][2]?.shell,true);
 exitCode=1;await assert.rejects(exportsModule.defaultOpenTarget(target,{platform:'darwin',spawnImpl}));
});
test('open Catalog folder uses configured export subdirectory, never a supplied path',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'catalog-folder-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'catalog-scoped'));
 const calls=[];const controller=createExportController({config:{export:{outputDir:root}},openTarget:async(...args)=>calls.push(args)});
 await controller.openCatalogFolder({path:'/arbitrary'});assert.deepEqual(calls,[[path.join(root,'catalog-scoped'),{kind:'folder'}]]);
});

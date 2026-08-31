import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperationsServer } from '../../src/server/index.mjs';

test('health endpoint exposes stable Temu operator service identity without starting work',async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'temu-launcher-health-'));
  const config={
    configPath:path.join(directory,'config.json'),
    app:{ databasePath:path.join(directory,'v2.db'),environment:'development' },
    browser:{ profileDir:path.join(directory,'browser-profile'),debugPort:9237,heartbeatTimeoutMs:30_000 },
    catalog:{ siteCountry:'德国',language:'en',currency:'EUR',jobs:[] },
    export:{ outputDir:path.join(directory,'outputs'),imageCacheDir:path.join(directory,'images') }
  };
  const app=await createOperationsServer({ config,runProcess:() => assert.fail('must not start work'),
    openTarget:async () => assert.fail('must not open target'),logError:() => {},
    browserDependencies:{ ready:async () => false } });
  t.after(async () => { await app.close();fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:50 }); });
  const address=await app.listen({ port:0 });

  const response=await fetch(`${address.url}/api/health`);
  const body=await response.json();

  assert.equal(response.status,200);
  assert.deepEqual(body,{ ok:true,service:'temu-operator-dashboard',apiVersion:1,environment:'development',testMode:false });
  assert.equal(Number(app.db.prepare('SELECT COUNT(*) count FROM catalog_campaigns').get().count),0);
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFreshBrowserProfile } from '../../src/browser/profile-manager.mjs';

test('fresh profile preserves old profile and chooses a different available CDP port',async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'temu-profile-'));
  t.after(() => fs.rm(directory,{ recursive:true,force:true }));
  const oldProfile=path.join(directory,'browser-profile-day4');
  await fs.mkdir(oldProfile);
  await fs.writeFile(path.join(oldProfile,'keep.txt'),'keep');
  const fresh=await createFreshBrowserProfile({ browser:{ profileDir:oldProfile,debugPort:9237 } },{
    now:() => new Date('2026-08-21T12:34:56.000Z'),portAvailable:async port => port === 9239
  });
  assert.equal(fresh.debugPort,9239);
  assert.notEqual(fresh.profileDir,oldProfile);
  assert.equal(await fs.readFile(path.join(oldProfile,'keep.txt'),'utf8'),'keep');
  assert.match(fresh.profileName,/^browser-profile-fresh-/);
});

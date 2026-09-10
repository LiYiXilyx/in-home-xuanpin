import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

test('double-click launchers keep Chrome startup separate from the operations console',() => {
  const dashboard=fs.readFileSync(path.join(projectDir,'启动Temu运营台.vbs'),'utf8');
  const chrome=fs.readFileSync(path.join(projectDir,'启动Temu采集Chrome.vbs'),'utf8');
  assert.doesNotMatch(dashboard,/--remote-debugging-port|--user-data-dir|chrome\.exe/i);
  assert.match(dashboard,/\/api\/browser\/connect/);
  assert.match(chrome,/--remote-debugging-port=9222/);
  assert.match(chrome,/--user-data-dir=""C:\\TemuExternalChrome""/);
  assert.doesNotMatch(chrome,/temu\.com|taskkill|Stop-Process|Remove-Item/i);
});

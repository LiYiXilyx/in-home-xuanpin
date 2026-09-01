import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const appDirectory=path.join(projectDirectory,'启动 Temu 运营台.app');
const appExecutable=path.join(appDirectory,'Contents/MacOS/TemuOperatorLauncher');
const plistPath=path.join(appDirectory,'Contents/Info.plist');
const resolverPath=path.join(projectDirectory,'scripts/macos/resolve-temu-operator-runtime.sh');

test('macOS app is executable, fixed-path, and contains no unsafe automation',() => {
  const mode=fs.statSync(appExecutable).mode;
  assert.notEqual(mode & 0o111,0);
  const source=fs.readFileSync(appExecutable,'utf8');
  assert.match(source,/\/Users\/chuangyangdianzi\/Desktop\/选品上架-家里版本\/temu-operator-runtime/);
  assert.doesNotMatch(source,/\/private\/tmp\//);
  assert.match(source,/选品上架-家里版本\/temu选品\/config\.json/);
  assert.doesNotMatch(source,/find .*config|git rev-parse|schema_migrations|migration.*repair|campaign|capture|scroll|navigation|see more|chrome|temu\.com|pkill|kill |xattr|spctl/i);
  const plist=fs.readFileSync(plistPath,'utf8');
  assert.match(plist,/<key>CFBundleExecutable<\/key>\s*<string>TemuOperatorLauncher<\/string>/);
  assert.match(plist,/<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
});

test('runtime resolver returns verified absolute Node and npm paths',t => {
  const fixture=runtimeFixture(t,{ node:true,npm:true });
  const result=spawnSync(resolverPath,[fixture.bin],{ encoding:'utf8' });
  assert.equal(result.status,0,result.stderr ?? result.error?.message ?? 'resolver failed');
  assert.deepEqual(result.stdout.trim().split('\n'),[fixture.nodePath,fixture.npmPath]);
});

test('runtime resolver hard fails clearly when Node or npm is unavailable',t => {
  const withoutNode=runtimeFixture(t,{ node:false,npm:true });
  let result=spawnSync(resolverPath,[withoutNode.bin],{ encoding:'utf8' });
  assert.notEqual(result.status,0);
  assert.match(result.stderr ?? result.error?.message ?? '',/NODE_RUNTIME_NOT_FOUND/);

  const withoutNpm=runtimeFixture(t,{ node:true,npm:false });
  result=spawnSync(resolverPath,[withoutNpm.bin],{ encoding:'utf8' });
  assert.notEqual(result.status,0);
  assert.match(result.stderr ?? result.error?.message ?? '',/NPM_RUNTIME_NOT_FOUND/);
});

test('app hard fails missing fixed worktree or config without invoking core',t => {
  const directory=temporaryDirectory(t,'temu-app-paths-');
  const dialog=path.join(directory,'dialog.txt');
  const marker=path.join(directory,'core.txt');
  const missingWorktree=spawnApp({
    TEMU_OPERATOR_TEST_WORKTREE:path.join(directory,'missing'),TEMU_OPERATOR_TEST_CONFIG:path.join(directory,'missing.json'),
    TEMU_OPERATOR_TEST_DIALOG_FILE:dialog,TEMU_OPERATOR_TEST_CORE_MARKER:marker
  });
  assert.notEqual(missingWorktree.status,0);
  assert.match(fs.readFileSync(dialog,'utf8'),/OPERATOR_WORKTREE_NOT_FOUND|运行目录不存在/);
  assert.equal(fs.existsSync(marker),false);

  const worktree=path.join(directory,'worktree');
  fs.mkdirSync(worktree);
  const missingConfig=spawnApp({
    TEMU_OPERATOR_TEST_WORKTREE:worktree,TEMU_OPERATOR_TEST_CONFIG:path.join(directory,'missing.json'),
    TEMU_OPERATOR_TEST_DIALOG_FILE:dialog,TEMU_OPERATOR_TEST_CORE_MARKER:marker
  });
  assert.notEqual(missingConfig.status,0);
  assert.match(fs.readFileSync(dialog,'utf8'),/OPERATOR_CONFIG_NOT_FOUND|配置文件不存在/);
  assert.equal(fs.existsSync(marker),false);
});

test('Finder wrapper resolves runtime and invokes Node core with explicit fixed scope',t => {
  const fixture=runtimeFixture(t,{ node:true,npm:true,recordNode:true });
  const dialog=path.join(fixture.directory,'dialog.txt');
  const result=spawnApp({
    TEMU_OPERATOR_TEST_RUNTIME_PATH:fixture.bin,
    TEMU_OPERATOR_TEST_DIALOG_FILE:dialog,
    TEMU_OPERATOR_TEST_NODE_MARKER:fixture.nodeMarker
  });
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.existsSync(dialog),false);
  const invocation=fs.readFileSync(fixture.nodeMarker,'utf8');
  assert.match(invocation,/tools\/operator-dashboard-launcher\.mjs/);
  assert.match(invocation,/--worktree\n\/Users\/chuangyangdianzi\/Desktop\/选品上架-家里版本\/temu-operator-runtime/);
  assert.match(invocation,/--config\n\/Users\/chuangyangdianzi\/Desktop\/选品上架-家里版本\/temu选品\/config\.json/);
  assert.match(invocation,/--npm\n/);
  assert.match(invocation,/--port\n37821/);
});

test('Finder wrapper reports the exact missing runtime and does not invoke Node core',t => {
  const withoutNode=runtimeFixture(t,{ node:false,npm:true });
  let dialog=path.join(withoutNode.directory,'dialog.txt');
  let result=spawnApp({ TEMU_OPERATOR_TEST_RUNTIME_PATH:withoutNode.bin,TEMU_OPERATOR_TEST_DIALOG_FILE:dialog });
  assert.notEqual(result.status,0);
  assert.match(fs.readFileSync(dialog,'utf8'),/\nNODE_RUNTIME_NOT_FOUND:/);

  const withoutNpm=runtimeFixture(t,{ node:true,npm:false,recordNode:true });
  dialog=path.join(withoutNpm.directory,'dialog.txt');
  result=spawnApp({ TEMU_OPERATOR_TEST_RUNTIME_PATH:withoutNpm.bin,TEMU_OPERATOR_TEST_DIALOG_FILE:dialog,
    TEMU_OPERATOR_TEST_NODE_MARKER:withoutNpm.nodeMarker });
  assert.notEqual(result.status,0);
  assert.match(fs.readFileSync(dialog,'utf8'),/\nNPM_RUNTIME_NOT_FOUND:/);
  assert.equal(fs.existsSync(withoutNpm.nodeMarker),false);
});

test('Finder wrapper shows a persistent failure when Node core exits nonzero',t => {
  const fixture=runtimeFixture(t,{ node:true,npm:true,recordNode:true,coreExit:7 });
  const dialog=path.join(fixture.directory,'dialog.txt');
  const result=spawnApp({ TEMU_OPERATOR_TEST_RUNTIME_PATH:fixture.bin,TEMU_OPERATOR_TEST_DIALOG_FILE:dialog,
    TEMU_OPERATOR_TEST_NODE_MARKER:fixture.nodeMarker });
  assert.notEqual(result.status,0);
  assert.equal(fs.existsSync(fixture.nodeMarker),true);
  assert.match(fs.readFileSync(dialog,'utf8'),/OPERATOR_DASHBOARD_LAUNCH_FAILED/);
  assert.match(fs.readFileSync(dialog,'utf8'),/operator-dashboard\.log/);
});

function spawnApp(extraEnvironment) {
  return spawnSync(appExecutable,[],{ encoding:'utf8',env:{ ...process.env,TEMU_OPERATOR_LAUNCHER_TEST_MODE:'1',...extraEnvironment } });
}

function runtimeFixture(t,{ node,npm,recordNode=false,coreExit=0 }) {
  const directory=temporaryDirectory(t,'temu-runtime-');
  const bin=path.join(directory,'bin');
  fs.mkdirSync(bin);
  const nodePath=path.join(bin,'node');
  const npmPath=path.join(bin,'npm');
  const nodeMarker=path.join(directory,'node-invocation.txt');
  if (node) writeExecutable(nodePath,recordNode
    ? `#!/bin/zsh\nif [[ "\${1:-}" == "--version" ]]; then print 'v22.0.0'; exit 0; fi\nprintf '%s\\n' "$@" > "\${TEMU_OPERATOR_TEST_NODE_MARKER}"\nexit ${coreExit}\n`
    : '#!/bin/zsh\nprint "v22.0.0"\n');
  if (npm) writeExecutable(npmPath,'#!/bin/zsh\nprint "10.0.0"\n');
  return { directory,bin,nodePath,npmPath,nodeMarker };
}

function temporaryDirectory(t,prefix) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
  t.after(() => fs.rmSync(directory,{ recursive:true,force:true,maxRetries:5,retryDelay:20 }));
  return directory;
}

function writeExecutable(file,source) {
  fs.writeFileSync(file,source);
  fs.chmodSync(file,0o755);
}

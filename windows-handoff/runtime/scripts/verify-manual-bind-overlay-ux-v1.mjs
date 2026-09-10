#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const productionPattern=/(temu选品\/config\.json|temu_research_v2\.db|1688_sourcing\.db)/i;

export function assertSafeEnvironment(env=process.env){
  for(const [name,value] of Object.entries(env))if(/(?:CONFIG|DB|DATABASE)_?PATH/i.test(name)&&productionPattern.test(String(value)))throw new Error(`PRODUCTION_INPUT_FORBIDDEN: ${name}`);
}

export function verifyStaticContracts(root=process.cwd()){
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const overlay=read('browser-extension/catalog-operator-overlay.js');
  const manual=read('browser-extension/catalog-manual-passive-runner.js');
  const auto=read('browser-extension/catalog-auto-runner.js');
  const popup=read('browser-extension/catalog-popup-view.js');
  const viewModel=read('browser-extension/catalog-operator-view-model.js');
  const changed=spawnSync('git',['diff','--name-only','44c9b5b..HEAD'],{cwd:root,encoding:'utf8'}).stdout;
  return Object.freeze({
    SINGLE_PRIMARY_PANEL:/data-role=\"primary-panel\"/.test(overlay)&&/temu-catalog-toast-container/.test(overlay),
    MANUAL_NO_AUTO_RUNNER:/resolveCatalogOverlayMode/.test(manual)&&/LEGACY_AUTO_RUNNER/.test(auto),
    OPEN_ENDED_TARGET_HIDDEN:/不限数量/.test(viewModel)&&!/(?:target|目标)[^\n]*(?:2147483647|0\s*\/\s*0)/i.test(popup),
    YINGDAO_UNCHANGED:!changed.split(/\r?\n/).some(file=>/(?:ui\/modules\/yingdao|yingdao-(?:import|export)|visual-index|random5-workbook)/i.test(file))
  });
}

function main(){
  assertSafeEnvironment();
  const gates=verifyStaticContracts();
  for(const [name,value] of Object.entries(gates))console.log(`${name}=${value?'PASS':'FAIL'}`);
  if(Object.values(gates).includes(false))process.exit(1);
  const files=['catalog-overlay-mode.test.mjs','catalog-operator-view-model.test.mjs','catalog-operator-overlay.test.mjs','catalog-overlay-layout.test.mjs','catalog-popup-view-model.test.mjs','catalog-manual-passive-runner.test.mjs','catalog-auto-runner.test.mjs','manual-bind-overlay-verifier.test.mjs'].map(file=>`test/unit/${file}`);
  const result=spawnSync(process.execPath,['--test',...files],{cwd:process.cwd(),stdio:'inherit',env:{...process.env,NODE_ENV:'test',TEMU_CONFIG_PATH:'',TEMU_DB_PATH:''}});
  process.exit(result.status??1);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

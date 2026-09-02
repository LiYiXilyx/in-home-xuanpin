import {spawnSync} from 'node:child_process';
if(process.env.TEMU_CONFIG_PATH||process.argv.slice(2).some(value=>/config|\.db$/i.test(value)))throw new Error('VERIFIER_PRODUCTION_INPUT_REJECTED');
const files=['test/unit/catalog-claim-stale-policy.test.mjs','test/integration/catalog-claim-inspection.test.mjs','test/integration/catalog-claim-double-inspection.test.mjs','test/integration/catalog-claim-termination.test.mjs','test/integration/catalog-claim-recovery-api.test.mjs','test/unit/manual-bind-browser-ux.test.mjs','test/integration/girls-sets-initial-after-claim-recovery.test.mjs'];
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit',env:{...process.env,TEMU_CONFIG_PATH:''}});process.exitCode=result.status??1;

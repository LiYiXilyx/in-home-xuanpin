import fs from 'node:fs';
import path from 'node:path';
import { getGitInfo } from '../src/modules/sourcing/git-info.mjs';
import { getMachineRole,machineName } from '../src/modules/sourcing/machine-role.mjs';
import { inspectSourcingDatabase,resolveSourcingDbPath } from '../src/modules/sourcing/sourcing-db.mjs';
import { inspectTemuReadonly } from '../src/modules/sourcing/runner-service.mjs';
import { sourcingRuntimePaths } from '../src/modules/sourcing/runtime-paths.mjs';

const config=JSON.parse(fs.readFileSync(path.resolve('config.json'),'utf8')),paths=sourcingRuntimePaths(),role=getMachineRole({required:false});
let temu;try{temu=inspectTemuReadonly(path.resolve(process.env.TEMU_DB_PATH??config.app.databasePath),{expectedActive:2135});}catch(error){temu={ok:false,error:error.message};}
const lockFiles=fs.existsSync(paths.locksRoot)?fs.readdirSync(paths.locksRoot).filter(x=>x.endsWith('.lock')).sort():[];
const profile=process.env.CHROME_PROFILE_DIR?path.resolve(process.env.CHROME_PROFILE_DIR):null;
const report={checked_at:new Date().toISOString(),read_only:true,machine_role:role,machine_name:machineName(),git:getGitInfo(),temu_database:temu,sourcing_database:inspectSourcingDatabase(resolveSourcingDbPath()),chrome:{cdp_endpoint:process.env.CHROME_CDP_ENDPOINT??null,profile_dir:profile,profile_exists:profile?fs.existsSync(profile):null},runtime:{active_locks:lockFiles,lock_count:lockFiles.length}};
console.log(JSON.stringify(report,null,2));if(role==='UNCONFIGURED'||temu.ok===false||temu.active_pool_count!==2135)process.exitCode=1;

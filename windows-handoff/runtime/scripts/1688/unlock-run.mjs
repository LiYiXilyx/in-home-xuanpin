import { MACHINE_ROLES,assertMachineRole } from '../../src/modules/sourcing/machine-role.mjs';
import { sourcingRuntimePaths } from '../../src/modules/sourcing/runtime-paths.mjs';
import { removeRunLock } from '../../src/modules/sourcing/run-lock.mjs';
const index=process.argv.indexOf('--run-id'),runId=index>=0?process.argv[index+1]:null;if(!runId)throw new Error('缺少 --run-id。');assertMachineRole(MACHINE_ROLES.RUNNER,'人工解除 1688 运行锁');console.log(JSON.stringify(removeRunLock(sourcingRuntimePaths({runId}).lockPath,{runId}),null,2));

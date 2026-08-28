import { auditResultPackage } from '../../src/modules/sourcing/result-package.mjs';
const input=process.argv[2];if(!input)throw new Error('用法：node scripts/1688/audit-result.mjs <handoff.zip>');console.log(JSON.stringify(auditResultPackage(input),null,2));

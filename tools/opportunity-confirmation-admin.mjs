import { loadConfig } from '../src/config/load.mjs';
import { openDatabase } from '../src/db/client.mjs';
import { createOpportunityConfirmationService } from '../src/modules/opportunity/opportunity-confirmation-service.mjs';

const {action,options}=args(process.argv.slice(2));const config=await loadConfig(options.config??'config.json');const readOnly=action!=='confirm';const db=openDatabase(config.app.databasePath,{readOnly});
try{
  const service=createOpportunityConfirmationService(db);
  if(action==='list')print(service.listCandidates(required(options.snapshot,'snapshot')));
  else if(action==='confirm')print(service.confirmCandidate({snapshotId:required(options.snapshot,'snapshot'),candidateId:required(options.candidate,'candidate'),goodsId:required(options['goods-id'],'goods-id'),platform:options.platform??'temu',decision:required(options.decision,'decision'),reason:required(options.reason,'reason'),reviewedBy:required(options['reviewed-by'],'reviewed-by'),reviewedAt:options['reviewed-at']}));
  else if(action==='eligibility')print(service.checkEligibility({snapshotId:required(options.snapshot,'snapshot'),candidateId:required(options.candidate,'candidate'),goodsId:required(options['goods-id'],'goods-id'),platform:options.platform??'temu'}));
  else throw new Error('未知操作：list/confirm/eligibility');
}finally{db.close();}

function args(values){const [action,...rest]=values;if(!action)throw new Error('缺少操作：list/confirm/eligibility');const options={};for(let i=0;i<rest.length;i+=2){const key=rest[i],value=rest[i+1];if(!key?.startsWith('--')||value===undefined)throw new Error(`参数错误：${key??''}`);options[key.slice(2)]=value;}return {action,options};}
function required(value,name){const result=String(value??'').trim();if(!result)throw new Error(`缺少 --${name}`);return result;}
function print(value){console.log(JSON.stringify(value,null,2));}

import path from 'node:path';
import { loadConfig } from '../../src/config/load.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createOpportunityAnalysisService } from '../../src/modules/opportunity/opportunity-analysis-service.mjs';
import { enrichOpportunityGrouping } from '../../src/modules/opportunity/opportunity-grouping.mjs';
import { resolveVerifiedTemuImagePath } from '../../src/modules/sourcing/sourcing-1688.mjs';
import { MACHINE_ROLES,assertMachineRole } from '../../src/modules/sourcing/machine-role.mjs';
import { getGitInfo } from '../../src/modules/sourcing/git-info.mjs';
import { createInputPackage } from '../../src/modules/sourcing/input-package.mjs';
import { sourcingRuntimePaths } from '../../src/modules/sourcing/runtime-paths.mjs';

function parse(argv){const out={goodsIds:[]};for(let i=2;i<argv.length;i++){if(argv[i]==='--run-id')out.runId=argv[++i];else if(argv[i]==='--goods-id')out.goodsIds.push(...String(argv[++i]).split(',').filter(Boolean));else throw new Error(`未知参数：${argv[i]}`);}if(!out.runId||!out.goodsIds.length)throw new Error('用法：--run-id <id> --goods-id <id1,id2,...>');if(out.goodsIds.length>20)throw new Error('单次输入最多 20 条。');return out;}
assertMachineRole(MACHINE_ROLES.DEVELOPMENT,'生成 1688 输入包');const args=parse(process.argv),config=await loadConfig('config.json'),git=getGitInfo();if(!git.available)throw new Error('无法读取 Git 提交。');if(!git.statusClean)throw new Error('生成正式输入包前必须提交或清理工作区，确保 Git 可复现。');
const db=openDatabase(config.app.databasePath,{readOnly:true});let active,items;try{active=db.prepare("SELECT id,product_count FROM catalog_pool_versions WHERE status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get();if(Number(active?.product_count)!==2135)throw new Error(`Active Pool 必须为 2135，实际 ${active?.product_count??'MISSING'}`);items=createOpportunityAnalysisService(db).getResult().items;}finally{db.close();}
const byId=new Map(items.map(item=>{const value=enrichOpportunityGrouping(item);return [String(value.goodsId),value];}));const goods=args.goodsIds.map(id=>{const item=byId.get(String(id));if(!item)throw new Error(`goods_id 不在 Active Pool：${id}`);const image=resolveVerifiedTemuImagePath(id,{projectRoot:process.cwd()});if(!image)throw new Error(`缺少已验证本地主图：${id}`);return {temu_goods_id:String(id),temu_title:item.title,temu_image_path:image,level1:item.level1Scene,level2:item.productType,level3:item.level3Segment,similar_cluster:item.similarProductCluster};});
const paths=sourcingRuntimePaths({runId:args.runId});console.log(JSON.stringify(createInputPackage({runId:args.runId,gitCommit:git.commit,goods,inputDir:paths.inputDir}),null,2));

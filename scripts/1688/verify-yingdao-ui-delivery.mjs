import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {catalogPanelMarkup} from '../../ui/modules/catalog/panel.js';
import {yingdaoPanelMarkup} from '../../ui/modules/yingdao/panel.js';

export function verifyYingdaoUiDelivery({projectRoot=process.cwd(),reviewSafety=null}={}){
  const read=file=>fs.readFileSync(path.join(projectRoot,file),'utf8'),html=read('ui/index.html'),app=read('ui/app.js'),router=read('src/server/router.mjs');
  const mountedHtml=`${html}\n${catalogPanelMarkup}\n${yingdaoPanelMarkup}`,ids=[...mountedHtml.matchAll(/\bid="([^"]+)"/g)].map(row=>row[1]),counts=count(ids);
  const duplicateDomIds=[...counts.values()].filter(value=>value>1).reduce((sum,value)=>sum+value-1,0),yingdaoIds=[...yingdaoPanelMarkup.matchAll(/\bid="([^"]+)"/g)].map(row=>row[1]);
  const methodPaths=[...router.matchAll(/request\.method\s*===?\s*['"](GET|POST|PUT|PATCH|DELETE)['"][^\n]{0,180}url\.pathname\s*===?\s*['"]([^'"]+)['"]/g)].map(row=>`${row[1]}:${row[2]}`),routeCounts=count(methodPaths);
  const duplicateRoutes=[...routeCounts.values()].filter(value=>value>1).reduce((sum,value)=>sum+value-1,0);
  const oldYingdao=['sourcingModel','refreshSourcing','renderSourcing','saveSourcingPaths'].filter(value=>app.includes(value)).length;
  const catalogMounts=(app.match(/mountCatalogPanel\(/g)??[]).length,yingdaoMounts=(app.match(/mountYingdaoPanel\(/g)??[]).length;
  const yingdaoSources=['ui/modules/yingdao/api.js','ui/modules/yingdao/panel.js','ui/modules/yingdao/state.js','ui/modules/yingdao/model.js'].map(read).join('\n');
  const catalogMutation=/\/api\/catalog\/(?:operator-campaign|operator\/initial-campaign|batches)|\/api\/catalog-rpa\//.test(yingdaoSources);
  const result={
    duplicate_dom_ids:duplicateDomIds,yingdao_dom_ids_outside_namespace:yingdaoIds.filter(id=>!id.startsWith('yingdao-')).length,
    duplicate_routes:duplicateRoutes,duplicate_polling_owners:oldYingdao===0&&catalogMounts===1&&yingdaoMounts===1?0:1,
    legacy_duplicate_yingdao_implementation:oldYingdao,legacy_duplicate_catalog_implementation:catalogMounts===1?0:1,
    catalog_core_writes_from_yingdao:catalogMutation?1:0,yingdao_writes_to_catalog_core:catalogMutation?1:0,
    existing_sourcing_routes_preserved:router.includes('/api/sourcing/settings')&&router.includes('/api/sourcing/review/bootstrap'),
    review_v1_goods:reviewSafety?.goods??null,review_v1_candidates:reviewSafety?.candidates??null,
    review_v1_image_mapping_errors:reviewSafety?.image_mapping_error??null,
  };
  const reviewPass=!reviewSafety||(reviewSafety.pass===true&&result.review_v1_goods===50&&result.review_v1_candidates===250&&result.review_v1_image_mapping_errors===0);
  result.pass=result.duplicate_dom_ids===0&&result.yingdao_dom_ids_outside_namespace===0&&result.duplicate_routes===0&&result.duplicate_polling_owners===0&&result.legacy_duplicate_yingdao_implementation===0&&result.legacy_duplicate_catalog_implementation===0&&result.catalog_core_writes_from_yingdao===0&&result.existing_sourcing_routes_preserved&&reviewPass;
  return result;
}

function count(values){const result=new Map();for(const value of values)result.set(value,(result.get(value)??0)+1);return result;}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const report=verifyYingdaoUiDelivery();console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;}

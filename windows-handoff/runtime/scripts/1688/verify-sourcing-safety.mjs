import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../../src/config/load.mjs';
import {openDatabase} from '../../src/db/client.mjs';
import {createSourcingReviewRepository} from '../../src/db/repositories/sourcing-review-repository.mjs';
import {createTemuSourcingContextRepository,openTemuContextDatabase} from '../../src/db/repositories/temu-sourcing-context-repository.mjs';
import {createSourcingReviewImageResolver} from '../../src/modules/sourcing/sourcing-review-images.mjs';

const PROTECTED=['products','catalog_memberships','product_classifications','fine_classification_attempts','product_snapshots','reviews','catalog_capture_batches','catalog_campaign_product_observations','catalog_product_source_observations','catalog_pool_versions','catalog_pool_version_items'];
export async function verifySourcingSafety({configPath='config.json',databasePath=null,sourcingDatabasePath=null,sourceDir=null,workbookPath=null,outputPath=null,label='check',fingerprintWorkbook=null}={}){
  if(!databasePath){const config=await loadConfig(configPath);databasePath=config.app.databasePath;}
  const db=openDatabase(databasePath,{readOnly:true});let temu;
  try{const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));const active=tables.has('catalog_pool_versions')?db.prepare("SELECT * FROM catalog_pool_versions WHERE category_key=? AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get('motorcycle-accessories'):null;const activeItems=active&&tables.has('catalog_pool_version_items')?db.prepare('SELECT * FROM catalog_pool_version_items WHERE pool_version_id=?').all(active.id):[];const counts=Object.fromEntries(PROTECTED.map(table=>[table,tables.has(table)?Number(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n):0]));const digests=Object.fromEntries(PROTECTED.map(table=>[table,tables.has(table)?tableDigest(db,table):null]));const activePool={id:active?.id??null,count:Number(active?.product_count??0),version_sha256:active?rowsDigest([active]):null,item_count:activeItems.length,items_sha256:active?rowsDigest(activeItems):null};const logical=crypto.createHash('sha256').update(JSON.stringify({activePool,counts,digests})).digest('hex');temu={databasePath:path.resolve(databasePath),integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,foreign_key_check:db.prepare('PRAGMA foreign_key_check').all().length,logical_sha256:logical,protected_table_sha256:digests,activePool,protectedTableCounts:counts};}finally{db.close();}
  const rawFiles=sourceDir?await hashRawDirectory(sourceDir):[];let sourcing={exists:false,integrity:null,foreign_key_check:null};if(sourcingDatabasePath){const sdb=openDatabase(sourcingDatabasePath,{readOnly:true});try{sourcing={exists:true,databasePath:path.resolve(sourcingDatabasePath),integrity:sdb.prepare('PRAGMA integrity_check').get().integrity_check,foreign_key_check:sdb.prepare('PRAGMA foreign_key_check').all().length};}finally{sdb.close();}}
  let sheet05Fingerprint=null;if(workbookPath){const fn=fingerprintWorkbook??(await import('../../src/modules/sourcing/random5-workbook.mjs')).fingerprintSheet05;sheet05Fingerprint=await fn(workbookPath);}
  const evidenceComplete=Boolean(sourceDir&&rawFiles.length&&sourcing.exists&&workbookPath&&sheet05Fingerprint&&temu.activePool.id);const report={label,checkedAt:new Date().toISOString(),temu,activePool:temu.activePool,protectedTableCounts:temu.protectedTableCounts,integrity:temu.integrity,rawFiles,sourcing,sheet05Fingerprint,evidenceComplete};report.pass=evidenceComplete&&temu.integrity==='ok'&&temu.foreign_key_check===0&&sourcing.integrity==='ok'&&sourcing.foreign_key_check===0;if(outputPath){await fs.mkdir(path.dirname(path.resolve(outputPath)),{recursive:true});await fs.writeFile(outputPath,`${JSON.stringify(report,null,2)}\n`);}return report;
}
export function compareSafetyReports(before,after){const checks={before_complete:before.pass===true,after_complete:after.pass===true,temu_integrity:before.temu.integrity==='ok'&&after.temu.integrity==='ok',temu_fk:before.temu.foreign_key_check===0&&after.temu.foreign_key_check===0,temu_logical:before.temu.logical_sha256===after.temu.logical_sha256,active_pool:JSON.stringify(before.activePool)===JSON.stringify(after.activePool),raw_hashes:JSON.stringify(before.rawFiles)===JSON.stringify(after.rawFiles),sheet05:JSON.stringify(before.sheet05Fingerprint)===JSON.stringify(after.sheet05Fingerprint),sourcing_integrity:before.sourcing.integrity==='ok'&&after.sourcing.integrity==='ok',sourcing_fk:before.sourcing.foreign_key_check===0&&after.sourcing.foreign_key_check===0};return{checks,pass:Object.values(checks).every(Boolean)};}

export async function verifyReviewConsoleSafety({
  sourcingDatabasePath,temuDatabasePath,runId,projectRoot=process.cwd(),expectedGoods=50,expectedCandidates=250,
}={}) {
  if(!sourcingDatabasePath||!temuDatabasePath||!runId) throw new TypeError('sourcingDatabasePath, temuDatabasePath and runId are required');
  const sourcingDb=openDatabase(sourcingDatabasePath,{readOnly:true});
  const temuDb=openTemuContextDatabase(temuDatabasePath);
  try {
    const sourcingRepository=createSourcingReviewRepository(sourcingDb);
    const temuRepository=createTemuSourcingContextRepository(temuDb,{projectRoot});
    const imageResolver=createSourcingReviewImageResolver({projectRoot});
    const goodsRows=sourcingRepository.listReviewGoods(runId);
    const details=goodsRows.map(row=>sourcingRepository.getReviewGoods(runId,String(row.temu_goods_id)));
    const candidates=details.flatMap(detail=>detail.candidates);
    const statusCounts={PENDING:0,CONFIRMED:0,NO_SELECTION:0};
    const contextCounts={matched:0,missing:0,temuImages:0};
    const supplierCounts={local:0,urlFallback:0,mappingError:0};
    let selectedMax=0;
    for(const detail of details) {
      statusCounts[detail.review_status]=(statusCounts[detail.review_status]??0)+1;
      selectedMax=Math.max(selectedMax,detail.candidates.filter(row=>Number(row.selected_candidate)===1).length);
      const context=temuRepository.getTemuContext(String(detail.temu_goods_id));
      if(context.temu_context_status==='AVAILABLE') contextCounts.matched+=1; else contextCounts.missing+=1;
      if((await imageResolver.resolveTemuImage(context)).kind==='LOCAL') contextCounts.temuImages+=1;
      for(const candidate of detail.candidates) {
        const resolved=await imageResolver.resolveSupplierImage({run:detail.run,candidate});
        if(resolved.kind==='LOCAL') supplierCounts.local+=1;
        if(resolved.kind==='URL_FALLBACK') supplierCounts.urlFallback+=1;
        if(resolved.kind==='PLACEHOLDER'||resolved.display_anomaly) supplierCounts.mappingError+=1;
      }
    }
    const identityRows=candidates.map(row=>[
      String(row.temu_goods_id),String(row.supplier_product_id),Number(row.original_rank),
      Number(row.candidate_rank),String(row.sample_method),
    ]);
    const identitySha256=crypto.createHash('sha256').update(JSON.stringify(identityRows),'utf8').digest('hex');
    const temuLogical=temuLogicalSnapshot(temuDb);
    const sourcingIntegrity=sourcingDb.prepare('PRAGMA integrity_check').get().integrity_check;
    const sourcingFk=sourcingDb.prepare('PRAGMA foreign_key_check').all().length;
    const result={
      run_id:String(runId),goods:goodsRows.length,candidates:candidates.length,
      temu_context_matched:contextCounts.matched,temu_context_missing:contextCounts.missing,
      temu_images_ok:contextCounts.temuImages,supplier_images_local:supplierCounts.local,
      supplier_images_url_fallback:supplierCounts.urlFallback,image_mapping_error:supplierCounts.mappingError,
      awaiting_review:statusCounts.PENDING,confirmed:statusCounts.CONFIRMED,no_selection:statusCounts.NO_SELECTION,
      selected_candidate_max_per_goods:selectedMax,temu_db_read_only:true,active_pool:temuLogical.activePool.count,
      temu_logical_sha256:temuLogical.logicalSha256,identity_sha256:identitySha256,
      source_manifest_sha256:details[0]?.run?.source_manifest_sha256??null,
      sourcing_integrity:sourcingIntegrity,sourcing_foreign_key_violations:sourcingFk,
    };
    result.pass=result.goods===expectedGoods&&result.candidates===expectedCandidates&&
      result.temu_context_matched+result.temu_context_missing===result.goods&&
      result.awaiting_review+result.confirmed+result.no_selection===result.goods&&
      result.selected_candidate_max_per_goods<=1&&result.image_mapping_error===0&&
      result.temu_db_read_only&&result.active_pool===2135&&sourcingIntegrity==='ok'&&sourcingFk===0;
    return result;
  } finally { sourcingDb.close();temuDb.close(); }
}

export function compareReviewConsoleSafety(before,after) {
  const checks={
    random5_identity:before.identity_sha256===after.identity_sha256,
    source_manifest:before.source_manifest_sha256===after.source_manifest_sha256,
    temu_logical:before.temu_logical_sha256===after.temu_logical_sha256,
    active_pool:before.active_pool===after.active_pool,
    goods:before.goods===after.goods,
    candidates:before.candidates===after.candidates,
  };
  return {checks,pass:Object.values(checks).every(Boolean)};
}

function temuLogicalSnapshot(db) {
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  const active=tables.has('catalog_pool_versions')?db.prepare("SELECT * FROM catalog_pool_versions WHERE category_key='motorcycle-accessories' AND status='active' ORDER BY activated_at DESC,id DESC LIMIT 1").get():null;
  const activeItems=active&&tables.has('catalog_pool_version_items')?db.prepare('SELECT * FROM catalog_pool_version_items WHERE pool_version_id=?').all(active.id):[];
  const digests=Object.fromEntries(PROTECTED.map(table=>[table,tables.has(table)?tableDigest(db,table):null]));
  const activePool={id:active?.id??null,count:Number(active?.product_count??0),versionSha256:active?rowsDigest([active]):null,itemsSha256:active?rowsDigest(activeItems):null};
  return {activePool,logicalSha256:crypto.createHash('sha256').update(JSON.stringify({activePool,digests})).digest('hex')};
}
async function hashRawDirectory(sourceDir){const entries=await fs.readdir(sourceDir,{withFileTypes:true});const rows=[];for(const entry of entries.filter(x=>x.isFile()&&/\.xlsx$/i.test(x.name)).sort((a,b)=>Buffer.compare(Buffer.from(a.name.normalize('NFC')),Buffer.from(b.name.normalize('NFC'))))){const bytes=await fs.readFile(path.join(sourceDir,entry.name));rows.push({filename:entry.name.normalize('NFC'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}return rows;}
function tableDigest(db,table){return rowsDigest(db.prepare(`SELECT * FROM ${table}`).all());}
function rowsDigest(rows){const canonical=rows.map(row=>JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])))).sort();return crypto.createHash('sha256').update(canonical.join('\n'),'utf8').digest('hex');}
export function parseSafetyArgs(argv){const label=argv[2]??'check',out={label,outputPath:`outputs/1688-sourcing-v1/safety-${label}.json`,configPath:process.env.TEMU_CONFIG_PATH??'config.json',sourceDir:process.env.SOURCING_SOURCE_DIR??null,sourcingDatabasePath:process.env.SOURCING_DB_PATH??null,workbookPath:process.env.SOURCING_WORKBOOK_PATH??null};for(let i=3;i<argv.length;i++){const key=argv[i],value=argv[++i];if(!value)throw new Error(`missing value for ${key}`);const field={'--output':'outputPath','--config':'configPath','--source-dir':'sourceDir','--sourcing-database':'sourcingDatabasePath','--workbook':'workbookPath'}[key];if(!field)throw new Error(`unknown argument: ${key}`);out[field]=value;}for(const field of ['sourceDir','sourcingDatabasePath','workbookPath'])if(!out[field])throw new Error(`${field} is required`);return out;}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){verifySourcingSafety(parseSafetyArgs(process.argv)).then(x=>{if(x.activePool.count!==2135||!x.pass)throw new Error(`安全检查失败：Active Pool=${x.activePool.count}, integrity=${x.integrity}`);console.log(JSON.stringify(x,null,2));}).catch(e=>{console.error(e.stack??e);process.exitCode=1;});}

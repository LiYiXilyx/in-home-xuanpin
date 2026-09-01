import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { catalogPanelMarkup } from '../ui/modules/catalog/panel.js';
import { createCatalogState } from '../ui/modules/catalog/state.js';
import { createCatalogPoolReadRepository } from '../src/db/repositories/catalog-pool-read-repository.mjs';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function runCatalogUiDeliveryVerification({env=process.env,argv=process.argv.slice(2)}={}){
  rejectExternalInputs(env,argv);
  const panel=read('ui/modules/catalog/panel.js'),api=read('ui/modules/catalog/api.js'),app=read('ui/app.js'),
    html=read('ui/index.html'),reader=read('src/db/repositories/catalog-pool-read-repository.mjs'),markup=catalogPanelMarkup();
  const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]),allowedClasses=new Set(['panel','primary','eyebrow']),
    classes=[...markup.matchAll(/\bclass="([^"]+)"/g)].flatMap(match=>match[1].split(/\s+/)),
    catalogUrls=[...api.matchAll(/['"`](\/api\/[^'"`$]*)/g)].map(match=>match[1]);
  verify(ids.length>10&&ids.every(id=>id.startsWith('catalog-'))&&classes.every(name=>name.startsWith('catalog-')||allowedClasses.has(name)),
    'CATALOG_UI_NAMESPACE_NOT_ISOLATED');
  verify(catalogUrls.length>=6&&catalogUrls.every(url=>url.startsWith('/api/catalog/')),'CATALOG_API_NAMESPACE_NOT_ISOLATED');
  verify(Object.keys(createCatalogState()).every(key=>!['yingdaoState','currentRun','random5State'].includes(key)),'CATALOG_STATE_NOT_ISOLATED');
  verify(panel.includes('catalogPollingTimer')&&panel.includes('scheduler.setInterval')&&!app.includes('refreshOperatorCurrent'),'CATALOG_POLLING_NOT_ISOLATED');
  verify(/id="catalog-module-root"[^>]*><\/section>/.test(html)&&/id="yingdao-module-root"[^>]*><\/section>/.test(html),'SHARED_ROOT_MISSING');
  verify(!/yingdao-module-root|yingdaoState|random5State|currentRun|document\.body\.innerHTML/.test(panel),'CATALOG_DEPENDS_ON_YINGDAO');
  verify(!/addEventListener\(['"]catalog:/.test(panel),'CATALOG_EVENT_CONSUMPTION_FORBIDDEN');
  for(const symbol of ['operatorProfiles','selectedOperatorProfile','currentOperatorCampaign','refreshOperatorCurrent','renderOperatorCurrent',
    'createOperatorCampaign','runInitialQa','activateInitial'])verify(!new RegExp(`\\b${symbol}\\b`).test(app),'APP_JS_CATALOG_DUPLICATE');
  verify(!/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(reader),'CATALOG_POOL_READER_WRITES_SQL');
  verify(!/status\s*=\s*['"]active['"]|ORDER BY[^;]*(?:activated_at|created_at)[^;]*LIMIT\s+1/is.test(reader),'CATALOG_POOL_READER_GLOBAL_FALLBACK');
  const poolRead=verifyTemporaryPoolRead();
  return{productionDatabaseWrites:0,realTemuCaptureStarted:false,yingdaoBusinessImplemented:false,gates:{
    CATALOG_UI_NAMESPACE_ISOLATED:'YES',CATALOG_API_NAMESPACE_ISOLATED:'YES',CATALOG_STATE_ISOLATED:'YES',
    CATALOG_POLLING_ISOLATED:'YES',YINGDAO_UI_ROOT_PRESERVED:'YES',YINGDAO_ROOT_REQUIRED_BY_CATALOG:'NO',
    CATALOG_EVENTS_REQUIRED_FOR_YINGDAO_CORRECTNESS:'NO',APP_JS_CATALOG_DUPLICATE_IMPLEMENTATION:'NO',
    CATALOG_POOL_READ_DB_WRITES:poolRead.writes,CATALOG_POOL_READ_GLOBAL_FALLBACK:'NO'
  }};
}

function verifyTemporaryPoolRead(){const db=new DatabaseSync(':memory:');
  try{db.exec(`CREATE TABLE catalog_pool_versions(id TEXT PRIMARY KEY,category_key TEXT,category_profile_version TEXT);
    CREATE TABLE catalog_staging_products(id INTEGER PRIMARY KEY,latest_title TEXT,image_url TEXT);
    CREATE TABLE catalog_pool_version_items(pool_version_id TEXT,staging_product_id INTEGER,platform TEXT,goods_id TEXT,category_key TEXT);
    CREATE TABLE products(id INTEGER PRIMARY KEY,platform TEXT,external_product_id TEXT);
    CREATE TABLE product_images(product_id INTEGER,source_url TEXT,download_status TEXT,local_path TEXT);
    INSERT INTO catalog_pool_versions VALUES('pool-b','category-b','category-b-v1');
    INSERT INTO catalog_staging_products VALUES(1,'Title 2','https://img.test/2.jpg'),(2,'Title 1','https://img.test/1.jpg');
    INSERT INTO catalog_pool_version_items VALUES('pool-b',1,'temu','2','category-b'),('pool-b',2,'temu','1','category-b');`);
    const before=fingerprint(db),result=createCatalogPoolReadRepository(db).listPoolProducts({poolVersionId:'pool-b',categoryKey:'category-b',
      categoryProfileVersion:'category-b-v1'}),after=fingerprint(db);
    verify(JSON.stringify(before)===JSON.stringify(after),'CATALOG_POOL_READ_MUTATED_DB');verify(result.products.map(row=>row.goods_id).join(',')==='1,2',
      'CATALOG_POOL_READ_ORDER_INVALID');return{writes:0};
  }finally{db.close();}}

function fingerprint(db){const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(({name})=>[name,db.prepare(`SELECT * FROM "${name}"`).all().map(row=>JSON.stringify(row,Object.keys(row).sort())).sort()]));}
function rejectExternalInputs(env,argv){if(env?.TEMU_CONFIG_PATH||argv.some(value=>/^--(?:config|database)(?:=|$)/.test(String(value)))){
  const error=new Error('Catalog UI verifier只允许内存/临时验证，拒绝外部config或database。');error.code='CATALOG_UI_VERIFIER_PRODUCTION_INPUT_FORBIDDEN';throw error;}}
function read(relative){return fs.readFileSync(path.join(projectDir,relative),'utf8');}
function verify(condition,code){if(condition)return;const error=new Error(code);error.code=code;throw error;}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  runCatalogUiDeliveryVerification().then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error?.stack??error);process.exitCode=1;});
}

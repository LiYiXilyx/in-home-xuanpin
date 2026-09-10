import assert from 'node:assert/strict';import test from 'node:test';
import {buildCatalogScopedWorkbookModel} from '../../src/modules/catalog-scale/catalog-scoped-export-service.mjs';

test('preview workbook model is explicit, deterministic and honest about images/classification',()=>{
  const model=buildCatalogScopedWorkbookModel({scope:{export_type:'PREVIEW',activation_status:'NOT_ACTIVE_POOL',campaign_id:'c1',candidate_revision:2,
    category_key:'pet-supplies',category_profile_version:'pet-v1',pool_version_id:null},products:[
    {platform:'temu',goods_id:'20',title:'B',image_url:'https://img/20.jpg',image_status:'MISS'},
    {platform:'temu',goods_id:'3',title:'A',image_url:null,image_status:'MISS'}]});
  assert.deepEqual(model.sheetNames,['01_商品明细','02_数据质量','03_采集任务','04_类目配置','05_待分类说明']);
  assert.deepEqual(model.products.map(row=>row.goods_id),['20','3']);
  assert.equal(model.metadata.export_type,'PREVIEW');assert.equal(model.metadata.activation_status,'NOT_ACTIVE_POOL');
  assert.equal(model.products.every(row=>row.image_status==='MISS'),true);assert.equal(model.classification.status,'BLOCKED_UNCONFIGURED');
});

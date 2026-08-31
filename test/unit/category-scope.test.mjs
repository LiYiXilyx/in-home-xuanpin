import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolveMembershipCandidates } from '../../src/modules/catalog-scale/category-scope.mjs';

const motorcycle=profile('motorcycle-accessories',[scope('德国','Motorcycles & Powersports Accessories')]);
const categoryB=profile('category-b',[]);

test('legacy Motorcycle membership resolves with explicit pool identity and exact full scope',() => {
  const db=fixture();
  const result=resolveMembershipCandidates(db,{profile:motorcycle,poolVersionId:'pool-a',productId:1,activeOnly:true});
  assert.deepEqual(result.membershipIds,[11]);assert.equal(result.uniquelyResolved,1);assert.equal(result.unresolved,0);assert.equal(result.ambiguous,0);
});

test('legacy membership with no full-scope match hard fails',() => {
  const db=fixture();db.prepare("UPDATE catalog_memberships SET subcategory='Unknown' WHERE id=11").run();
  assert.throws(() => resolveMembershipCandidates(db,{profile:motorcycle,poolVersionId:'pool-a',productId:1}),error=>error.code==='CATEGORY_SCOPE_UNRESOLVED');
});

test('multiple legacy membership candidates hard fail as ambiguous',() => {
  const db=fixture();db.prepare(`INSERT INTO catalog_memberships VALUES(12,1,NULL,'德国','en','EUR','Automotive','Motorcycles & Powersports Accessories','Top Sales',1)`).run();
  assert.throws(() => resolveMembershipCandidates(db,{profile:motorcycle,poolVersionId:'pool-a',productId:1}),error=>error.code==='CATEGORY_SCOPE_AMBIGUOUS');
});

test('new category cannot use legacy Motorcycle fallback',() => {
  const db=fixture();
  assert.throws(() => resolveMembershipCandidates(db,{profile:categoryB,poolVersionId:'pool-b',productId:1}),error=>error.code==='CATEGORY_SCOPE_UNRESOLVED');
});

function fixture(){const db=new DatabaseSync(':memory:');db.exec(`
  CREATE TABLE products(id INTEGER PRIMARY KEY,platform TEXT,external_product_id TEXT);
  CREATE TABLE catalog_memberships(id INTEGER PRIMARY KEY,product_id INTEGER,category_key TEXT,site_country TEXT,language TEXT,currency TEXT,primary_category TEXT,subcategory TEXT,sort_order TEXT,active INTEGER);
  CREATE TABLE catalog_pool_versions(id TEXT PRIMARY KEY,category_key TEXT,category_profile_version TEXT);
  CREATE TABLE catalog_pool_version_items(pool_version_id TEXT,platform TEXT,goods_id TEXT);
  INSERT INTO products VALUES(1,'temu','SAME001');
  INSERT INTO catalog_memberships VALUES(11,1,NULL,'德国','en','EUR','Automotive','Motorcycles & Powersports Accessories','Top Sales',1);
  INSERT INTO catalog_pool_versions VALUES('pool-a','motorcycle-accessories','motorcycle-accessories-v1'),('pool-b','category-b','category-b-v1');
  INSERT INTO catalog_pool_version_items VALUES('pool-a','temu','SAME001'),('pool-b','temu','SAME001');`);return db;}
function scope(siteCountry,subcategory){return {site_country:siteCountry,language:'en',currency:'EUR',primary_category:'Automotive',subcategory,sort_order:'Top Sales'};}
function profile(categoryKey,legacy){return {category_key:categoryKey,category_profile_version:`${categoryKey}-v1`,membership_scope:scope('DE',categoryKey),legacy_membership_scopes:legacy};}

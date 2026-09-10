import assert from 'node:assert/strict';
import test from 'node:test';

import {mountCatalogPanel,catalogPanelMarkup} from '../../ui/modules/catalog/panel.js';
import {catalogDomFixture} from '../fixtures/catalog-panel-dom-fixture.mjs';

const profile={category_key:'pet-supplies',category_profile_version:'operator-pet-supplies-v1-abc123def456',
  display_name:'Pet Supplies',listing_url:'https://www.temu.com/de-en/pet-supplies.html',
  capabilities:{raw_capture_available:true,initial_pool_available:true,classification_available:false,opportunity_available:false}};

test('new category markup is Catalog namespaced and validation renders generated read-only contract',async()=>{
  const markup=catalogPanelMarkup();
  for(const id of ['catalog-add-category','catalog-onboarding-form','catalog-onboarding-display-name','catalog-onboarding-page-category',
    'catalog-onboarding-aliases','catalog-onboarding-parent','catalog-onboarding-breadcrumbs','catalog-onboarding-listing-url',
    'catalog-onboarding-validate','catalog-onboarding-category-key','catalog-onboarding-profile-version','catalog-onboarding-capabilities',
    'catalog-onboarding-open-listing'])assert.match(markup,new RegExp(`id="${id}"`));
  const fixture=catalogDomFixture(),calls=[],opened=[],api=fakeApi({calls});
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,openWindow:url=>opened.push(url)});await panel.refresh();
  await fixture.byId('catalog-add-category').emit('click');fill(fixture);await fixture.byId('catalog-onboarding-form').emit('submit');
  assert.equal(calls.length,1);assert.equal(calls[0].site_country,undefined);assert.equal(calls[0].display_name,'Pet Supplies');
  assert.equal(fixture.byId('catalog-onboarding-category-key').textContent,'pet-supplies');
  assert.match(fixture.byId('catalog-onboarding-capabilities').textContent,/Classification：BLOCKED/);
  assert.deepEqual(opened,[],'validation must not navigate');
  await fixture.byId('catalog-onboarding-open-listing').emit('click');assert.deepEqual(opened,[profile.listing_url]);
  assert.equal(fixture.yingdao.marker,'untouched');panel.destroy();assert.equal(fixture.yingdao.controls.disabled,false);
});

test('onboarding validation error remains in Catalog and never opens a page',async()=>{
  const fixture=catalogDomFixture(),opened=[],api=fakeApi({error:Object.assign(new Error('bad alias'),{code:'CATEGORY_PROFILE_LATIN_ALIAS_REQUIRED'})});
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,openWindow:url=>opened.push(url)});await panel.refresh();
  await fixture.byId('catalog-add-category').emit('click');fill(fixture);await fixture.byId('catalog-onboarding-form').emit('submit');
  assert.match(fixture.byId('catalog-error').textContent,/CATEGORY_PROFILE_LATIN_ALIAS_REQUIRED/);assert.deepEqual(opened,[]);
  assert.equal(fixture.yingdao.marker,'untouched');panel.destroy();
});

function fill(fixture){fixture.byId('catalog-onboarding-display-name').value='Pet Supplies';fixture.byId('catalog-onboarding-page-category').value='Pet Supplies';
  fixture.byId('catalog-onboarding-aliases').value='Pet Supplies\nPets';fixture.byId('catalog-onboarding-parent').value='Home & Pet';
  fixture.byId('catalog-onboarding-breadcrumbs').value='Home & Pet\nPet Supplies';fixture.byId('catalog-onboarding-listing-url').value=profile.listing_url;}
function fakeApi({calls=[],error=null}={}){return{async listProfiles(){return{profiles:[]};},async currentCampaign(){return{current:null};},
  async validateOperatorProfile(body){calls.push(body);if(error)throw error;return{profile};}};}

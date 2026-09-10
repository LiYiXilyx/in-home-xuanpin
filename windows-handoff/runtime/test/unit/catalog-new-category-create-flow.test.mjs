import assert from 'node:assert/strict';
import test from 'node:test';

import {mountCatalogPanel} from '../../ui/modules/catalog/panel.js';
import {catalogDomFixture} from '../fixtures/catalog-panel-dom-fixture.mjs';

const registered={category_key:'pet-supplies',category_profile_version:'operator-pet-supplies-v1-abc123def456',display_name:'Pet Supplies',
  listing_url:'https://www.temu.com/de-en/pet-supplies.html',initial_pool_available:true,expansion_available:false,available:false};

test('save registers, reloads exact profile, then creates Initial with a separate request identity',async()=>{
  const fixture=catalogDomFixture(),api=fakeApi(),ids=['profile-request','campaign-request'];
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,randomUUID:()=>ids.shift()});await panel.refresh();api.order.length=0;
  await prepare(fixture);await fixture.byId('catalog-onboarding-save-create').emit('click');
  assert.deepEqual(api.order,['validate','register','list','createInitial']);
  assert.equal(api.registerBodies[0].request_id,'profile-request');assert.equal(api.initialBodies[0].request_id,'campaign-request');
  assert.equal(panel.getState().selectedProfile.category_key,'pet-supplies');assert.equal(panel.getState().onboarding.profileSaved,true);
  assert.equal(panel.getState().onboarding.campaignCreated,true);assert.equal(panel.getState().currentCampaign.target_count,null);
  panel.destroy();
});

test('Campaign failure retains saved Profile and retry does not re-register or compensate-delete',async()=>{
  const fixture=catalogDomFixture(),api=fakeApi({failInitialOnce:true}),ids=['profile-request','campaign-request'];
  const panel=mountCatalogPanel({root:fixture.catalogRoot,api,scheduler:fixture.scheduler,randomUUID:()=>ids.shift()});await panel.refresh();api.order.length=0;
  await prepare(fixture);await fixture.byId('catalog-onboarding-save-create').emit('click');
  assert.equal(panel.getState().onboarding.profileSaved,true);assert.equal(panel.getState().onboarding.campaignCreated,false);
  assert.equal(panel.getState().onboarding.campaignErrorCode,'CATALOG_RPA_CLAIM_CONFLICT');
  assert.match(fixture.byId('catalog-error').textContent,/PROFILE_SAVED_CAMPAIGN_NOT_CREATED/);
  await fixture.byId('catalog-onboarding-save-create').emit('click');
  assert.equal(api.registerBodies.length,1);assert.equal(api.initialBodies.length,2);
  assert.equal(api.initialBodies[1].request_id,'campaign-request');assert.equal('deleteProfile' in api,false);
  assert.equal(panel.getState().onboarding.campaignCreated,true);panel.destroy();
});

async function prepare(fixture){await fixture.byId('catalog-add-category').emit('click');
  fixture.byId('catalog-onboarding-display-name').value='Pet Supplies';fixture.byId('catalog-onboarding-page-category').value='Pet Supplies';
  fixture.byId('catalog-onboarding-aliases').value='Pet Supplies';fixture.byId('catalog-onboarding-parent').value='Home & Pet';
  fixture.byId('catalog-onboarding-breadcrumbs').value='Home & Pet\nPet Supplies';fixture.byId('catalog-onboarding-listing-url').value=registered.listing_url;
  fixture.byId('catalog-onboarding-campaign-name').value='Pet Initial';await fixture.byId('catalog-onboarding-form').emit('submit');}
function fakeApi({failInitialOnce=false}={}){const order=[],registerBodies=[],initialBodies=[];let failed=false;
  return{order,registerBodies,initialBodies,async currentCampaign(){return{current:null};},async listProfiles(){order.push('list');return{profiles:registerBodies.length?[registered]:[]};},
    async validateOperatorProfile(){order.push('validate');return{profile:registered};},
    async registerOperatorProfile(body){order.push('register');registerBodies.push(body);return{profile:registered,idempotent_replay:false};},
    async createInitial(body){order.push('createInitial');initialBodies.push(body);if(failInitialOnce&&!failed){failed=true;const error=new Error('claim');error.code='CATALOG_RPA_CLAIM_CONFLICT';throw error;}
      return{result:{campaign_id:'campaign-pet',campaign_type:'initial',category_key:registered.category_key,category_profile_version:registered.category_profile_version,
        campaign_name:'Pet Initial',baseline_count:0,target_count:null,remaining:null,target_reached:null,quantity_mode:'OPEN_ENDED',capture_limit:null,current_unique:0,status:'running',binding_status:'UNBOUND'}};}};}

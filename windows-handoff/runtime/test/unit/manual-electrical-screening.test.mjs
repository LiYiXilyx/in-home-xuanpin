import assert from 'node:assert/strict';
import test from 'node:test';
import {screenManualCatalogElectricalRisk as screen} from '../../src/modules/catalog-scale/electronic-screening.mjs';
test('manual screening covers powered devices and electrical parts without rejecting mechanical connectors',()=>{
 for(const title of ['Motorcycle helmet headphones','Helmet intercom','USB charger','LED headlights','Toggle switches','Blade fuses','12V relays','Battery terminal connectors','Wiring harness','Spark plugs','Digital speedometer','Electric fuel pump','Motorcycle horn','车灯开关']) assert.equal(screen({title}).decision,'exclude',title);
 for(const title of ['Motorcycle tail bag','Rubber fuel hose','Brass hose connectors','Helmet lock','Motorcycle stand','Brake cable']) assert.equal(screen({title}).decision,'passed',title);
 assert.equal(screen({title:''}).decision,'manual_review_required');
});

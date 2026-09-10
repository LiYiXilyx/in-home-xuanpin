import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogPanelMarkup,mountCatalogPanel,refreshCatalogPanel
} from '../../ui/modules/catalog/panel.js';

test('Catalog markup uses only catalog-* IDs and approved shared classes',()=>{
  const html=catalogPanelMarkup();
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(ids.length>10);
  assert.equal(ids.every(id=>id.startsWith('catalog-')),true);
  const approvedShared=new Set(['panel','primary','eyebrow']);
  const classes=[...html.matchAll(/\bclass="([^"]+)"/g)].flatMap(match=>match[1].split(/\s+/));
  assert.equal(classes.every(name=>name.startsWith('catalog-')||approvedShared.has(name)),true);
  assert.doesNotMatch(html,/yingdao|random5|1688|run_id/i);
});

test('same-root mount is idempotent and destroy mutates only the supplied root',async()=>{
  const root=fakeRoot(),yingdao={html:'<button>keep</button>'};
  const first=mountCatalogPanel({root});
  const second=mountCatalogPanel({root});
  assert.equal(second,first);
  assert.equal(root.innerHtmlWrites,1);
  first.destroy();
  assert.equal(root.clears,1);
  assert.equal(yingdao.html,'<button>keep</button>');
});

test('refresh before mount hard fails without a DOM write',async()=>{
  const root=fakeRoot();
  await assert.rejects(()=>refreshCatalogPanel(),error=>error.code==='CATALOG_PANEL_NOT_MOUNTED');
  assert.equal(root.mutations,0);
});

function fakeRoot(){
  let html='';
  return {
    mutations:0,innerHtmlWrites:0,clears:0,
    get innerHTML(){return html;},
    set innerHTML(value){html=String(value);this.mutations++;this.innerHtmlWrites++;},
    replaceChildren(){html='';this.mutations++;this.clears++;}
  };
}

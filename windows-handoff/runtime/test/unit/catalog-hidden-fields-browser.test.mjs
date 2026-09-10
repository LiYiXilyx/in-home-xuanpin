import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';

test('Catalog hidden Initial fields stay invisible despite grid styling; Expansion can reveal them',async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage();
  await page.setContent('<section id="catalog-module-root"><div class="catalog-panel"><label class="catalog-field" hidden>本次新增数量<input></label></div></section><section id="yingdao-module-root">YingDao</section>');
  await page.addStyleTag({content:await readFile(new URL('../../ui/modules/catalog/catalog.css',import.meta.url),'utf8')});
  assert.equal(await page.locator('.catalog-field').isVisible(),false);
  await page.locator('.catalog-field').evaluate(node=>node.hidden=false);
  assert.equal(await page.locator('.catalog-field').isVisible(),true);
  assert.equal(await page.locator('#yingdao-module-root').isVisible(),true);
 } finally {await browser.close();}
});

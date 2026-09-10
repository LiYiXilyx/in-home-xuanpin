import test from 'node:test';import assert from 'node:assert/strict';
import {createVisualDisplayImageResolver} from '../../src/modules/sourcing/visual-display-image.mjs';

function fixture({original=null,display=null,retrieval=null}={}) {
 const universe={items:[{goods_id:'g1'}]};
 const indexStore={status:async()=>({status:'READY',index_fingerprint:'f'}),loadReady:async()=>({products:[{goods_id:'g1'}]}),displayAsset:async()=>display,retrievalAsset:async()=>retrieval};
 const temuRepository={getTemuContext:id=>({temu_goods_id:id,temu_context_status:original?'AVAILABLE':'MISSING'})};
 const temuImageResolver={resolveTemuImage:async()=>original??{kind:'MISSING'}};
 return createVisualDisplayImageResolver({runId:'r',universe,indexStore,temuRepository,temuImageResolver});
}

test('prefers validated Temu original over index display and retrieval assets',async()=>{
 const resolver=fixture({original:{kind:'LOCAL',contentType:'image/png',bytes:Buffer.from('original'),width:900,height:700},display:{bytes:Buffer.from('display'),width:500,height:300},retrieval:{bytes:Buffer.from('retrieval'),width:224,height:224}});
 const meta=await resolver.describe({goodsId:'g1',fingerprint:'f'}),image=await resolver.image({goodsId:'g1',fingerprint:'f'});
 assert.equal(meta.display_image_kind,'TEMU_LOCAL_ORIGINAL');assert.equal(meta.display_image_width,900);assert.deepEqual(image.bytes,Buffer.from('original'));
 assert.doesNotMatch(JSON.stringify(meta),/local_path|imageCacheDir|workbook_path/);
});

test('falls back from display thumbnail to retrieval thumbnail and then missing',async()=>{
 const display=fixture({display:{kind:'INDEX_DISPLAY_THUMBNAIL',contentType:'image/jpeg',bytes:Buffer.from('display'),width:500,height:300,low_resolution:false}});
 assert.equal((await display.describe({goodsId:'g1',fingerprint:'f'})).display_image_kind,'INDEX_DISPLAY_THUMBNAIL');
 const retrieval=fixture({retrieval:{kind:'RETRIEVAL_FALLBACK',contentType:'image/jpeg',bytes:Buffer.from('retrieval'),width:224,height:224,low_resolution:true}});
 assert.equal((await retrieval.describe({goodsId:'g1',fingerprint:'f'})).display_image_kind,'RETRIEVAL_FALLBACK');
 assert.equal((await retrieval.describe({goodsId:'g1',fingerprint:'f'})).display_image_low_resolution,true);
 const missing=fixture();assert.deepEqual(await missing.describe({goodsId:'g1',fingerprint:'f'}),{display_image_url:null,display_image_kind:'MISSING',display_image_width:null,display_image_height:null,display_image_low_resolution:true,display_image_source:'NONE'});
});

test('rejects stale fingerprint and goods outside the bound index',async()=>{
 const resolver=fixture({original:{kind:'LOCAL',bytes:Buffer.from('x'),width:2,height:2}});
 await assert.rejects(()=>resolver.describe({goodsId:'g1',fingerprint:'wrong'}),e=>e.code==='VISUAL_INDEX_STALE');
 await assert.rejects(()=>resolver.describe({goodsId:'other',fingerprint:'f'}),e=>e.code==='VISUAL_IMAGE_NOT_FOUND');
});

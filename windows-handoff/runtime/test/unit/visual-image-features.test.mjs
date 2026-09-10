import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {preprocessVisualImage,computeDHash64,hammingDistance64,PREPROCESSING_VERSION} from '../../src/modules/sourcing/visual-image-features.mjs';
const require=createRequire(import.meta.url),sharp=require('sharp');
test('normalizes decoded input to deterministic 224 JPEG and dHash',async()=>{
 const png=await sharp({create:{width:32,height:16,channels:3,background:'#ff0000'}}).png().toBuffer();
 const a=await preprocessVisualImage(png),b=await preprocessVisualImage(png);
 assert.equal(PREPROCESSING_VERSION,'SHARP_224_SRGB_WHITE_V1');assert.equal(a.jpeg.equals(b.jpeg),true);assert.equal((await sharp(a.jpeg).metadata()).format,'jpeg');
 assert.equal(computeDHash64(a.grayscale9x8),computeDHash64(b.grayscale9x8));assert.equal(hammingDistance64('00','01'),1);
});
test('rejects undecodable bytes',async()=>{await assert.rejects(()=>preprocessVisualImage(Buffer.from('html')),e=>e.code==='VISUAL_IMAGE_DECODE_FAILED')});

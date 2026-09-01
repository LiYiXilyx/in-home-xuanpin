import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),sharp=require('sharp');
export const PREPROCESSING_VERSION='SHARP_224_SRGB_WHITE_V1';

export async function preprocessVisualImage(bytes){
 try{
  const image=sharp(bytes,{failOn:'error'}).rotate().toColourspace('srgb');
  const jpeg=await image.clone().resize(224,224,{fit:'contain',background:'#ffffff'}).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();
  const grayscale9x8=await sharp(bytes,{failOn:'error'}).rotate().grayscale().resize(9,8,{fit:'fill'}).raw().toBuffer();
  return {jpeg,grayscale9x8,perceptual_hash:computeDHash64(grayscale9x8)};
 }catch(error){throw Object.assign(new Error(error.message),{code:'VISUAL_IMAGE_DECODE_FAILED'});}
}
export function computeDHash64(pixels){
 if(!pixels||pixels.length!==72)throw new Error('dHash requires 9x8 grayscale pixels');
 let bits=0n,index=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++,index++)if(pixels[y*9+x]>pixels[y*9+x+1])bits|=1n<<BigInt(index);
 return bits.toString(16).padStart(16,'0');
}
export function hammingDistance64(left,right){let value=BigInt(`0x${left}`)^BigInt(`0x${right}`),count=0;while(value){count+=Number(value&1n);value>>=1n;}return count;}

export const MAX_SCREENS=8,TARGET_PRODUCTS=40;
export function captureProgress(ids,screens){const unique=new Set(ids).size;return {unique,screens,target:TARGET_PRODUCTS,reason:unique>=TARGET_PRODUCTS?'TARGET_REACHED':screens>=MAX_SCREENS?'SCREEN_LIMIT':null};}

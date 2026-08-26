import { REQUIRED_ELECTRONIC_EXCLUSION_CODES } from './category-profile.mjs';

export const ELECTRONIC_SCREENING_VERSION='catalog-electronic-rule-v1';
export const ELECTRONIC_EXCLUSION_CODES=REQUIRED_ELECTRONIC_EXCLUSION_CODES;

const RULES=Object.freeze([
  ['USB_PRODUCT',/\b(?:usb(?:[-\s]?[a-z0-9]+)?|type[-\s]?c)\b/i,'标题命中 USB / Type-C'],
  ['BATTERY_PRODUCT',/\b(?:battery|batteries|lithium|li[-\s]?ion|power\s*bank)\b/i,'标题命中电池或锂电'],
  ['RECHARGEABLE_PRODUCT',/\b(?:rechargeable|recharging)\b/i,'标题命中可充电产品'],
  ['BLUETOOTH_PRODUCT',/\bbluetooth\b/i,'标题命中蓝牙产品'],
  ['WIRELESS_COMMUNICATION',/\b(?:wireless|intercom|walkie[-\s]?talkie|radio communication)\b/i,'标题命中无线通信'],
  ['AUDIO_ELECTRONIC',/\b(?:audio|speaker|headset|headphone|earphone|earbud|microphone)\b/i,'标题命中音频电子'],
  ['LIGHTING_ELECTRONIC',/\b(?:led|headlight|fog light|driving light|turn signal|tail light|light bar|lamp)\b/i,'标题命中电子照明'],
  ['CERTIFICATION_RISK',/\b(?:charger|charging|gps|camera|dash cam|voltmeter|alarm system)\b/i,'标题命中明显认证风险'],
  ['ELECTRONIC_PRODUCT',/\b(?:electronic|digital device|electrical device)\b/i,'标题命中通用电子产品']
]);

export function screenCatalogElectronicRisk(product,{ classifierVersion=ELECTRONIC_SCREENING_VERSION }={}) {
  const title=String(product?.title ?? product?.latest_title ?? '').normalize('NFKC').trim();
  if (!title) return { decision:'manual_review_required',codes:[],reasons:['标题缺失，无法可靠完成电子排除'],confidence:0,classifierVersion };
  const matches=RULES.filter(([,pattern]) => pattern.test(title));
  if (!matches.length) return { decision:'passed',codes:[],reasons:[],confidence:0.9,classifierVersion };
  return { decision:'exclude',codes:matches.map(([code]) => code),reasons:matches.map(([, ,reason]) => reason),confidence:0.99,classifierVersion };
}

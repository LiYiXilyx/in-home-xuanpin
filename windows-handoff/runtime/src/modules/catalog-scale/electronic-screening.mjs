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


// Manual collection excludes powered devices and electrical parts as well as electronics.
const MANUAL_ELECTRICAL_PATTERN = /\b(?:electri(?:c|cal|onic)s?|battery|batteries|lithium|recharg\w*|chargers?|charging|usb|type[-\s]?c|bluetooth|wireless|intercoms?|walkie[-\s]?talkies?|radios?|audio|speakers?|headsets?|headphones?|earphones?|earbuds?|microphones?|leds?|lights?|lighting|lamps?|headlights?|taillights?|bulbs?|turn signals?|switch(?:es)?|fuses?|relays?|wiring|wires?|wiring harness(?:es)?|circuit breakers?|circuit boards?|sensors?|voltmeters?|multimeters?|speedometers?|tachometers?|digital (?:gauges?|meters?|displays?)|gps|cameras?|dash\s*cams?|alarms?|horns?|solenoids?|alternators?|rectifiers?|ignition coils?|spark plugs?|starter motors?|power banks?|power adapters?|inverters?|(?:electrical|wire|cable) connectors?|(?:battery|electrical|wire) terminals?)\b|电子|电池|充电|蓝牙|耳机|对讲机|车灯|灯泡|开关|保险丝|继电器|传感器|线束|电线|接线端子|电源|摄像头|行车记录仪|电子仪表|火花塞|点火线圈/i;

export function screenManualCatalogElectricalRisk(product) {
  const result=screenCatalogElectronicRisk(product);
  const title=String(product?.title ?? product?.latest_title ?? '').normalize('NFKC');
  if (!MANUAL_ELECTRICAL_PATTERN.test(title)) return {...result,classifierVersion:'manual-electrical-rule-v1'};
  return {decision:'exclude',codes:[...new Set([...result.codes,'ELECTRONIC_PRODUCT'])],
    reasons:[...result.reasons,...(result.codes.includes('ELECTRONIC_PRODUCT')?[]:['手动采集排除：带电产品或电气配件'])],
    confidence:0.9,classifierVersion:'manual-electrical-rule-v1'};
}

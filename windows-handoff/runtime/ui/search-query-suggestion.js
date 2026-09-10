export function suggestSearchQuery(title){
 const clean=String(title||'').toLowerCase().replace(/\b(top pick|best selling|best-selling|high quality|high-quality|selection|open in new tab|hot sale|new arrival)\b/g,' ').replace(/[^a-z0-9\s.-]/g,' ').replace(/\s+/g,' ').trim();
 if(!clean)return '';
 // Only select product types explicitly present in the source title.
 if(/motorcycle/.test(clean)&&/helmet/.test(clean)&&(/headphones?|headset|earphones?/.test(clean))&&(!/intercom/.test(clean)||/\b(?:no|without)\s+intercom\b/.test(clean)))return 'motorcycle helmet headphone';
 if(/motorcycle/.test(clean)&&/helmet/.test(clean)&&/intercom/.test(clean))return 'motorcycle helmet intercom';
 if(/motorcycle|motorbike/.test(clean)&&/tail bag|tail pack|seat bag/.test(clean)){const capacity=clean.match(/\b\d+\s*l\b/);return ['motorcycle',capacity?.[0]?.replace(/\s/g,''),/waterproof/.test(clean)?'waterproof':null,'tail bag'].filter(Boolean).join(' ');}
 if(/chest protector/.test(clean))return (/motocross/.test(clean)?'motocross ': /motorcycle/.test(clean)?'motorcycle ':'')+'chest protector';
 if(/switch cap/.test(clean))return [/motorcycle/.test(clean)?'motorcycle':null,/aluminum/.test(clean)?'aluminum alloy':null,'switch cap'].filter(Boolean).join(' ');
 const first=clean.split(/\b(?:suitable for|compatible with|designed for|available in)\b/)[0];
 const seen=new Set(),words=[];for(const word of first.split(' ')){if(!word||['with','and','the','a','an','of','multi','multifunctional'].includes(word)||seen.has(word))continue;seen.add(word);words.push(word);if(words.length===10)break;}return words.join(' ').slice(0,100).replace(/\s+\S*$/g,m=>words.join(' ').length>100?'':m).trim();
}

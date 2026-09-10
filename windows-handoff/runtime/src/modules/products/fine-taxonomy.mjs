export function compileFineTaxonomy(config) {
  if (!config || !Array.isArray(config.categories) || !config.categories.length) throw new Error('细分类taxonomy必须包含categories。');
  const keys=new Set();
  const categories=config.categories.map((item,index) => {
    const categoryKey=required(item.categoryKey,`categories[${index}].categoryKey`);
    if (keys.has(categoryKey)) throw new Error(`细分类categoryKey重复：${categoryKey}`);keys.add(categoryKey);
    const strongKeywords=keywords(item.strongKeywords);const normalKeywords=keywords(item.keywords);
    if (!strongKeywords.length && !normalKeywords.length) throw new Error(`${categoryKey}没有分类关键词。`);
    return { categoryKey,level1:item.level1 || config.defaultLevel1 || 'Motorcycle Accessories',level2:required(item.level2,`${categoryKey}.level2`),level3:required(item.level3,`${categoryKey}.level3`),priority:Number(item.priority ?? index+1),strongKeywords,keywords:normalKeywords };
  });
  const autoAccept=Number(config.thresholds?.autoAccept ?? 0.85);const reviewAccept=Number(config.thresholds?.reviewAccept ?? 0.65);
  if (!(reviewAccept >= 0 && reviewAccept < autoAccept && autoAccept <= 1)) throw new Error('细分类置信度阈值无效。');
  return { taxonomy:required(config.taxonomy,'taxonomy'),ruleVersion:required(config.ruleVersion,'ruleVersion'),promptVersion:required(config.promptVersion,'promptVersion'),autoAccept,reviewAccept,categories,
    fallback:{ categoryKey:config.fallback?.categoryKey || 'other-unresolved',level1:config.defaultLevel1 || 'Motorcycle Accessories',level2:config.fallback?.level2 || '其他待复核',level3:config.fallback?.level3 || '其他' } };
}

export function classifyFineProduct(product,taxonomy) {
  const text=normalize(`${product?.title ?? ''} ${product?.currentCategory ?? product?.categoryLabel ?? ''} ${product?.subcategory ?? ''}`);
  const candidates=taxonomy.categories.map(category => {
    const strong=category.strongKeywords.filter(keyword => matchesKeyword(text,keyword));const normal=category.keywords.filter(keyword => matchesKeyword(text,keyword));
    return { category,strong,normal,score:strong.length*3+normal.length };
  }).filter(item => item.score > 0).sort((a,b) => b.score-a.score || a.category.priority-b.category.priority || a.category.categoryKey.localeCompare(b.category.categoryKey));
  if (!candidates.length) return result(taxonomy.fallback,taxonomy,0.35,'manual',true,'NO_FINE_RULE_MATCH',[],[]);
  const winner=candidates[0];const runner=candidates[1];const tied=Boolean(runner && runner.score === winner.score);
  const evidence=[...winner.strong,...winner.normal];
  let confidence=winner.strong.length && winner.score >= 4 ? 0.93 : winner.strong.length ? 0.88 : winner.normal.length >= 2 ? 0.86 : 0.75;
  let unresolvedReason=null;
  if (tied) { confidence=0.6;unresolvedReason=`AMBIGUOUS_FINE_RULE_MATCH:${winner.category.categoryKey}|${runner.category.categoryKey}`; }
  const manualReview=confidence < taxonomy.reviewAccept;const needsReview=manualReview || confidence < taxonomy.autoAccept;
  return result(manualReview ? taxonomy.fallback : winner.category,taxonomy,confidence,manualReview ? 'manual' : 'rule',needsReview,unresolvedReason,evidence,
    candidates.slice(1,3).map(item => ({ categoryKey:item.category.categoryKey,score:item.score,keywords:[...item.strong,...item.normal] })));
}

export function sampleSizeStatus(eligibleCount) {
  const count=Number(eligibleCount ?? 0);return count >= 10 ? 'usable' : count >= 5 ? 'small_sample' : 'insufficient_sample';
}

export function validateFineTaxonomyOutput(output,taxonomy) {
  const errors=[];const category=taxonomy.categories.find(item => item.level2 === output?.level2 && item.level3 === output?.level3);
  if (!category && output?.level3 !== taxonomy.fallback.level3) errors.push('UNKNOWN_TAXONOMY_PATH');
  if (!Number.isFinite(Number(output?.confidence)) || Number(output.confidence) < 0 || Number(output.confidence) > 1) errors.push('INVALID_CONFIDENCE');
  if (typeof output?.reason !== 'string' || !output.reason.trim()) errors.push('MISSING_REASON');
  for (const flag of ['is_electronic','has_usb','battery_risk','certification_risk']) if (typeof output?.[flag] !== 'boolean') errors.push(`INVALID_${flag.toUpperCase()}`);
  return { valid:errors.length === 0,errors,categoryKey:category?.categoryKey ?? null };
}

function result(category,taxonomy,confidence,method,needsReview,unresolvedReason,matchedKeywords,alternatives) {
  return { taxonomy:taxonomy.taxonomy,categoryKey:category.categoryKey,categoryLabel:category.level3,level1:category.level1,level2:category.level2,level3:category.level3,productFamily:category.level3,method,ruleVersion:taxonomy.ruleVersion,confidence,needsReview,manualReviewRequired:method === 'manual',unresolvedReason,
    reasons:[{ code:unresolvedReason || 'FINE_RULE_MATCH',matchedKeywords,alternatives }] };
}
function normalize(value) { return String(value).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim(); }
function matchesKeyword(text,keyword) { const pattern=normalize(keyword).split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`,'i').test(text); }
function keywords(values) { return (values ?? []).map(item => normalize(item)).filter(Boolean); }
function required(value,path) { const text=String(value ?? '').trim();if (!text) throw new Error(`细分类配置缺少${path}。`);return text; }

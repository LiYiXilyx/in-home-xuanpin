export function compileCategoryRules(config) {
  if (!config || !Array.isArray(config.categories) || config.categories.length === 0) throw new Error('分类规则必须包含非空 categories。');
  const seen=new Set();
  const categories=config.categories.map((category,index) => {
    const categoryKey=required(category.categoryKey,`categories[${index}].categoryKey`);
    if (seen.has(categoryKey)) throw new Error(`分类规则 categoryKey 重复：${categoryKey}`);
    seen.add(categoryKey);
    const keywords=(category.keywords ?? []).map(item => String(item).trim().toLowerCase()).filter(Boolean);
    if (keywords.length === 0) throw new Error(`${categoryKey} 没有关键词。`);
    return { categoryKey,level1:category.level1 || config.defaultLevel1 || '摩托车配件',
      level2:required(category.level2,`${categoryKey}.level2`),level3:required(category.level3,`${categoryKey}.level3`),
      priority:Number.isFinite(Number(category.priority)) ? Number(category.priority) : index+1,keywords };
  });
  return { taxonomy:required(config.taxonomy,'taxonomy'),ruleVersion:required(config.ruleVersion,'ruleVersion'),
    reviewThreshold:Number(config.reviewThreshold ?? 0.7),categories,
    fallback:{ categoryKey:config.fallback?.categoryKey || 'other',level1:config.fallback?.level1 || config.defaultLevel1 || '摩托车配件',
      level2:config.fallback?.level2 || '其他',level3:config.fallback?.level3 || '其他' } };
}

export function classifyProductByRules(product,rules) {
  const text=normalize(`${product?.title ?? ''} ${product?.subcategory ?? ''}`);
  const matches=rules.categories.map(category => ({ ...category,
    matchedKeywords:category.keywords.filter(keyword => matchesKeyword(text,keyword))
  })).filter(item => item.matchedKeywords.length > 0)
    .sort((a,b) => b.matchedKeywords.length-a.matchedKeywords.length || a.priority-b.priority || a.categoryKey.localeCompare(b.categoryKey));
  if (matches.length === 0) return makeResult(rules.fallback,rules,0.35,true,[{ code:'NO_RULE_MATCH',message:'标题和子类目未命中已配置关键词。' }]);
  const winner=matches[0];
  const runnerUp=matches[1];
  const ambiguous=Boolean(runnerUp && runnerUp.matchedKeywords.length === winner.matchedKeywords.length);
  const confidence=ambiguous ? 0.55 : winner.matchedKeywords.length >= 2 ? 0.92 : 0.78;
  const reasons=[{ code:'KEYWORD_MATCH',categoryKey:winner.categoryKey,matchedKeywords:winner.matchedKeywords }];
  if (runnerUp) reasons.push({ code:ambiguous ? 'AMBIGUOUS_MATCH' : 'SECONDARY_MATCH',categoryKey:runnerUp.categoryKey,matchedKeywords:runnerUp.matchedKeywords });
  return makeResult(winner,rules,confidence,confidence < rules.reviewThreshold || ambiguous,reasons);
}

function makeResult(category,rules,confidence,needsReview,reasons) {
  return { taxonomy:rules.taxonomy,categoryKey:category.categoryKey,categoryLabel:category.level3,
    level1:category.level1,level2:category.level2,level3:category.level3,method:'rule',ruleVersion:rules.ruleVersion,
    confidence,needsReview,reasons };
}
function normalize(value) { return String(value).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim(); }
function matchesKeyword(text,keyword) {
  const normalized=normalize(keyword);
  if (!/^[a-z0-9 -]+$/.test(normalized)) return text.includes(normalized);
  const pattern=normalized.split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`,'i').test(text);
}
function required(value,path) { const result=String(value ?? '').trim(); if (!result) throw new Error(`分类规则缺少 ${path}。`); return result; }

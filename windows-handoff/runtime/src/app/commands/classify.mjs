import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { createClassificationRepository } from '../../db/repositories/classification-repository.mjs';
import { classifyProductByRules,compileCategoryRules } from '../../modules/products/rule-classifier.mjs';
import { assertTaxonomyBinding,loadCategoryProfile } from '../../modules/catalog-scale/category-profile.mjs';

export async function runClassifyCommand(config,{ jobId=null,rulesPath='config/category-rules.example.json',poolVersionId=null,profilePath=null }={}) {
  if (!poolVersionId || !profilePath) throw new Error('正式分类必须显式提供 poolVersionId 与 profilePath。');
  const absoluteRules=path.resolve(path.dirname(config.configPath),rulesPath);
  const rules=compileCategoryRules(JSON.parse(await fs.readFile(absoluteRules,'utf8')));
  const profile=await loadCategoryProfile(path.resolve(path.dirname(config.configPath),profilePath));
  assertTaxonomyBinding({ profile,pipeline:'classify',taxonomyName:rules.taxonomy,taxonomyVersion:null,ruleVersion:rules.ruleVersion });
  const db=openDatabase(config.app.databasePath);
  try {
    const repository=createClassificationRepository(db);
    const scope={ poolVersionId,categoryKey:profile.category_key };
    const resolvedJobId=repository.resolvePoolJobId({ ...scope,requestedJobId:jobId });
    const classified=repository.listPoolProducts(scope).map(product => ({ productId:Number(product.product_id),goodsId:String(product.goods_id),...classifyProductByRules(product,rules) }));
    repository.replaceAll(resolvedJobId,classified);
    return { jobId:resolvedJobId,taxonomy:rules.taxonomy,ruleVersion:rules.ruleVersion,products:classified.length,
      distribution:repository.distribution(resolvedJobId,rules.taxonomy),...repository.count(resolvedJobId,rules.taxonomy) };
  } finally { db.close(); }
}

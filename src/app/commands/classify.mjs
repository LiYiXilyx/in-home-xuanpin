import fs from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from '../../db/client.mjs';
import { createClassificationRepository } from '../../db/repositories/classification-repository.mjs';
import { classifyProductByRules,compileCategoryRules } from '../../modules/products/rule-classifier.mjs';

export async function runClassifyCommand(config,{ jobId=null,rulesPath='config/category-rules.example.json' }={}) {
  const absoluteRules=path.resolve(path.dirname(config.configPath),rulesPath);
  const rules=compileCategoryRules(JSON.parse(await fs.readFile(absoluteRules,'utf8')));
  const db=openDatabase(config.app.databasePath);
  try {
    const repository=createClassificationRepository(db);
    const resolvedJobId=repository.resolveJobId(jobId);
    const classified=repository.listActiveProducts().map(product => ({ productId:Number(product.product_id),goodsId:String(product.goods_id),...classifyProductByRules(product,rules) }));
    repository.replaceAll(resolvedJobId,classified);
    return { jobId:resolvedJobId,taxonomy:rules.taxonomy,ruleVersion:rules.ruleVersion,products:classified.length,
      distribution:repository.distribution(resolvedJobId,rules.taxonomy),...repository.count(resolvedJobId,rules.taxonomy) };
  } finally { db.close(); }
}

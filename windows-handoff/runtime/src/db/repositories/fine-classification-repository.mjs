import { transaction } from '../client.mjs';

export function createFineClassificationRepository(db) {
  const upsertAttempt=db.prepare(`INSERT INTO fine_classification_attempts(product_id,job_id,taxonomy,method,provider,model,model_version,prompt_version,input_hash,response_hash,validation_status,
    structured_output_json,validation_result_json,confidence,unresolved_reason,classified_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(product_id,job_id,taxonomy,method,input_hash) DO UPDATE SET
      provider=excluded.provider,model=excluded.model,model_version=excluded.model_version,prompt_version=excluded.prompt_version,
      response_hash=excluded.response_hash,validation_status=excluded.validation_status,structured_output_json=excluded.structured_output_json,validation_result_json=excluded.validation_result_json,
      confidence=excluded.confidence,unresolved_reason=excluded.unresolved_reason,classified_at=excluded.classified_at`);
  return {
    saveAttempts(attempts) { transaction(db,() => { for (const item of attempts) upsertAttempt.run(item.productId,item.jobId,item.taxonomy,item.method,item.provider ?? null,item.model ?? null,item.modelVersion ?? null,item.promptVersion,item.inputHash,item.responseHash ?? null,item.validationStatus ?? 'valid',JSON.stringify(item.structuredOutput),JSON.stringify(item.validationResult),item.confidence,item.unresolvedReason ?? null,item.classifiedAt); }); },
    count(jobId,taxonomy) { const row=db.prepare(`SELECT COUNT(DISTINCT product_id) AS products,COUNT(*) AS attempts,
      SUM(CASE WHEN unresolved_reason IS NOT NULL THEN 1 ELSE 0 END) AS unresolved
      FROM fine_classification_attempts WHERE job_id=? AND taxonomy=?`).get(jobId,taxonomy);return { products:Number(row.products),attempts:Number(row.attempts),unresolved:Number(row.unresolved) }; },
    listManual(jobId,taxonomy) { return db.prepare(`SELECT p.external_product_id AS goods_id,p.title,a.confidence,a.unresolved_reason,a.structured_output_json,a.classified_at
      FROM fine_classification_attempts a JOIN products p ON p.id=a.product_id
      WHERE a.job_id=? AND a.taxonomy=? AND a.unresolved_reason IS NOT NULL
      ORDER BY a.confidence,p.external_product_id`).all(jobId,taxonomy); }
  };
}

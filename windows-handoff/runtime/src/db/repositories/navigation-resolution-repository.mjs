import { createId } from '../../shared/ids.mjs';

export function createNavigationResolutionRepository(db,{ now=() => new Date().toISOString() }={}) {
  function record(input) {
    const id=createId('navigation_resolution');
    const resolvedAt=input.resolvedAt ?? now();
    db.prepare(`INSERT INTO navigation_resolutions(
      id,goods_id,job_id,historical_source_url,fresh_url,resolution_method,source_page_url,
      resolved_at,detail_verified,error_code,details_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,String(input.goodsId),String(input.jobId),input.historicalSourceUrl ?? null,input.freshUrl ?? null,
      input.resolutionMethod ?? null,input.sourcePageUrl ?? null,resolvedAt,input.detailVerified ? 1:0,
      input.errorCode ?? null,JSON.stringify(input.details ?? {})
    );
    return get(id);
  }

  function verify(id,{ detailVerified,errorCode=null,details }={}) {
    db.prepare(`UPDATE navigation_resolutions SET detail_verified=?,error_code=?,details_json=COALESCE(?,details_json)
      WHERE id=?`).run(detailVerified ? 1:0,errorCode,details === undefined ? null:JSON.stringify(details),id);
    return get(id);
  }

  function get(id) { return mapRow(db.prepare('SELECT * FROM navigation_resolutions WHERE id=?').get(id)); }
  function latest(jobId,goodsId) { return mapRow(db.prepare(`SELECT * FROM navigation_resolutions
    WHERE job_id=? AND goods_id=? ORDER BY resolved_at DESC,id DESC LIMIT 1`).get(jobId,goodsId)); }
  function list(jobId) { return db.prepare(`SELECT * FROM navigation_resolutions WHERE job_id=?
    ORDER BY resolved_at,id`).all(jobId).map(mapRow); }

  return { record,verify,get,latest,list };
}

function mapRow(row) {
  if (!row) return null;
  return {
    id:row.id,goodsId:row.goods_id,jobId:row.job_id,historicalSourceUrl:row.historical_source_url,
    freshUrl:row.fresh_url,resolutionMethod:row.resolution_method,sourcePageUrl:row.source_page_url,
    resolvedAt:row.resolved_at,detailVerified:Boolean(row.detail_verified),errorCode:row.error_code,
    details:parseJson(row.details_json)
  };
}
function parseJson(value) { try { return value ? JSON.parse(value):{}; } catch { return {}; } }

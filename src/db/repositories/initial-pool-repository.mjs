import { createId } from '../../shared/ids.mjs';

export function createInitialPoolRepository(db, { now = () => new Date().toISOString() } = {}) {
  function getInitialEligibility(profile) {
    const scope = profile.membership_scope;
    const poolHistory = db.prepare(`SELECT id,status,category_profile_version FROM catalog_pool_versions
      WHERE category_key=? ORDER BY created_at,id`).all(profile.category_key);
    const activeMemberships = db.prepare(`SELECT id,product_id FROM catalog_memberships
      WHERE category_key=? AND site_country=? AND language=? AND currency=?
        AND primary_category=? AND subcategory=? AND sort_order=? AND active=1 ORDER BY id`).all(
      profile.category_key, scope.site_country, scope.language, scope.currency,
      scope.primary_category, scope.subcategory, scope.sort_order
    );
    const priorInitials = db.prepare(`SELECT id,status FROM catalog_campaigns
      WHERE category_key=? AND campaign_type='initial'
        AND status NOT IN ('completed','failed','cancelled') ORDER BY created_at,id`).all(profile.category_key);
    return {
      categoryKey: profile.category_key, categoryProfileVersion: profile.category_profile_version,
      poolHistoryCount: poolHistory.length, poolHistory,
      activeMembershipCount: activeMemberships.length, activeMembershipIds: activeMemberships.map(row => row.id),
      priorNonterminalInitialCount: priorInitials.length, priorInitials,
      eligible: poolHistory.length === 0 && activeMemberships.length === 0 && priorInitials.length === 0
    };
  }

  function recordInitialEligibilityAudit(campaign, eligibility) {
    db.prepare(`INSERT INTO catalog_initial_pool_eligibility_audits(
      campaign_id,category_key,category_profile_version,pool_history_count,active_membership_count,
      prior_nonterminal_initial_count,pool_history_json,active_membership_ids_json,eligible,checked_at
    ) VALUES(?,?,?,?,?,?,?,?,1,?)`).run(
      campaign.id, campaign.categoryKey, campaign.categoryProfileVersion, eligibility.poolHistoryCount,
      eligibility.activeMembershipCount, eligibility.priorNonterminalInitialCount,
      JSON.stringify(eligibility.poolHistory), JSON.stringify(eligibility.activeMembershipIds), now()
    );
  }

  function initializeCandidateState(campaign) {
    db.prepare(`INSERT INTO catalog_initial_pool_candidate_state(
      campaign_id,category_key,category_profile_version,current_revision,current_hash,candidate_count,
      candidate_hash_version,normalization_version,field_set_version,updated_at
    ) VALUES(?,?,?,0,?,0,'v1','v1','initial-pool-activation-v1',?)`).run(
      campaign.id, campaign.categoryKey, campaign.categoryProfileVersion, '0'.repeat(64), now()
    );
  }

  function findInitialByRequestId(requestId) {
    const row = db.prepare(`SELECT id FROM catalog_campaigns
      WHERE campaign_type='initial' AND json_extract(config_json,'$.operatorCreate.requestId')=?
      ORDER BY created_at,id LIMIT 1`).get(requestId);
    return row?.id ?? null;
  }

  function getCandidateState(campaignId) {
    return db.prepare('SELECT * FROM catalog_initial_pool_candidate_state WHERE campaign_id=?').get(campaignId) ?? null;
  }

  return { getInitialEligibility, recordInitialEligibilityAudit, initializeCandidateState,
    findInitialByRequestId, getCandidateState, createQaRunId: () => createId('initial_qa') };
}

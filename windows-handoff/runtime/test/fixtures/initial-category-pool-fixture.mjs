import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDatabase } from '../../src/db/migrate.mjs';
import { openDatabase } from '../../src/db/client.mjs';
import { createCatalogCampaignService } from '../../src/modules/catalog-scale/catalog-campaign-service.mjs';
import { REQUIRED_ELECTRONIC_EXCLUSION_CODES, validateCategoryProfile } from '../../src/modules/catalog-scale/category-profile.mjs';

export function fixtureCategoryProfile() {
  return validateCategoryProfile({
    category_key: 'fixture-category-b', category_profile_version: 'fixture-category-b-v1',
    display_name: 'Fixture Category B', site_country: 'DE', language: 'en', currency: 'EUR',
    sort_order: 'Top Sales', target_count: 2000, exclude_electronics: true, exclude_usb: true,
    exclude_battery: true, price_min_eur: 5, taxonomy: 'fixture-category-b-taxonomy',
    membership_scope: { site_country: 'DE', language: 'en', currency: 'EUR', primary_category: 'Fixture',
      subcategory: 'Category B', sort_order: 'Top Sales' },
    page_health: { category_names: ['Fixture Category B'] },
    taxonomy_bindings: {
      classify: { taxonomy_name: 'fixture-category-b-classify', taxonomy_version: null, rule_version: 'fixture-classify-v1' },
      fine_classify: { taxonomy_name: 'fixture-category-b-fine', taxonomy_version: 'fixture-fine-v1', rule_version: 'fixture-fine-rule-v1' },
      opportunity: { taxonomy_name: 'fixture-category-b-opportunity', taxonomy_version: 'fixture-opportunity-v1', rule_version: 'fixture-opportunity-rule-v1' }
    },
    legacy_membership_scopes: [], navigation: { entry_method: 'site_menu', breadcrumbs: ['Fixture', 'Category B'],
      category_confirmation_gate: true },
    business_rules: { default_gate: 'non_electronic_unique_count', manual_review_on_low_confidence: true,
      count_manual_review_as_non_electronic: false, hard_exclusion_codes: [...REQUIRED_ELECTRONIC_EXCLUSION_CODES] }
  });
}

export async function createInitialPoolFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'temu-initial-pool-'));
  const databasePath = path.join(directory, 'fixture.db');
  migrateDatabase({ databasePath });
  const db = openDatabase(databasePath);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const now = sequenceClock();
  return { directory, databasePath, db, now, profile: fixtureCategoryProfile(),
    service: createCatalogCampaignService(db, { now }) };
}

export function databaseFingerprint(db) {
  const tables = ['catalog_campaigns', 'catalog_sources', 'catalog_rpa_queue', 'catalog_source_runs',
    'catalog_initial_pool_eligibility_audits', 'catalog_initial_pool_candidate_state'];
  return Object.fromEntries(tables.map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
}

function sequenceClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 31, 16, 0, tick++)).toISOString();
}
